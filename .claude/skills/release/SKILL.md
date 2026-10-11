---
name: release
description: Bump 1.0.N, open a PR from local changes against main, babysit CI, merge, then checkout and sync main.
disable-model-invocation: true
---

# Release

Ship the current worktree to production as **one** pull request into `main`. Production is https://permitdenied.app (GitHub Actions deploys `main` to Vercel).

This skill is not a PR stack. Several commits on the release branch are stacked commits, not stacked pull requests. A request for a stacked PR, a PR stack, a stacked release, or multiple dependent pull requests follows `/stacked-pr` (`.claude/skills/stacked-pr/SKILL.md`) instead. Do not fold those layers into this single ship pull request.

Every ship **must** bump the game version. About & Credits, `build.json`, and the catalog pin read `package.json`. Prior ships bumped `package.json` / `package-lock.json` in the same PR and used the title `Release 1.0.N: …`. Do not invent another versioning scheme. Stay on `1.0.N`.

## Do

1. Run `npm run repo:preflight` first so review starts from fetched `origin/main`, then inspect remaining work in parallel: status, diff, log, and whether this branch tracks a remote. Do not treat a clean `git status` as proof the checkout is current.
2. Bump `package.json` and `package-lock.json` to the next `1.0.N` **before** the release commit.
   - Read the current `version` from `package.json` (and confirm `package-lock.json` matches).
   - Increment the patch (`1.0.15` → `1.0.16`) unless the user specified a different `1.0.N` bump.
   - Use `npm version patch --no-git-tag-version` (or `npm version <user-specified> --no-git-tag-version`) so both files stay aligned. Do not create a git tag.
   - Do **not** skip the bump because the PR is “just a feature.” A ship without a bump is incomplete.
3. Use the house title style `Release 1.0.N: <short what shipped>` for the commit subject and the PR title (same wording).
4. Commit **all** remaining intentional work except secrets, binaries, and artifacts.
   - Never commit `.env`, credentials, `dist/`, `*.exe`, `.vercel/`, or `node_modules/`.
   - Do not update git config. If git reports dubious ownership, pass `-c safe.directory=<resolved worktree path>` per command.
   - If HEAD is `main` (or the branch has no PR yet), create a focused branch from `origin/main`, commit the bump plus remaining work, and push with `-u`.
5. Open a PR against `main` with `gh pr create --base main`, filling in `.github/PULL_REQUEST_TEMPLATE.md`.
6. Return the PR URL, then babysit CI until every required check is green.
   - Source of truth: `gh pr checks <number>` (use `--watch` while checks are pending). Diagnose and fix failures; push and re-check.
   - Title Screenshot may push a bot commit to the branch and re-dispatch CI; wait for the checks on the final commit.
   - Do not skip hooks. One retry for a proven flake. If `main` already has the fix, merge `main` into the branch instead of duplicating it.
7. Merge when the PR is merge-ready (required checks green, no unresolved blocking review): `gh pr merge <number> --squash --delete-branch` when the PR is one logical change.
8. `git checkout main`, fetch, and fast-forward to `origin/main`. Confirm a clean tree on `main`.
9. Tell the user the PR URL, merge SHA, new `1.0.N`, and that CI will publish https://permitdenied.app from `main`.

## Do not

- Push to `main` directly.
- Ship without bumping `package.json` and `package-lock.json`.
- Commit unless this skill is running (`/release` **is** the ask to commit).
- Leave the user on the feature branch after a successful merge.

If there is nothing to ship (clean `main`, in sync with origin, no open PR for leftover commits), stop and say so. Do not bump the version on an empty ship.
