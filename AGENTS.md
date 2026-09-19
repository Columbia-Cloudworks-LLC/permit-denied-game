## Start of task

Run `npm run repo:preflight` before any code-dependent review, diagnosis, or implementation. The `sessionStart` hook runs the same check; still run it explicitly if the session began without that context.

- Fetch is required before claiming the checkout is current. A failed fetch is **unverified freshness**, not proof the worktree matches GitHub `main`.
- Do not begin a review against a stale local `main` merely because `git status` is clean.
- If the preflight cannot safely update a dirty, diverged, detached, or unique feature branch, preserve that state and report it. Never stash, reset, rebase, or merge divergent history to “catch up.”
- Base new implementation branches on the fetched `origin/main`.
- Cursor Cloud Agents and the Windows checkout are independent clones. A merge on GitHub does not advance `C:\Users\viral\PERMIT-DENIED`.
- Cloud Build setting (stored by Cursor, not Git): **Update stale builds = on**, **Staleness threshold = 0**. `.cursor/environment.json` and `npm install` cannot enforce this. Do not hide `git pull` inside dependency installation or the production build.

## Learned User Preferences

- Do not commit built binaries or `dist/` artifacts; CI produces packages when needed.
- When asked to put changes on GitHub, include all remaining uncommitted work except secrets, binaries, and artifacts. After opening a PR, babysit CI until it is merge-ready, merge it, then checkout `main` and sync with origin. `/release` is the ship path: inspect remaining work, bump `package.json` and `package-lock.json` to the next `1.0.N` (patch unless specified), title the PR `Release 1.0.N: <short what shipped>`, then commit, PR, CI, merge, and sync `main`.
- Do not commit unless explicitly asked.
- Make reasonable implementation decisions and deliver a playable slice; do not stop at a plan.

## Learned Workspace Facts

- GitHub repo is `Columbia-Cloudworks-LLC/permit-denied-game` with default branch `main`. The old `viralarchitect/permit-denied-game` URL redirects here.
- This worktree is an untrusted git directory; use a per-command `safe.directory` override with the resolved worktree path (on the Windows checkout that is `C:/Users/viral/PERMIT-DENIED`) instead of changing git config.
- Stack is TypeScript + Vite + PixiJS v8 (browser). Simulation is world-space; isometric projection is render-only. Session startup injects that stack, `npm test` / `npm run build` / `npm run dev`, and repository freshness — not a previous engine. A Three.js + Rapier destruction prototype was tried and discarded as not scalable to city-wide demolition; keep collapse as inexpensive controlled animation, not a general-purpose physics engine.
- Production is https://permitdenied.app on Vercel project `permit-denied` (team Columbia Cloudworks LLC). GitHub Actions deploys prebuilt output after Linux/Windows checks: `main` to production, internal PRs to previews. Vercel automatic Git builds are disabled in `vercel.json`. GitHub repository variables hold `FACEBOOK_APP_ID`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID`; `VERCEL_TOKEN` is an Actions secret. Never pass `FACEBOOK_APP_SECRET` to a browser build. IONOS is the registrar only; nameservers are Cloudflare. `github.permitdenied.app` is a Vercel project alias that 308s to the GitHub repository. `.vercel/` is a local link and stays gitignored.
- `main` is ruleset-protected: no direct pushes; changes go through PRs. `/release` is the ship command. Every ship must bump `package.json` / `package-lock.json` to the next `1.0.N` (patch unless specified) and use the PR title `Release 1.0.N: <short what shipped>`. That is the only versioning scheme. The durable procedure is `.cursor/commands/release.md`.
- GitHub API for this repo uses the `user-github-columbia` MCP (Columbia-Cloudworks-LLC org token). Do not use `user-github-viralarchitect` for this repo. Leave the one-token GitHub plugin disabled.
