## Learned User Preferences

- Do not commit built binaries or `dist/` artifacts; CI produces packages when needed.
- When asked to put changes on GitHub, include all remaining uncommitted work except secrets, binaries, and artifacts.
- Do not commit unless explicitly asked.

## Learned Workspace Facts

- GitHub repo is `Columbia-Cloudworks-LLC/permit-denied-game` with default branch `main`. The old `viralarchitect/permit-denied-game` URL redirects here.
- This worktree is an untrusted git directory; use a per-command `safe.directory` override (`C:/Users/viral/PERMIT-DENIED`) instead of changing git config.
- Stack is TypeScript + Vite + PixiJS v8 (browser). Simulation is world-space; isometric projection is render-only.
- `main` is ruleset-protected: no direct pushes; changes go through PRs.
- GitHub API for this repo uses the `user-github-columbia` MCP (Columbia-Cloudworks-LLC org token). Do not use `user-github-viralarchitect` for this repo. Leave the one-token GitHub plugin disabled.
