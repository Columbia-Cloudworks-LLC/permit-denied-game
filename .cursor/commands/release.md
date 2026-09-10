---
name: release
description: Open a PR from local changes against main, babysit CI, merge, then checkout and sync main.
---

# Release

Ship the current worktree to production. Production is https://permitdenied.app (Vercel deploys `main`).

## Do

1. Inspect git state in parallel: status, diff, log, and whether this branch tracks a remote.
2. Include **all** remaining uncommitted work except secrets, binaries, and artifacts.
   - Never commit `.env`, credentials, `dist/`, `*.exe`, `.vercel/`, or `node_modules/`.
   - Do not update git config. This worktree is untrusted: pass `safe.directory=C:/Users/viral/PERMIT-DENIED` per command instead.
3. If HEAD is `main` (or the branch has no PR yet), create a focused branch, commit, and push with `-u`.
4. Open a PR against `main` using `.github/PULL_REQUEST_TEMPLATE.md`. Use the `user-github-columbia` GitHub MCP. If that namespace is unavailable, fall back to `gh` after `. $HOME\.cursor\Use-GitHubPat.ps1` and `Use-GitHubPat columbia-cloudworks-llc`. Do not use `user-github-viralarchitect` or a leftover `GH_TOKEN`.
5. Return the PR URL, then babysit CI until every required check is green.
   - Source of truth: `gh pr checks` (or the matching MCP check list). Watch pending checks; diagnose and fix failures; push and re-check.
   - Do not skip hooks. One retry for a proven flake. If main already has the fix, merge main into the branch instead of duplicating it.
6. Merge when the PR is merge-ready (required checks green, no unresolved blocking review). Prefer the repo default; squash when the PR is one logical change.
7. `git checkout main`, fetch, and fast-forward to `origin/main`. Confirm a clean tree on `main`.
8. Tell the user the PR URL, merge SHA, and that Vercel will publish https://permitdenied.app from `main`.

## Do not

- Push to `main` directly.
- Commit unless this command is running (this command **is** the ask to commit).
- Leave the user on the feature branch after a successful merge.
- Mix GitHub MCP and `gh` for the same operation.

If there is nothing to ship (clean `main`, in sync with origin, no open PR for leftover commits), stop and say so.
