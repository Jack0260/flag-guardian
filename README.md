# Flag Time Bomb Detector

> Built a Feature Flag Time Bomb detector using AST analysis that simulates flag OFF and prevents production outages from dead code.

Connect a repo (mocked), parse every feature flag (LaunchDarkly + custom SDKs) with a real AST, and for every flag that has been **ON at 100% for more than 60 days** run a **Detonation Simulation**: what happens if someone flips it OFF right now?

## How flags become bombs

1. **Day 0** — `new_checkout` ships behind a flag. Both branches are live and tested.
2. **Day 14** — rollout hits 100%. Nobody removes the flag ("we'll clean it up later").
3. **Day 60** — CI stops exercising the OFF branch. Its tests are skipped or deleted.
4. **Day 150** — a migration drops `orders_v1`. The new path doesn't use it, so nothing fails.
5. **Day 214** — an incident responder flips `new_checkout` OFF as a "safe rollback". The old branch wakes up, writes to a table that no longer exists, and checkout goes down.

The flag was never a kill switch. It was a fuse.

## Detonation simulation logic

```
for each flag F where rollout == 100% and daysAtFull > 60:
  usages   = AST scan (IfStatement / ConditionalExpression / call sites)
  offPath  = for each usage, the branch taken when F == false
             (alternate for `if (flag)`, consequent for `if (!flag)`)
  deps     = tables, APIs, functions, env vars referenced inside offPath
  for dep in deps:
     status = schema history / API registry / git log (deleted | deprecated | alive)
  breaks   = any(dep.status == deleted)
  report   "If you turn OFF 'F', <area> will break because <kind> '<dep>' was deleted N months ago"
```

## Time Bomb Score (0-100)

| Factor | Weight |
| --- | --- |
| Age at 100% (capped at 1 year) | 35 |
| Dead dependencies on OFF path (deleted ×20, deprecated ×8) | 40 |
| Missing test coverage on OFF path | 15 |
| Time since OFF path last ran in CI (git history) | 10 |

Flags under 100% always score 0. 75+ critical, 50+ high, 25+ medium.

## Other capabilities

- **AST parsing** — `@babel/parser` for JS/TS/JSX (`variation`, `useFlag`, `isEnabled`, …); token scan for Python (`is_enabled`, `variation`).
- **Cleanup PR** — rewrites source over AST ranges: keeps the ON branch, deletes the OFF branch and the flag check, plus a generated test asserting the flag and dead dependencies are gone. Viewed in a Monaco diff editor.
- **Cost of keeping** — extra branches, dead lines, bundle KB, maintenance hours/year.
- **Scale** — 10,000+ flags, virtualized list, memoized scoring.

## Stack note

Built on TanStack Start + React + TypeScript (this platform's framework, in place of Next.js). The repo connection, git history and schema status are mocked; the AST parsing, scoring, simulation and PR rewrite are real (`src/lib/flags`). Tests: `bunx vitest run src/lib/flags/engine.test.ts`.
