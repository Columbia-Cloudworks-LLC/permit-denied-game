---
name: release
description: Bump 1.0.N, open a PR from local changes against main, babysit CI, merge, then checkout and sync main.
---

# Release

Ship the current worktree to production. Production is https://permitdenied.app (Vercel deploys `main`).

Every ship **must** bump the game version. About & Credits, `build.json`, and the catalog pin read `package.json`. Prior successful ships (1.0.8–1.0.15) bumped `package.json` / `package-lock.json` in the same PR and used the title `Release 1.0.N: …`. Do not invent another versioning scheme. Stay on `1.0.N`.

## Do

1. Inspect remaining work in parallel: status, diff, log, and whether this branch tracks a remote.
2. Bump `package.json` and `package-lock.json` to the next `1.0.N` **before** the release commit.
   - Read the current `version` from `package.json` (and confirm `package-lock.json` matches).
   - Increment the patch (`1.0.15` → `1.0.16`) unless the user specified a different `1.0.N` bump.
   - Use `npm version patch --no-git-tag-version` (or `npm version <user-specified>` with `--no-git-tag-version`) so both files stay aligned. Do not create a git tag.
   - Do **not** skip the bump because the PR is “just a feature.” A ship without a bump is incomplete.
3. Use the house title style `Release 1.0.N: <short what shipped>` for the commit subject and the PR title (same wording).
4. Then commit **all** remaining intentional work except secrets, binaries, and artifacts.
   - Never commit `.env`, credentials, `dist/`, `*.exe`, `.vercel/`, or `node_modules/`.
   - Do not update git config. This worktree is untrusted: pass `safe.directory=C:/Users/viral/PERMIT-DENIED` per command instead.
   - If HEAD is `main` (or the branch has no PR yet), create a focused branch, commit the bump plus remaining work, and push with `-u`.
5. Open a PR against `main` using `.github/PULL_REQUEST_TEMPLATE.md`. Use the `user-github-columbia` GitHub MCP. If that namespace is unavailable, fall back to `gh` after `. $HOME\.cursor\Use-GitHubPat.ps1` and `Use-GitHubPat columbia-cloudworks-llc`. Do not use `user-github-viralarchitect` or a leftover `GH_TOKEN`.
6. Return the PR URL, then babysit CI until every required check is green.
   - Source of truth: `gh pr checks` (or the matching MCP check list). Watch pending checks; diagnose and fix failures; push and re-check.
   - Do not skip hooks. One retry for a proven flake. If main already has the fix, merge main into the branch instead of duplicating it.
7. Merge when the PR is merge-ready (required checks green, no unresolved blocking review). Prefer the repo default; squash when the PR is one logical change.
8. `git checkout main`, fetch, and fast-forward to `origin/main`. Confirm a clean tree on `main`.
9. Tell the user the PR URL, merge SHA, new `1.0.N`, and that Vercel will publish https://permitdenied.app from `main`.

## Do not

- Push to `main` directly.
- Ship without bumping `package.json` and `package-lock.json`.
- Commit unless this command is running (this command **is** the ask to commit).
- Leave the user on the feature branch after a successful merge.
- Mix GitHub MCP and `gh` for the same operation.

If there is nothing to ship (clean `main`, in sync with origin, no open PR for leftover commits), stop and say so. Do not bump the version on an empty ship.
