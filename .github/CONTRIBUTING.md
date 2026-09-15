# Contributing

PERMIT DENIED is a one-town isometric demolition arcade. Same lot every run. No campaign, no between-run meta, no second map.

1. [`README.md`](../README.md) — run, controls, scope, and hosting
2. Stay client-side: TypeScript + Vite + PixiJS. Simulation is world-space; isometric projection is render-only.

Ship through a pull request against `main` (`main` is ruleset-protected). In Cursor, `/release` inspects remaining work, bumps `package.json` and `package-lock.json` to the next `1.0.N` (patch unless specified), titles the PR `Release 1.0.N: <short what shipped>`, commits remaining local work (no secrets, binaries, or `dist/`), opens the PR, waits on CI, merges, then checks out and syncs `main`. A merge to `main` deploys https://permitdenied.app on Vercel. Do not ship a feature PR without that version bump. See `.cursor/commands/release.md`.

Copy to keep: `PERMIT DENIED`, `The County Said No.`, `BLADE UP` / `BLADE DOWN`, deaths `ENGINE COOKED` / `TRACK THROWN` / `COUNTY CLOCK`.

## Checks

```powershell
npm test
npm run build
```
