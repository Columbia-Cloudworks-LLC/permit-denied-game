# Contributing

PERMIT DENIED is a one-town isometric demolition arcade. Same town every run.

Time Challenge is a **seven-level campaign** on that town (County through Governor's Mansion). There is no second map, no unlock tree, and no between-run metagame. Sandbox, the Asset Test Yard, captures, and development scenarios stay on their own paths. See [`docs/campaign.md`](../docs/campaign.md).

1. [`README.md`](../README.md) — run, controls, scope, and hosting
2. Stay client-side: TypeScript + Vite + PixiJS. Simulation is world-space; isometric projection is render-only.

Ship a single change through one pull request against `main` (`main` is ruleset-protected). In Cursor, `/release` inspects remaining work, bumps `package.json` and `package-lock.json` to the next `1.0.N` (patch unless specified), titles the PR `Release 1.0.N: <short what shipped>`, commits remaining local work (no secrets, binaries, or `dist/`), opens the PR, waits on CI, merges, then checks out and syncs `main`. A merge to `main` deploys https://permitdenied.app on Vercel. Do not ship a feature PR without that version bump. See `.cursor/commands/release.md`.

A **stacked PR** (also “PR stack” or “stacked release”) is not that single ship pull request, and it is not several commits on one branch. It is a chain of branches and pull requests: the bottom pull request targets `main`, and each later pull request targets the branch under it. Procedure: `.cursor/skills/stacked-pr/SKILL.md`.

Copy to keep: `PERMIT DENIED`, `The County Said No.`, `BLADE UP` / `BLADE DOWN`, deaths `ENGINE COOKED` / `TRACK THROWN` / `COUNTY CLOCK`.

## Checks

```powershell
npm run check          # TypeScript for src and operational scripts
npm test               # fast deterministic unit tests (local budget: ~30s cases)
npm run test:integration  # district/campaign generation matrices
npm run test:soak      # long simulation (Linux CI)
npm run test:bench     # performance measurements (not a merge gate)
npm run build          # typecheck, production bundle, JS budget
```

Linux CI runs unit, integration, soak, script tests, build, PWA, catalog, and privacy checks. Windows CI (`windows`, the required check) runs unit tests, script tests, build, and PWA so path/filesystem regressions still surface without duplicating multi-minute generation. Benchmarks stay on `npm run test:bench`. See [`docs/testing.md`](../docs/testing.md).

