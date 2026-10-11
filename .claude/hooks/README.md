# Claude Code hooks

Cross-platform Node hooks for this TypeScript + Vite + PixiJS repository, registered in `.claude/settings.json`. Inspect them with `/hooks` in Claude Code.

Scripts fail open. `SessionStart` is given 25 seconds so a bounded `git fetch` of `origin/main` can finish without hanging the session.

| Event | Script | What it does |
|---|---|---|
| `SessionStart` | `session-start.mjs` | Runs `npm run repo:preflight` logic, then injects branch/SHA/freshness plus the real local test/build commands as `additionalContext` |
| `PreToolUse` (`Bash`, `PowerShell`) | `shell-guard.mjs` | Denies staging or committing `dist/` / `*.exe`; asks on force-push. Prints nothing otherwise, so normal permission prompts still apply |

`shell-guard.mjs` parses the command rather than pattern-matching the raw text: it drops heredoc bodies and PowerShell here-strings, splits on `;`, `&&`, `||`, `|` and newlines, and checks only the path arguments of real `git add` / `git commit` invocations. Commit messages (`-m`, `-F`), `echo`, `rg`, and comments that mention `dist/` pass through.

Checkout freshness lives in `scripts/repo-preflight.mjs` (`npm run repo:preflight`). It fetches `origin/main` and fast-forwards only when that is provably safe. It does not run from `npm install`, `npm run build`, the game runtime, or CI production builds.

Tests: `scripts/claude-hooks.test.mjs` (run by `node --test scripts/*.test.mjs`).
