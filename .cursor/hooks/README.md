# Cursor hooks

Cross-platform Node hooks for this TypeScript + Vite + PixiJS repository. Cursor reloads `.cursor/hooks.json` on save. Inspect them under **Settings → Hooks**, or the **Hooks** output channel.

Scripts fail open unless they explicitly return `deny`. `sessionStart` is given 25 seconds so a bounded `git fetch` of `origin/main` can finish without hanging the session.

| Event | Script | What it does |
|---|---|---|
| `sessionStart` | `session-start.mjs` | Runs `npm run repo:preflight` logic, then injects branch/SHA/freshness plus the real local test/build commands |
| `beforeShellExecution` | `shell-guard.mjs` | Blocks committing `dist/` / `*.exe`; asks on force-push |

Checkout freshness lives in `scripts/repo-preflight.mjs` (`npm run repo:preflight`). It fetches `origin/main` and fast-forwards only when that is provably safe. It does not run from `npm install`, `npm run build`, the game runtime, or CI production builds.

Runtime state: `.cursor/hooks/state/` (not committed).
