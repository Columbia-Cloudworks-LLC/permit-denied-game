---
name: stacked-pr
description: Open a PR stack (separate branches and pull requests). Not one multi-commit pull request, and not /release.
---

# Stacked pull request

Follow `.cursor/skills/stacked-pr/SKILL.md`. That file is the procedure.

A stacked PR is a chain: the first pull request targets `main`, and each next pull request targets the branch under it. Several commits on one branch are stacked commits, not a PR stack. Do not collapse the work into `/release` or into one aggregate pull request.
