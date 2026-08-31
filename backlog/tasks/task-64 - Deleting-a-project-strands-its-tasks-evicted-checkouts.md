---
id: TASK-64
title: Deleting a project strands its tasks' evicted checkouts
status: Done
assignee:
  - '@claude'
created_date: '2026-08-31 08:07'
updated_date: '2026-08-31 08:41'
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
- [x] #1 A task whose project was deleted can still be reopened, or is told plainly why it cannot and what to do about it
- [x] #2 Its checkout is reclaimable rather than pinned on disk forever
- [x] #3 A restore lands on the directory the row records, never on a path recomputed from a project the task no longer belongs to
- [x] #4 Tests cover reopening and evicting a task after its project is deleted
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Verified first: `repo_root` is `--show-toplevel` resolved from `cwd` (manager.ts:542), so for a worktree task it names the *checkout's* own root and dies with it — nothing on the row survives eviction. And on a scratch repo `worktree list`, `worktree add` and `update-ref` all work from a `.git` directory while `rev-parse --show-toplevel` fails there, so the column holds the repository ROOT, not the common dir: a `.git` value would break anything re-deriving the root.

1. Migration `006_tasks_worktree_repo`: `worktree_repo TEXT` on `tasks` — the repository the checkout was added to. Nullable, added to UPDATABLE_COLUMNS and INSERT_COLUMNS. No SQL backfill: `projects.initial_path` may be tilde'd while a resolved root never is, and two shapes in one column is worse than a null.

2. Written at create. `CreatedWorktree` gains `repoRoot` — `createWorktree` already resolves it and throws it away — and `createTask` stores it beside `worktree_path` and `branch`.

3. Two ways older rows get one:
   - `deleteProject` stamps `worktree_repo` on every worktree-holding task of the project BEFORE reassigning them to General. That is the exact event that strands a task, so closing it there fixes every task that exists today rather than only new ones. (Approved explicitly; it does mean a git lookup per worktree task inside deleteProject.)
   - A lazy resolve-and-write-back for any other null: resolve from the project, store it, use it. Self-heals on first touch and stores the same resolved shape as (2).

4. Readers stop going through the project. `restoreTaskWorktree` and `doEvict` take the root off the row; `restoreWorktree` and `evictWorktree` take a repo root directly instead of a project path, dropping their `repoRootOf` calls.

5. Restore lands on the recorded path. `restoreWorktree` recomputes `worktreePathFor(project.id, task.id)`, which for a reassigned task yields a different directory from the one on the row — it takes `worktreePath` as an argument now. Second half of the same bug; it would otherwise survive the fix.

6. A task with no root and no project fails honestly: a new `WorktreeErrorKind` `repo-unknown` saying the project was removed and the work is still on its branch, so the resume route's 409 carries something actionable. Only rows stranded before this ships can reach it.

7. Tests: delete a project holding an evicted task then reopen it (the headline case); the same for evict; a restore landing on the recorded path after a project change; the lazy backfill filling a null.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**The column holds *a directory inside* the repository, not the toplevel exactly.** That is what lets `deleteProject` stay synchronous: every consumer runs `git -C <this>`, which resolves the repository from anywhere inside it, so requiring the toplevel would force a `rev-parse` before the value could be written — in the one operation that most needs to stamp one. A create stores the toplevel git already resolved on its way to the lock; `deleteProject` stamps the project's own directory. Both are valid and they genuinely differ, which macOS makes unmissable (`/var` vs `/private/var` through the symlink) — so the tests ask git whether two paths name the same repository rather than comparing strings.

A working directory and not the git common dir, though: `worktree add`, `worktree list` and `update-ref` all work from a `.git` directory, but `rev-parse --show-toplevel` does not, so a `.git` value would break anything re-deriving the root. Checked on a scratch repo rather than assumed.

**Restore now lands on the row's `worktree_path`** instead of recomputing `worktreePathFor(project.id, task.id)`. For a task reassigned to General that expression answers with a *different* directory, so the restore would have rebuilt beside the work rather than onto it — the second half of the same bug, and it would have survived a fix that only addressed the repository lookup.

**`repo-unknown` is its own error kind.** `not-a-repo` means 'that directory is not a repository', which the user fixes by pointing at one; this means 'we have lost track of yours', and the message names the branch the work is still on. Only a row stranded before this shipped can reach it: new tasks record their repository at create, `deleteProject` stamps the ones that exist now, and anything else heals from its project on first touch.

**Migration ordering took a failing suite to get right.** `006` has to come after `005`, which rebuilds `tasks` from an explicit column list — a column added ahead of it exists only until that rebuild fires, which it does on any database still carrying `repo_root NOT NULL`. `db.test.ts`'s schema and migration-name assertions are what caught it.

Verified the tests fail without the fix: with `repoRootFor` no longer reading the column, both 'after its project is deleted' cases fail.

837 unit + 100 render, 0 fail; `tsc --noEmit` clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A task now records the repository its checkout was branched from, so it can outlive its project. New `tasks.worktree_repo` (migration 006, after 005 because that one rebuilds the table): written at create from the root `createWorktree` already resolves, stamped by `deleteProject` on every worktree-holding task before they are reassigned to General, and healed from the project on first touch for anything older. `restoreWorktree` and `evictWorktree` take that root instead of a project path, and restore lands on the row's `worktree_path` rather than a path recomputed from a project the task may no longer belong to. A row that has neither — stranded before this shipped — fails with a new `repo-unknown` kind naming the branch its work is still on, instead of a generic 409 forever. Six tests, two of which were checked to fail without the fix; 837 unit + 100 render, 0 fail, `tsc --noEmit` clean.
<!-- SECTION:FINAL_SUMMARY:END -->
