---
name: stacked-pr
description: >
  Open work as a PR stack: a chain of separate branches and separate GitHub
  pull requests, each based on the layer under it. Use when the user asks for
  a stacked PR, a PR stack, a stacked release, stacked pull requests, multiple
  dependent PRs, or to release as a stacked PR. Do not use for /release, and
  do not treat several commits on one branch as a stack.
---

# Stacked pull requests

This file is the canonical procedure. `/release` (`.cursor/commands/release.md`) is a different command: one versioned pull request into `main`.

## Terms

**PR stack / stacked pull requests.** Several branches and several pull requests in a dependency chain. The bottom pull request targets `main`. Each later pull request targets the branch directly under it.

```text
main
  └─ layer-a   → PR A, base: main
       └─ layer-b   → PR B, base: layer-a
            └─ layer-c   → PR C, base: layer-b
```

Same chain, read from the integration branch: `main ← PR A ← PR B ← PR C`.

**Stack layer.** One branch and its pull request.

**Release stack.** That full ordered chain when the user asked to release the work as stacked pull requests. It is still multiple pull requests. It is not `/release`.

**Aggregate PR / monolithic PR.** One pull request that holds several changes that could have been separate layers. Several commits on that one branch do not make it a stack.

**Stacked commits.** More than one commit on a single branch. Stacked commits are not stacked pull requests.

## When this applies

Follow this skill for a stacked PR, a PR stack, a stacked release, stacked pull requests, multiple dependent PRs, or the same request in different words.

Do not follow it for an ordinary fix, a single pull request, or `/release`. Those stay one branch into `main`, with the version bump only on `/release`.

## Shape the stack before editing

Read the issues and the code they touch. Group by dependency, not by issue number.

- One layer is one coherent purpose, a focused diff, its own acceptance criteria, its own tests, and a revert boundary.
- Put issues in the same layer when they are the same change and splitting them would leave a broken tree.
- Split one issue across layers when it crosses a real boundary (model, then simulation, then presentation).
- Do not invent a chain for independent work. Independent groups can be separate stacks, or separate pull requests into `main`.
- Do not add empty layers to raise the pull request count.
- Name each branch for that layer. Cloud agents still use the session branch template (`cursor/<layer>-f92a`).

Write the branch list and the base of each pull request down before the first commit.

## Build the chain

1. Run `npm run repo:preflight`. The first branch starts from fetched `origin/main`. Later branches start from the previous layer's branch, not from `main`.
2. Implement only that layer. Commit it. Push it: `git push -u origin <branch>`.
3. Open the pull request with `.github/PULL_REQUEST_TEMPLATE.md`. The first base is `main`. Every later base is the branch under it. Set `base_branch` explicitly.
4. Confirm the GitHub diff is only that layer. `gh pr diff <number>` (or the PR files tab) must not repeat the parent layer. If it does, the base is wrong.
5. If a lower layer changes, update the branches above it (merge or rebase that layer into its children), re-run the tests those changes affect, and check each pull request still shows only its own diff. Do not leave the chain diverged.
6. Merge bottom-up: A, then B, then C. After a layer merges, point the next pull request at `main` (GitHub does this when the merged base branch is deleted). Do not merge a child before its parent. Do not squash the whole chain into one review.

Prefer `gh stack` when `gh stack --help` succeeds. This repo's GitHub CLI is 2.99, which does not include `gh stack` until `gh extension install github/gh-stack`. If that command is missing, use ordinary `git` and `gh pr create --base <parent-branch> --head <layer-branch>`. The branch and base topology is the requirement. The command name is not.

GitHub writes for this repo go through the `user-github-columbia` MCP or `ManagePullRequest` when that is the session's pull-request tool. Do not use `user-github-viralarchitect`.

## Issues

Name the issues that layer actually finishes. Use `Fixes #N` only when merging that pull request completes the issue. Do not attach every issue to the bottom pull request.

## Verification

Each layer gets the checks that match its diff: `npm test` for behavior, `npm run check` when types change, `npm run build` when packaging or the client entry changes, and a manual pass when the layer is visible. Tests added in a later layer do not excuse a broken earlier layer. Say in the pull request when a layer cannot run alone, and name the parent it needs.

## Previews

`.github/workflows/ci.yml` and `.github/workflows/title-screenshot.yml` run for every internal pull request, whatever the base branch is. After Linux and Windows checks, that pull request's head gets its own Vercel preview. Fork pull requests run checks and do not deploy.

Validate a layer on its own preview. A preview of only the top branch does not verify the lower pull requests.

## Pull request text

Keep the template. Also state the layer:

```text
Stack: 2 of 4
Depends on: #123
Next: #125
```

Fill the numbers after the pull requests exist. Include purpose, issues, the parent dependency, what you tested, the preview, and anything you left for a later layer.

## Version bump

`/release` still owns `1.0.N`. A release stack does not bump the version on every layer, and it does not title every layer `Release 1.0.N`.

Put the bump on the one layer that should ship, usually the top of the stack or a `/release` pull request opened after the chain is reviewed. Merging an earlier layer to `main` deploys the previous version number until that bump lands. Say that in the earlier pull request if it will merge first.

## Done

A stacked-PR request is done only when all of these are true:

1. Several branches exist when the work has several layers.
2. Several pull requests exist.
3. The bottom pull request targets `main`.
4. Each later pull request targets the branch under it.
5. Each pull request's diff is only that layer.
6. Each layer was verified on its own.
7. Issue links match the layer that finishes them.
8. Each internal pull request has its own preview, or the pull request says why it does not.
9. The descriptions name the stack position and the parent.
10. A reviewer can read bottom to top without opening one aggregate diff.

One pull request with many commits does not meet this list.

## Do not

- Call an aggregate pull request a stacked PR.
- Target every layer at `main` while the parents are still open.
- Merge a child first.
- Rewrite a published branch with a force push just to redraw history. If a branch already on GitHub is one aggregate commit and splitting it means a force push, leave it, say so, and use this procedure for the next stack.
