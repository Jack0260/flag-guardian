import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  bombScore, buildCleanupPR, detonate, generateFlags, isArmed, keepCost, scanSampleRepo, severity, type Flag,
} from "@/lib/flags/engine";
import { Timer } from "@/components/bomb/Timer";

const DiffViewer = lazy(() => import("@/components/bomb/DiffViewer"));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Flag Time Bomb Detector — Bomb Squad for Feature Flags" },
      { name: "description", content: "Find stale feature flags whose OFF path would break production. AST scan, detonation simulation, safe cleanup PRs." },
      { property: "og:title", content: "Flag Time Bomb Detector" },
      { property: "og:description", content: "Simulate turning a flag OFF and catch dead tables and APIs before they explode." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

type Row = Flag & { score: number; armed: boolean };
const SEV_CLASS = { critical: "bg-destructive text-destructive-foreground", high: "bg-warn text-primary-foreground", medium: "bg-accent text-accent-foreground", low: "bg-secondary text-muted-foreground" };

function Dashboard() {
  const [connected, setConnected] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [dark, setDark] = useState(true);
  const [filter, setFilter] = useState<"armed" | "all">("armed");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => { document.documentElement.classList.toggle("dark", dark); }, [dark]);
  useEffect(() => { const t = setInterval(() => setElapsed((e) => e + 1), 1000); return () => clearInterval(t); }, []);

  const scan = useMemo(() => (connected ? scanSampleRepo() : null), [connected]);
  const rows = useMemo<Row[]>(() => {
    if (!scan) return [];
    const all = [...scan.flags, ...generateFlags(10000)];
    return all.map((f) => ({ ...f, score: bombScore(f), armed: isArmed(f) })).sort((a, b) => Number(!!b.real) - Number(!!a.real) || b.score - a.score);
  }, [scan]);
  const visible = useMemo(() => rows.filter((r) => (filter === "all" || r.armed) && (!q || r.key.includes(q))), [rows, filter, q]);
  const stats = useMemo(() => ({
    total: rows.length,
    armed: rows.filter((r) => r.armed).length,
    breaking: rows.filter((r) => r.armed && r.oldPathDeps.some((d) => d.status === "deleted")).length,
    kb: Math.round(rows.filter((r) => r.armed).reduce((s, r) => s + r.bundleKb, 0)),
  }), [rows]);
  const current = rows.find((r) => r.key === selected) ?? null;

  const connect = () => { setScanning(true); setTimeout(() => { setConnected(true); setScanning(false); setSelected("new_checkout"); }, 900); };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="hazard-stripe h-2" />
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-6 py-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-primary">Bomb Squad // Feature Flags</p>
          <h1 className="text-2xl font-bold">Flag Time Bomb Detector</h1>
        </div>
        <div className="flex items-center gap-3">
          {connected && <span className="font-mono text-xs text-muted-foreground">acme/storefront @ main · 4 files parsed via AST</span>}
          <button onClick={() => setDark(!dark)} className="rounded border border-border px-3 py-1.5 font-mono text-xs hover:bg-accent">{dark ? "LIGHT" : "DARK"}</button>
        </div>
      </header>

      {!connected ? (
        <section className="mx-auto max-w-2xl px-6 py-24 text-center">
          <p className="font-mono text-sm text-destructive animate-blink">● UNSCANNED REPOSITORY</p>
          <h2 className="mt-4 text-4xl font-bold leading-tight">Every flag left at 100% is a fuse.<br />Find out which ones are wired to a bomb.</h2>
          <p className="mt-4 text-muted-foreground">We parse every flag, simulate flipping it OFF, and trace the old code path to tables and APIs that no longer exist.</p>
          <button onClick={connect} disabled={scanning} className="mt-8 rounded bg-primary px-6 py-3 font-mono font-bold text-primary-foreground hover:opacity-90 disabled:opacity-60">
            {scanning ? "SCANNING…" : "CONNECT GITHUB REPO (DEMO)"}
          </button>
        </section>
      ) : (
        <main className="grid gap-6 p-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <section className="space-y-4">
            <div className="grid grid-cols-4 gap-3">
              {[["Flags", stats.total], ["Armed", stats.armed], ["Will break", stats.breaking], ["Dead KB", stats.kb]].map(([l, v], i) => (
                <div key={l} className={`rounded border border-border bg-card p-3 ${i === 2 ? "glow-danger" : ""}`}>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{l}</p>
                  <p className={`font-mono text-2xl font-bold ${i === 2 ? "text-destructive" : ""}`}>{Number(v).toLocaleString()}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="search flag key…" className="flex-1 rounded border border-input bg-card px-3 py-2 font-mono text-sm outline-none focus:ring-1 focus:ring-ring" />
              {(["armed", "all"] as const).map((f) => (
                <button key={f} onClick={() => setFilter(f)} className={`rounded border border-border px-3 font-mono text-xs uppercase ${filter === f ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>{f}</button>
              ))}
            </div>
            <FlagList rows={visible} selected={selected} onSelect={setSelected} elapsed={elapsed} />
          </section>
          {current && scan && <FlagDetail flag={current} usages={scan.usages} elapsed={elapsed} dark={dark} />}
        </main>
      )}
    </div>
  );
}

function FlagList({ rows, selected, onSelect, elapsed }: { rows: Row[]; selected: string | null; onSelect: (k: string) => void; elapsed: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => ref.current, estimateSize: () => 52, overscan: 10 });
  return (
    <div className="rounded border border-border bg-card">
      <div className="grid grid-cols-[1fr_70px_120px_60px] gap-2 border-b border-border px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        <span>Flag ({rows.length.toLocaleString()})</span><span>Rollout</span><span>Fuse</span><span className="text-right">Score</span>
      </div>
      <div ref={ref} className="h-[560px] overflow-auto">
        <div style={{ height: v.getTotalSize(), position: "relative" }}>
          {v.getVirtualItems().map((it) => {
            const r = rows[it.index]!;
            return (
              <button key={r.key} onClick={() => onSelect(r.key)} style={{ position: "absolute", top: 0, transform: `translateY(${it.start}px)`, height: it.size }}
                className={`grid w-full grid-cols-[1fr_70px_120px_60px] items-center gap-2 border-b border-border px-3 text-left text-sm hover:bg-accent ${selected === r.key ? "bg-accent" : ""}`}>
                <span className="truncate font-mono text-xs">{r.real && <span className="mr-1 text-primary">◆</span>}{r.key}</span>
                <span className="font-mono text-xs">{r.rolloutPct}%</span>
                <span className="text-xs"><Timer days={r.daysAtFull} elapsed={r.rolloutPct === 100 ? elapsed : 0} armed={r.armed} /></span>
                <span className={`justify-self-end rounded px-1.5 py-0.5 font-mono text-xs font-bold ${SEV_CLASS[severity(r.score)]}`}>{r.score}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function FlagDetail({ flag, usages, elapsed, dark }: { flag: Row; usages: ReturnType<typeof scanSampleRepo>["usages"]; elapsed: number; dark: boolean }) {
  const [simulated, setSimulated] = useState(false);
  const [showPR, setShowPR] = useState(false);
  const [fileIdx, setFileIdx] = useState(0);
  useEffect(() => { setSimulated(false); setShowPR(false); setFileIdx(0); }, [flag.key]);
  const result = detonate(flag);
  const cost = keepCost(flag);
  const pr = flag.real ? buildCleanupPR(flag, usages) : null;
  const flagUsages = usages.filter((u) => u.flag === flag.key);
  const sev = severity(flag.score);

  return (
    <section className={`space-y-4 rounded border border-border bg-card p-5 ${result.breaks && flag.armed ? "glow-danger" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">{flag.provider} · {flag.area}</p>
          <h2 className="font-mono text-xl font-bold">{flag.key}</h2>
          <p className="mt-1 text-sm">At 100% for <Timer days={flag.daysAtFull} elapsed={flag.rolloutPct === 100 ? elapsed : 0} armed={flag.armed} /></p>
        </div>
        <div className="text-right">
          <p className="font-mono text-5xl font-bold">{flag.score}</p>
          <span className={`rounded px-2 py-0.5 font-mono text-xs uppercase ${SEV_CLASS[sev]}`}>{sev}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Branches", `+${cost.cyclomatic}`], ["Bundle", `${cost.bundleKb} KB`], ["Dead lines", cost.deadLines], ["Upkeep", `${cost.maintenanceHrsPerYear}h/yr`]].map(([l, v]) => (
          <div key={l} className="rounded bg-muted p-2"><p className="font-mono text-[10px] uppercase text-muted-foreground">{l}</p><p className="font-mono font-bold">{v}</p></div>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">OFF-path dependencies</p>
          {flag.oldPathDeps.length === 0 ? <p className="text-sm text-muted-foreground">None traced</p> : flag.oldPathDeps.map((d, i) => (
            <p key={i} className="font-mono text-xs"><span className={d.status === "deleted" ? "text-destructive" : d.status === "deprecated" ? "text-warn" : "text-safe"}>■ {d.status}</span> {d.kind} {d.name}</p>
          ))}
        </div>
        <div>
          <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Git history · OFF path</p>
          <p className="font-mono text-xs">last exercised in CI: {flag.oldPathLastTestedDays}d ago</p>
          <p className="font-mono text-xs">test coverage: {Math.round(flag.oldPathCoverage * 100)}%</p>
          {flagUsages.map((u, i) => <p key={i} className="truncate font-mono text-xs text-muted-foreground">{u.file}:{u.line} ({u.kind})</p>)}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => setSimulated(true)} className="rounded bg-destructive px-4 py-2 font-mono text-sm font-bold text-destructive-foreground hover:opacity-90">☢ SIMULATE FLAG OFF</button>
        {pr && <button onClick={() => setShowPR(true)} className="rounded border border-primary px-4 py-2 font-mono text-sm font-bold text-primary hover:bg-accent">GENERATE CLEANUP PR</button>}
      </div>

      {simulated && (
        <div className={`rounded border p-4 ${result.breaks ? "border-destructive bg-destructive/10" : "border-safe bg-safe/10"}`}>
          <p className={`font-mono text-sm font-bold ${result.breaks ? "text-destructive" : "text-safe"}`}>{result.breaks ? "💥 DETONATION — production breaks" : "✓ DEFUSED — OFF path still safe"}</p>
          <ul className="mt-2 space-y-1 text-sm">{result.findings.length ? result.findings.map((f, i) => <li key={i}>→ {f}</li>) : <li>No dead references found on the OFF path.</li>}</ul>
        </div>
      )}

      {showPR && pr && (
        <div className="space-y-2">
          <p className="font-mono text-sm font-bold">{pr.title}</p>
          <p className="font-mono text-xs text-muted-foreground">branch: {pr.branch} · {pr.files.length} files + 1 test</p>
          <div className="flex flex-wrap gap-1">
            {[...pr.files.map((f) => f.path), pr.testFile.path].map((p, i) => (
              <button key={p} onClick={() => setFileIdx(i)} className={`rounded px-2 py-1 font-mono text-xs ${fileIdx === i ? "bg-primary text-primary-foreground" : "bg-muted"}`}>{p.split("/").pop()}</button>
            ))}
          </div>
          <div className="overflow-hidden rounded border border-border">
            <ClientOnly fallback={<div className="h-[420px]" />}>
              <Suspense fallback={<div className="h-[420px] p-4 font-mono text-xs">loading diff…</div>}>
                {pr.files[fileIdx]
                  ? <DiffViewer before={pr.files[fileIdx]!.before} after={pr.files[fileIdx]!.after} path={pr.files[fileIdx]!.path} dark={dark} />
                  : <DiffViewer before="" after={pr.testFile.content} path={pr.testFile.path} dark={dark} />}
              </Suspense>
            </ClientOnly>
          </div>
        </div>
      )}
      {!flag.real && <p className="font-mono text-[10px] text-muted-foreground">Synthetic flag (scale test). Cleanup PRs are generated for ◆ flags parsed from the connected repo.</p>}
    </section>
  );
}
