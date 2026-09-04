---
id: TASK-65
title: worktree_copy and a task's cwd ignore a project pointing at a subdirectory
status: Done
assignee:
  - '@claude'
created_date: '2026-08-31 09:02'
updated_date: '2026-09-04 21:13'
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
- [x] #1 A worktree_copy entry names a path relative to the project's directory, not the repository root, on create and on restore
- [x] #2 A task whose project points at a subdirectory starts its agent in the matching subdirectory of the checkout
- [x] #3 A project pointing at a repository root behaves exactly as it does today
- [x] #4 Tests cover a project rooted below the toplevel, for create, restore and the copy list
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Record the project's offset below the repository toplevel on the task row: new column tasks.worktree_subdir TEXT (migration 007, after 006), '' or NULL for a project at the root; add to TaskRow, INSERT_COLUMNS and UPDATABLE_COLUMNS in store.ts. 2. createWorktree computes subdir = path.relative(realpath(repoRoot), realpath(projectPath)) (realpath both sides: --show-toplevel answers the real path, and macOS tmp dirs are symlinks), copies from projectPath into join(worktreePath, subdir), and returns subdir and cwd = join(worktreePath, subdir); the manager stores worktree_subdir and uses worktree.cwd. 3. restoreWorktree takes the task's subdir (from the row) and the project's directory today as the copy source (null when the project is gone, in which case worktreeCopy is null too); copies into join(worktreePath, subdir); returns cwd, which the manager stores. 4. copyProjectFiles keeps its signature (source dir, destination dir); containment checks unchanged. 5. Tests: create.test.ts, restore coverage and lib/tasks/worktree.test.ts get a project rooted at repo/sub with a copy entry beside it — the file is copied to <worktree>/sub/<entry>, the task's cwd is <worktree>/sub on create and again after evict+restore; a root project's behaviour is asserted unchanged (subdir '' and cwd = worktreePath). db migration test covers 007 if a pattern for that exists.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented as planned, with two additions worth naming.

**Schema.** Migration `007_tasks_worktree_subdir` adds `tasks.worktree_subdir TEXT` through `addColumn`, after 006 for 006's own reason (005 rebuilds `tasks` from an explicit column list). NULL is read as '' — which is exactly what every task created before this got, since the cwd was the checkout's root. The column joins `TaskRow`, `NewTask`, `INSERT_COLUMNS`, `UPDATABLE_COLUMNS` and the store's create defaults.

**Create.** `createWorktree` computes the offset in a new `subdirOf`, with `fs.promises.realpath` on both sides (git answers `--show-toplevel` resolved; `os.tmpdir()` is behind a symlink on macOS, so an unresolved comparison would make every test here look like a project outside its own repository). It returns `subdir` and `cwd`; the manager stores `worktree_subdir` and uses `worktree.cwd` for the row.

**Restore.** `restoreWorktree` takes `repo.projectPath` (null when the project is gone — the copy list is null then too) and `task.subdir` from the row, copies into `join(worktreePath, subdir)`, and returns `cwd`, which the manager writes to the row instead of `restored.worktreePath`.

Two decisions beyond the plan:

- A new error kind `project-outside-repo` for a relative path starting with `..`. Not reachable through git — the toplevel is found *from* the project's directory — but the value is joined onto a worktree path, so it is refused rather than trusted. Left out of `api/tasks.ts`'s 400 list: it is not something a request can get wrong.
- Both create and restore `mkdir` the subdirectory when it is non-empty. git checks out only what the branch tracks, and a project directory holding nothing but ignored files (a `frontend/` that is all `node_modules` and `.env` until setup runs) is not in the branch — the agent would otherwise be spawned into a cwd that does not exist.

`copyProjectFiles` keeps its shape; its parameters are renamed `sourceDir`/`destDir` and the doc comment now says both are the project's directory and its counterpart in the checkout, not the repository root.

**Verification.** `bun run test:unit`: 1026 pass, 0 fail across 64 files. `bunx tsc --noEmit`: clean. New coverage: `create.test.ts` (subdir cwd and copy destination; the symlinked-path offset; the root project asserted unchanged at subdir '' and cwd = worktreePath), `wip.test.ts` (a restore puts a subdirectory project's files back beside it, resolving the offset from the row), `tasks/worktree.test.ts` (the manager round trip: create, evict, resume — the row's cwd and the agent's own cwd are `<worktree>/sub` both times, and the ignored `.env` is beside it), `db.test.ts` (the column in TASK_COLUMNS, 007 in the applied list, NULL for a row that does not name it). The ten `restoreWorktree` call sites in `wip.test.ts` were updated for the two new fields.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A task now records where in its checkout it works. `tasks.worktree_subdir` (migration 007) holds the project's directory relative to the repository's toplevel, written at create from a realpath-resolved `path.relative`. The agent's cwd is `<worktree>/<subdir>`, and `worktree_copy` entries are read from the project's own directory and written to the matching directory of the checkout — so a project at `repo/frontend` with a `.env` beside it gets both, where before the copy looked at the toplevel and silently found nothing and the agent started somewhere the user never chose. Restore reaches the same answer from the row alone, which it must: it resolves the repository from `worktree_repo` and the project may be gone. A project at the toplevel is unchanged (subdir '', cwd = the checkout). Verified with bun run test:unit (1026 pass, 0 fail) and bunx tsc --noEmit, with new tests for create, restore, the manager's create/evict/resume round trip, and the migration.
<!-- SECTION:FINAL_SUMMARY:END -->
