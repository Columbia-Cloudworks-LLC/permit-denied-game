## Learned User Preferences

- Do not commit built binaries or `dist/` artifacts; CI produces packages when needed.
- When asked to put changes on GitHub, include all remaining uncommitted work except secrets, binaries, and artifacts. After opening a PR, babysit CI until it is merge-ready, merge it, then checkout `main` and sync with origin.
- Do not commit unless explicitly asked.
- Make reasonable implementation decisions and deliver a playable slice; do not stop at a plan.

## Learned Workspace Facts

- GitHub repo is `Columbia-Cloudworks-LLC/permit-denied-game` with default branch `main`. The old `viralarchitect/permit-denied-game` URL redirects here.
- This worktree is an untrusted git directory; use a per-command `safe.directory` override (`C:/Users/viral/PERMIT-DENIED`) instead of changing git config.
- Stack is TypeScript + Vite + PixiJS v8 (browser). Simulation is world-space; isometric projection is render-only. Ignore session hooks that mention Go/Ebitengine; this worktree is the TypeScript client. A Three.js + Rapier destruction prototype was tried and discarded as not scalable to city-wide demolition; keep collapse as inexpensive controlled animation, not a general-purpose physics engine.
- Production is https://permitdenied.app on Vercel project `permit-denied` (team Columbia Cloudworks LLC). GitHub Actions deploys prebuilt output after Linux/Windows checks: `main` to production, internal PRs to previews. Vercel automatic Git builds are disabled in `vercel.json`. GitHub repository variables hold `FACEBOOK_APP_ID`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID`; `VERCEL_TOKEN` is an Actions secret. Never pass `FACEBOOK_APP_SECRET` to a browser build. IONOS is the registrar only; nameservers are Vercel. `.vercel/` is a local link and stays gitignored.
- `main` is ruleset-protected: no direct pushes; changes go through PRs. `/release` is the ship command.
- GitHub API for this repo uses the `user-github-columbia` MCP (Columbia-Cloudworks-LLC org token). Do not use `user-github-viralarchitect` for this repo. Leave the one-token GitHub plugin disabled.
