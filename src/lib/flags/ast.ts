import { parse } from "@babel/parser";

export type Usage = {
  flag: string;
  file: string;
  line: number;
  provider: "launchdarkly" | "custom";
  kind: "if" | "ternary" | "call";
  start: number;
  end: number;
  /** source ranges of the new (ON) and old (OFF) branches */
  on?: [number, number];
  off?: [number, number] | null;
};

const LD_METHODS = new Set(["variation", "boolVariation", "useFlag", "useLDFlag"]);
const CUSTOM_METHODS = new Set(["isEnabled", "isOn", "flagEnabled", "useFeature"]);

type N = { type: string; start: number; end: number; loc?: { start: { line: number } }; [k: string]: any };

function flagFromCall(node: N): { flag: string; provider: Usage["provider"] } | null {
  if (node?.type !== "CallExpression") return null;
  const callee = node.callee;
  const name =
    callee.type === "Identifier" ? callee.name : callee.type === "MemberExpression" ? callee.property?.name : null;
  const arg = node.arguments?.[0];
  if (!name || arg?.type !== "StringLiteral") return null;
  if (LD_METHODS.has(name)) return { flag: arg.value, provider: "launchdarkly" };
  if (CUSTOM_METHODS.has(name)) return { flag: arg.value, provider: "custom" };
  return null;
}

function findFlagIn(node: N | null): (ReturnType<typeof flagFromCall> & { call?: N }) | null {
  if (!node || typeof node !== "object") return null;
  const direct = flagFromCall(node);
  if (direct) return { ...direct, call: node };
  if (node.type === "UnaryExpression" || node.type === "AwaitExpression") return findFlagIn(node.argument);
  return null;
}

function walk(node: any, visit: (n: N) => boolean | void) {
  if (!node || typeof node.type !== "string") return;
  if (visit(node) === false) return;
  for (const key of Object.keys(node)) {
    if (key === "loc" || key === "leadingComments" || key === "trailingComments") continue;
    const v = node[key];
    if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === "string" && walk(c, visit));
    else if (v && typeof v.type === "string") walk(v, visit);
  }
}

/** Parse JS/TS/JSX with a real AST and return every feature-flag usage. */
export function parseJsFlags(file: string, src: string): Usage[] {
  const ast = parse(src, { sourceType: "module", plugins: ["typescript", "jsx"], errorRecovery: true });
  const out: Usage[] = [];
  const claimed = new Set<number>();
  walk(ast.program, (n) => {
    if (n.type === "IfStatement" || n.type === "ConditionalExpression") {
      const negated = n.test.type === "UnaryExpression" && n.test.operator === "!";
      const hit = findFlagIn(n.test);
      if (hit) {
        claimed.add(hit.call!.start);
        delete hit.call;
        const cons: [number, number] = [n.consequent.start, n.consequent.end];
        const alt: [number, number] | null = n.alternate ? [n.alternate.start, n.alternate.end] : null;
        out.push({
          ...hit,
          file,
          line: n.loc!.start.line,
          kind: n.type === "IfStatement" ? "if" : "ternary",
          start: n.start,
          end: n.end,
          on: negated ? (alt ?? [n.end, n.end]) : cons,
          off: negated ? cons : alt,
        });
      }
    }
    if (n.type === "CallExpression" && !claimed.has(n.start)) {
      const hit = flagFromCall(n);
      if (hit) out.push({ ...hit, file, line: n.loc!.start.line, kind: "call", start: n.start, end: n.end });
    }
  });
  return out;
}

/** Python: tokenizer-level scan for `is_enabled("x")` / `ld.variation("x", ...)`. */
export function parsePyFlags(file: string, src: string): Usage[] {
  const out: Usage[] = [];
  const re = /\b(is_enabled|variation|bool_variation|feature_on)\(\s*["']([\w.-]+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const line = src.slice(0, m.index).split("\n").length;
    const isIf = /^\s*(if|elif)\b/.test(src.split("\n")[line - 1] ?? "");
    out.push({
      flag: m[2],
      file,
      line,
      provider: m[1].includes("variation") ? "launchdarkly" : "custom",
      kind: isIf ? "if" : "call",
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return out;
}

export function parseFile(file: string, src: string): Usage[] {
  return file.endsWith(".py") ? parsePyFlags(file, src) : parseJsFlags(file, src);
}

function dedentBlock(text: string): string {
  let body = text.trim();
  if (body.startsWith("{") && body.endsWith("}")) body = body.slice(1, -1);
  const lines = body.replace(/^\n/, "").replace(/\s+$/, "").split("\n");
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)![0].length));
  return lines.map((l) => l.slice(indent)).join("\n");
}

/** Remove a flag: keep the ON branch, delete the OFF branch. Pure source rewrite over AST ranges. */
export function removeFlag(src: string, usages: Usage[], flag: string): string {
  const targets = usages.filter((u) => u.flag === flag && u.kind !== "call").sort((a, b) => b.start - a.start);
  let out = src;
  for (const u of targets) {
    const onText = u.on ? src.slice(u.on[0], u.on[1]) : "";
    let replacement: string;
    if (u.kind === "ternary") replacement = onText;
    else {
      const lineStart = src.lastIndexOf("\n", u.start) + 1;
      const pad = src.slice(lineStart, u.start);
      replacement = onText
        ? dedentBlock(onText)
            .split("\n")
            .map((l, i) => (i === 0 ? l : pad + l))
            .join("\n")
        : "";
    }
    out = out.slice(0, u.start) + replacement + out.slice(u.end);
  }
  return out;
}
