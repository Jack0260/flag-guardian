import { describe, it, expect } from "vitest";
import { bombScore, isArmed, detonate, scanSampleRepo, buildCleanupPR, generateFlags } from "./engine";

describe("time bomb rules", () => {
  it("a flag is armed only at 100% for more than 60 days", () => {
    expect(isArmed({ rolloutPct: 100, daysAtFull: 61 })).toBe(true);
    expect(isArmed({ rolloutPct: 100, daysAtFull: 60 })).toBe(false);
    expect(isArmed({ rolloutPct: 90, daysAtFull: 300 })).toBe(false);
  });

  it("score is 0 for partially rolled-out flags and capped at 100", () => {
    const base = { daysAtFull: 900, oldPathCoverage: 0, oldPathLastTestedDays: 900, oldPathDeps: Array(5).fill({ kind: "table", name: "x", status: "deleted", changedDaysAgo: 1 }) };
    expect(bombScore({ ...base, rolloutPct: 50 })).toBe(0);
    expect(bombScore({ ...base, rolloutPct: 100 })).toBe(100);
  });

  it("AST finds new_checkout and simulation reports deleted orders_v1", () => {
    const { flags } = scanSampleRepo();
    const f = flags.find((x) => x.key === "new_checkout")!;
    expect(f.usages).toBe(2);
    const d = detonate(f);
    expect(d.breaks).toBe(true);
    expect(d.findings[0]).toContain("table 'orders_v1' was deleted");
  });

  it("cleanup PR removes the flag and the old path", () => {
    const { flags, usages } = scanSampleRepo();
    const pr = buildCleanupPR(flags.find((x) => x.key === "new_checkout")!, usages);
    for (const file of pr.files) {
      expect(file.after).not.toContain("new_checkout");
      expect(file.after).not.toContain("orders_v1");
    }
  });

  it("generates 10k flags", () => {
    expect(generateFlags(10000)).toHaveLength(10000);
  });
});
