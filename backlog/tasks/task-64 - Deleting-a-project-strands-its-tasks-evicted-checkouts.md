---
id: TASK-64
title: Deleting a project strands its tasks' evicted checkouts
status: To Do
assignee: []
created_date: '2026-08-31 08:07'
labels:
  - server
  - tasks
  - git
  - bug
milestone: m-4
dependencies: []
ordinal: 64000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by code review during TASK-63; not introduced by it.

`deleteProject` reassigns its tasks to General, whose `initialPath` is the empty string. Every worktree operation resolves the repository through the *project's* directory — `restoreTaskWorktree` and `doEvict` both look up `this.projects.find(...)?.initialPath` — so a task that had a checkout is left in a state with no way out:

- **Reopening it always fails.** `restoreTaskWorktree` throws `WorktreeError('not-a-repo')`, which `POST /api/tasks/:id/resume` turns into a 409. Permanently, through every door: the pane, the CLI and the API.
- **Its checkout is never reclaimed.** `doEvict` bails on the same lookup, so the evict tier skips it forever and the directory stays on disk.
- And if the lookup were somehow satisfied, `restoreWorktree` would compute `worktreePathFor('general', taskId)` rather than the `worktree_path` already on the row — a second, wrong directory.

The work itself is not lost: the branch and the WIP ref are in the repository, which the user still has. What is lost is codetoaster's ability to find them.

The fix is a design decision rather than a patch, which is why this is its own task. Either a task carries enough to locate its own repository — a `repo_root` that survives eviction, noting the existing `repo_root` column holds the *worktree's* root and so is gone with the checkout — or deleting a project has to deal with its tasks' worktrees first (hand them off, or evict and remove them under confirmation), which is the same conversation archive is having in TASK-31.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A task whose project was deleted can still be reopened, or is told plainly why it cannot and what to do about it
- [ ] #2 Its checkout is reclaimable rather than pinned on disk forever
- [ ] #3 A restore lands on the directory the row records, never on a path recomputed from a project the task no longer belongs to
- [ ] #4 Tests cover reopening and evicting a task after its project is deleted
<!-- AC:END -->
