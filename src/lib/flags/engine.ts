import { parseFile, removeFlag, type Usage } from "./ast";
import { SAMPLE_FILES } from "./sample-repo";

export type DepKind = "table" | "api" | "function" | "env";
export type Dep = { kind: DepKind; name: string; status: "deleted" | "deprecated" | "alive"; changedDaysAgo: number };

export type Flag = {
  key: string;
  provider: "launchdarkly" | "custom";
  area: string;
  rolloutPct: number;
  daysAtFull: number;
  usages: number;
  files: string[];
  oldPathDeps: Dep[];
  oldPathLastTestedDays: number;
  oldPathCoverage: number; // 0..1
  addedLines: number; // lines of dead OFF branch
  bundleKb: number;
  real?: boolean; // parsed from the sample repo via AST
};

export const BOMB_AGE_DAYS = 60;

export function isArmed(f: Pick<Flag, "rolloutPct" | "daysAtFull">) {
  return f.rolloutPct === 100 && f.daysAtFull > BOMB_AGE_DAYS;
}

/** Time Bomb Score 0-100: age 35, dead deps 40, missing coverage 15, stale tests 10. */
export function bombScore(f: Pick<Flag, "rolloutPct" | "daysAtFull" | "oldPathDeps" | "oldPathCoverage" | "oldPathLastTestedDays">) {
  if (f.rolloutPct < 100) return 0;
  const age = Math.min(f.daysAtFull / 365, 1) * 35;
  const dead = f.oldPathDeps.filter((d) => d.status === "deleted").length;
  const deprecated = f.oldPathDeps.filter((d) => d.status === "deprecated").length;
  const deps = Math.min(dead * 20 + deprecated * 8, 40);
  const cov = (1 - f.oldPathCoverage) * 15;
  const stale = Math.min(f.oldPathLastTestedDays / 365, 1) * 10;
  return Math.round(Math.min(100, age + deps + cov + stale));
}

export function severity(score: number) {
  if (score >= 75) return "critical" as const;
  if (score >= 50) return "high" as const;
  if (score >= 25) return "medium" as const;
  return "low" as const;
}

/** Cost of keeping the flag around. */
export function keepCost(f: Flag) {
  const cyclomatic = f.usages; // each branch adds +1
  const maintenanceHrsPerYear = Math.round(f.usages * 0.6 + f.addedLines / 40);
  return { cyclomatic, bundleKb: f.bundleKb, deadLines: f.addedLines, maintenanceHrsPerYear };
}

export type Detonation = { breaks: boolean; findings: string[] };

const KIND_LABEL: Record<DepKind, string> = { table: "table", api: "API", function: "function", env: "env var" };

/** Simulate flipping the flag OFF: the OFF branch goes live again; any dead dependency it touches explodes. */
export function detonate(f: Flag): Detonation {
  const findings = f.oldPathDeps
    .filter((d) => d.status !== "alive")
    .map((d) =>
      d.status === "deleted"
        ? `If you turn OFF '${f.key}', ${f.area} will break because ${KIND_LABEL[d.kind]} '${d.name}' was deleted ${months(d.changedDaysAgo)} ago.`
        : `If you turn OFF '${f.key}', ${f.area} may degrade: ${KIND_LABEL[d.kind]} '${d.name}' was deprecated ${months(d.changedDaysAgo)} ago.`,
    );
  if (f.oldPathLastTestedDays > 180)
    findings.push(`The OFF path of '${f.key}' has not run in CI for ${months(f.oldPathLastTestedDays)}.`);
  return { breaks: f.oldPathDeps.some((d) => d.status === "deleted"), findings };
}

function months(days: number) {
  const m = Math.round(days / 30);
  return m <= 1 ? "1 month" : `${m} months`;
}

// ---------- mock repo generation (seeded, deterministic) ----------

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const AREAS = ["checkout", "search", "onboarding", "billing", "notifications", "profile", "cart", "reports", "auth", "inventory"];
const NOUNS = ["v2", "redesign", "fast_path", "new_flow", "ai_ranker", "beta", "rollout", "migration", "experiment", "cache"];
const TABLES = ["orders_v1", "users_legacy", "cart_items_old", "invoices_2022", "sessions_v1", "products_flat", "events_raw"];
const APIS = ["/api/v1/pay", "/api/legacy/search", "stripe.charges.create", "/v1/notify", "sendgrid.v2.send", "/api/old/cart"];

