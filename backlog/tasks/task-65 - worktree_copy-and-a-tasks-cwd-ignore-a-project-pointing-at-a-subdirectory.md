---
id: TASK-65
title: worktree_copy and a task's cwd ignore a project pointing at a subdirectory
status: To Do
assignee: []
created_date: '2026-08-31 09:02'
labels:
  - server
  - git
  - bug
milestone: m-5
dependencies: []
ordinal: 65000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by code review during TASK-64; pre-dates it — the behaviour arrived with TASK-29/30.

A project's `initial_path` need not be a repository root. Pointing one at `repo/frontend` is a reasonable thing to do, and two things then go to the wrong place:

- **`worktree_copy` resolves against the repository root.** `createWorktree` calls `repoRootOf(project.initial_path)`, which walks *up* to the toplevel, and then `copyProjectFiles(project, repoRoot, worktreePath)` reads each entry relative to that. So a `.env` sitting beside the project at `repo/frontend/.env` is looked for at `repo/.env` and never found — silently, since a missing source is skipped rather than failing. `restore.ts` has the identical shape.
- **The task's `cwd` becomes the worktree root**, not the subdirectory the user pointed at, so the agent starts somewhere they never chose.

The first is a plain bug. The second is a design call and is why this is a task rather than a patch: a worktree of `repo` checked out for a project rooted at `repo/frontend` could reasonably put the agent in `<worktree>/frontend`, which means recording the offset from the toplevel at create and applying it to the cwd, the copy sources and the copy destinations alike. Restore has to reach the same answer, and it now resolves from `worktree_repo` rather than from the project — so whatever is recorded has to be enough for both.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A worktree_copy entry names a path relative to the project's directory, not the repository root, on create and on restore
- [ ] #2 A task whose project points at a subdirectory starts its agent in the matching subdirectory of the checkout
- [ ] #3 A project pointing at a repository root behaves exactly as it does today
- [ ] #4 Tests cover a project rooted below the toplevel, for create, restore and the copy list
<!-- AC:END -->
