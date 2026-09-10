## Learned User Preferences

- Do not commit built binaries or `dist/` artifacts; CI produces packages when needed.
- When asked to put changes on GitHub, include all remaining uncommitted work except secrets, binaries, and artifacts. After opening a PR, babysit CI until it is merge-ready, merge it, then checkout `main` and sync with origin.
- Do not commit unless explicitly asked.

## Learned Workspace Facts

- GitHub repo is `Columbia-Cloudworks-LLC/permit-denied-game` with default branch `main`. The old `viralarchitect/permit-denied-game` URL redirects here.
- This worktree is an untrusted git directory; use a per-command `safe.directory` override (`C:/Users/viral/PERMIT-DENIED`) instead of changing git config.
- Stack is TypeScript + Vite + PixiJS v8 (browser). Simulation is world-space; isometric projection is render-only. Ignore session hooks that mention Go/Ebitengine; this worktree is the TypeScript client.
- Production is https://permitdenied.app on Vercel project `permit-denied` (team Columbia Cloudworks LLC). Git integration deploys `main` to production and PRs to preview URLs. IONOS is the registrar only; nameservers are Vercel. `.vercel/` is a local link and stays gitignored.
- `main` is ruleset-protected: no direct pushes; changes go through PRs. `/release` is the ship command.
- GitHub API for this repo uses the `user-github-columbia` MCP (Columbia-Cloudworks-LLC org token). Do not use `user-github-viralarchitect` for this repo. Leave the one-token GitHub plugin disabled.