export function generateFlags(count: number, seed = 42): Flag[] {
  const r = rng(seed);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const flags: Flag[] = [];
  for (let i = 0; i < count; i++) {
    const area = pick(AREAS);
    const full = r() < 0.7;
    const days = Math.floor(r() * 720);
    const deps: Dep[] = [];
    const nDeps = Math.floor(r() * 4);
    for (let d = 0; d < nDeps; d++) {
      const kind: DepKind = r() < 0.5 ? "table" : r() < 0.8 ? "api" : "function";
      const roll = r();
      deps.push({
        kind,
        name: kind === "table" ? pick(TABLES) : kind === "api" ? pick(APIS) : `legacy${area[0].toUpperCase()}${area.slice(1)}Handler`,
        status: roll < 0.25 ? "deleted" : roll < 0.45 ? "deprecated" : "alive",
        changedDaysAgo: Math.floor(r() * Math.max(days, 30)),
      });
    }
    const usages = 1 + Math.floor(r() * 18);
    flags.push({
      key: `${area}_${pick(NOUNS)}_${i.toString(36)}`,
      provider: r() < 0.6 ? "launchdarkly" : "custom",
      area,
      rolloutPct: full ? 100 : pick([0, 5, 25, 50, 90]),
      daysAtFull: full ? days : 0,
      usages,
      files: Array.from({ length: Math.min(usages, 4) }, (_, k) => `src/${area}/${pick(NOUNS)}${k}.ts`),
      oldPathDeps: deps,
      oldPathLastTestedDays: Math.floor(r() * (days + 30)),
      oldPathCoverage: Math.round(r() * 100) / 100,
      addedLines: usages * (5 + Math.floor(r() * 40)),
      bundleKb: Math.round(usages * r() * 4 * 10) / 10,
    });
  }
  return flags;
}

/** Flags parsed for real from the sample repo via AST, enriched with mock git/infra metadata. */
export const REAL_META: Record<string, Partial<Flag>> = {
  new_checkout: {
    area: "checkout",
    daysAtFull: 214,
    oldPathDeps: [
      { kind: "table", name: "orders_v1", status: "deleted", changedDaysAgo: 61 },
      { kind: "api", name: "/api/v1/pay", status: "deprecated", changedDaysAgo: 140 },
    ],
    oldPathLastTestedDays: 230,
    oldPathCoverage: 0.08,
  },
  search_ai_ranker: {
    area: "search",
    daysAtFull: 95,
    oldPathDeps: [{ kind: "api", name: "/api/legacy/search", status: "deleted", changedDaysAgo: 40 }],
    oldPathLastTestedDays: 100,
    oldPathCoverage: 0.3,
  },
  email_v2: {
    area: "notifications",
    daysAtFull: 400,
    oldPathDeps: [{ kind: "api", name: "sendgrid.v2.send", status: "alive", changedDaysAgo: 0 }],
    oldPathLastTestedDays: 20,
    oldPathCoverage: 0.85,
  },
  dark_launch_reports: { area: "reports", rolloutPct: 25, daysAtFull: 0, oldPathDeps: [], oldPathLastTestedDays: 3, oldPathCoverage: 0.9 },
};

export function scanSampleRepo() {
  const usages: Usage[] = [];
  for (const f of SAMPLE_FILES) usages.push(...parseFile(f.path, f.source));
  const byFlag = new Map<string, Usage[]>();
  for (const u of usages) byFlag.set(u.flag, [...(byFlag.get(u.flag) ?? []), u]);
  const flags: Flag[] = [...byFlag.entries()].map(([key, us]) => {
    const offLines = us.reduce((n, u) => {
      if (!u.off) return n;
      const src = SAMPLE_FILES.find((f) => f.path === u.file)!.source;
      return n + src.slice(u.off[0], u.off[1]).split("\n").length;
    }, 0);
    return {
      key,
      provider: us[0].provider,
      area: "app",
      rolloutPct: 100,
      daysAtFull: 0,
      usages: us.length,
      files: [...new Set(us.map((u) => u.file))],
      oldPathDeps: [],
      oldPathLastTestedDays: 0,
      oldPathCoverage: 1,
      addedLines: offLines,
      bundleKb: Math.round(offLines * 0.045 * 10) / 10,
      real: true,
      ...REAL_META[key],
    };
  });
  return { usages, flags };
}

export type CleanupPR = { title: string; branch: string; files: { path: string; before: string; after: string }[]; testFile: { path: string; content: string } };

export function buildCleanupPR(flag: Flag, usages: Usage[]): CleanupPR {
  const files = SAMPLE_FILES.filter((f) => usages.some((u) => u.file === f.path && u.flag === flag.key)).map((f) => ({
    path: f.path,
    before: f.source,
    after: removeFlag(f.source, usages.filter((u) => u.file === f.path), flag.key),
  }));
  const test = `import { describe, it, expect } from "vitest";
// Auto-generated by Flag Time Bomb Detector
// Guarantees '${flag.key}' is fully removed and the ON path is now unconditional.
import * as fs from "node:fs";

describe("cleanup: ${flag.key}", () => {
${files
  .map(
    (f) => `  it("${f.path} no longer references the flag", () => {
    const src = fs.readFileSync("${f.path}", "utf8");
    expect(src).not.toContain("${flag.key}");
  });`,
  )
  .join("\n")}
${flag.oldPathDeps
  .filter((d) => d.status === "deleted")
  .map(
    (d) => `  it("no live code references deleted ${d.kind} '${d.name}'", () => {
${files.map((f) => `    expect(fs.readFileSync("${f.path}", "utf8")).not.toContain("${d.name}");`).join("\n")}
  });`,
  )
  .join("\n")}
});
`;
  return {
    title: `chore(flags): remove '${flag.key}' and its dead OFF path`,
    branch: `bombsquad/remove-${flag.key}`,
    files,
    testFile: { path: `src/__tests__/cleanup-${flag.key}.test.ts`, content: test },
  };
}
