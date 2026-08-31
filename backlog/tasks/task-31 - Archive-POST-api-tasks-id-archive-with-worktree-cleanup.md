---
id: TASK-31
title: >-
  Archive: always snapshot, then remove worktree; branch delete only if
  merged/pushed; hard delete
status: Done
assignee:
  - '@claude'
created_date: '2026-08-29 00:03'
updated_date: '2026-08-31 19:43'
labels:
  - server
  - api
  - tasks
milestone: m-4
dependencies:
  - TASK-38
  - TASK-14
documentation:
  - docs/v2-architecture.md
ordinal: 31000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The only way a task leaves (§5.6, §6), made recoverable. POST /api/tasks/:id/archive: close if live; write the WIP snapshot unconditionally; git worktree remove --force + prune; delete scrollback.ans and settings.json; lifecycle=archived (row kept, hidden behind the sidebar toggle). Branch: `git branch -d` semantics — delete only when merged into base_ref or pushed, otherwise keep and say so; the remote is never touched. The WIP ref is retained N days (default 30) and expired by the boot sweep. A separate POST /api/tasks/:id/delete drops the WIP ref, the row, and (if still present and merged/pushed) the branch — the only irreversible operation, with its own confirmation. The dialog states exactly what will be lost using the card's dirty/unpushed/merged counts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Archive of a live task closes it first, then snapshots WIP even when the tree is clean
- [x] #2 Archive removes the worktree and snapshot files, sets lifecycle=archived, and keeps the row
- [x] #3 The local branch is deleted only when merged into base_ref or pushed; otherwise it is kept and the response says why
- [x] #4 The remote branch is never modified
- [x] #5 The archive response/confirmation reports dirty files, unpushed commits, and merged status
- [x] #6 Hard delete drops the WIP ref and the row and requires its own confirmation; WIP refs older than the retention window are expired on boot
- [x] #7 Tests cover clean, dirty, unpushed, merged, no-worktree, and hard-delete cases
- [x] #8 Archive removes the whole of ~/.codetoaster/tasks/<id>/, not only the files it knows to name — closeTask deliberately leaves that directory behind (see its comment), so archive is where it finally goes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. `lib/worktree/status.ts` — the git facts, computed before anything is destroyed. `branchStatus(repoRoot, {branch, baseRef, worktreePath})` → `{exists, dirty, unpushed, merged, pushed}`: dirty from `status --porcelain` in the checkout (null when it is not on disk); unpushed as `rev-list --count <branch> --not --remotes <baseRef>`, which is bounded by the base so a repo with no remote does not report its whole history; merged as `merge-base --is-ancestor <branch> <baseRef>`; pushed as `for-each-ref --contains <branch> refs/remotes/` being non-empty. `branchIsExpendable = merged || pushed`.
2. `deleteBranch(repoRoot, branch)` in `lib/worktree/branch.ts`. `-D`, not `-d`: git's `-d` asks about HEAD and the upstream, and our question is base_ref or any remote — so the safety check is ours to make and `-d` would refuse cases we have already established are safe. The remote is never named (AC #4).
3. `TaskManager.archiveTask` (+ `doArchive`), guarded by an `archiving` map the way evict is, and joining an eviction already in flight. Order: suspend if live (AC #1) → read `branchStatus` while the checkout is still there → snapshot WIP unless one is already pending a decision, which *is* the snapshot → `evictWorktree` (keeps the branch) → delete the branch only if expendable → `rm -rf ~/.codetoaster/tasks/<id>/` (AC #8) → row to `lifecycle=archived`, `worktree_state=evicted`. A snapshot that throws aborts before anything is removed. `broadcastTasks`, not `broadcastTask`: the task leaves the list.
4. `archivePreview(id)` — the same status without the destruction, for the dialog.
5. Hard delete: `deleteTask` becomes async and finishes the job. The row, PTYs and grouping still go synchronously first, so the deleted-across-an-await checks elsewhere keep their tight window; then the worktree, the WIP ref, the branch (same expendable rule) and the task directory. Repo resolved from the row's `worktree_repo` via a non-write-back variant of `repoRootFor`, since the row is already gone by then.
6. Retention: `WIP_RETENTION_MS` = 30d, `expireArchivedWip()` over archived rows with `wip_at` past the window, called from `server.ts` after `reconcileOnBoot`. Archived only — a suspended+evicted task's ref is how its work is stored, not a decision.
7. Routes: `POST /api/tasks/:id/archive` and `GET /api/tasks/:id/archive` (preview); `POST /api/tasks/:id/delete` requiring `{confirm:true}`; `DELETE /api/tasks/:id` (the CLI's kill) reaching the same cleanup, and `cmdKill` saying whether the branch was kept.
8. Tests: `lib/worktree/status.test.ts` against temp repos; `lib/tasks/archive.test.ts` over clean / dirty / unpushed / merged / pushed / no-worktree / already-archived / hard-delete / retention (AC #7).

Not in scope: the confirmation dialog itself. TASK-31 is labelled server/api, the counts land on cards in TASK-32, and TASK-35 puts archive in the palette — so this task supplies what they render and no UI.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
From TASK-61 (project rename/move): archive resolves the repository from the *project's* path, and a project can now be pointed at a different repository. Its existing worktrees stay checkouts of the old one, registered in the old repo's `.git/worktrees` — their tasks keep working, since a task's cwd is its own worktree — but `removeWorktree(projectPath, …)` would then run `git -C <new repo> worktree remove <old path>` and fail, leaving the checkout and its branch behind.

Resolve the repository from the worktree instead: `git -C <worktree> rev-parse --git-common-dir` names the repository that actually owns it, whatever the project now points at. The row already carries `worktree_path`, so nothing new has to be stored.

## What landed

`lib/worktree/status.ts` — `branchStatus(repoRoot, {branch, baseRef, worktreePath})` → `{exists, dirty, unpushed, merged, pushed}`, and `branchIsExpendable = !exists || merged || pushed`. Every question fails closed: a git that did not exit 0 answers "we could not establish this is safe", never "it is safe". `unpushed` is `rev-list --count refs/heads/<branch> --not --remotes <baseRef>` — the base term is load-bearing, because `--remotes` expands to nothing in a repo with no remote and the count would otherwise be the whole history. `pushed` asks `for-each-ref --contains` over `refs/remotes/` rather than `@{u}`: a branch we made has no upstream unless the user configured one, and the question is whether the commits survive the branch's deletion, which any remote ref containing the tip answers.

`deleteBranch` in `branch.ts` uses `-D`. Git's `-d` asks about HEAD and the upstream; §5.6 asks about base_ref and any remote. The two sets overlap without containing each other, so making the decision twice by two rules gets a delete refused for reasons the dialog cannot explain.

`TaskManager.archiveTask`/`doArchive` — suspend (through `suspendTask`, so harvesting has one implementation) → read the status while there is still a checkout to read `dirty` from → snapshot unconditionally → `evictWorktree` (keeps the branch) → delete the branch only if expendable → `removeTaskDir` → `lifecycle=archived`, `worktree_state=evicted`, row kept, `broadcastTasks`. A snapshot that fails aborts before anything is removed. Its own `archiving` map; it waits on an eviction before registering, and evict/resume refuse while it holds an entry, so none of the four in-flight maps can wait on another.

**A refused snapshot is the archive's snapshot.** A `wip_ref` on a present checkout is the user's outstanding apply/keep/discard, and it is also a commit holding work — taking a fresh one would move the ref off it and answer their question by destroying what they were asked about. `wip_at` is restamped so retention runs from the archive.

`worktree_state` becomes `evicted`, not `none`. The directory is gone and the path is remembered, which is what `evicted` means; `none` means a task that never had a checkout.

## Two things the task description asked for that turned out to be already solved

- The implementation note said to resolve the repository from the worktree via `rev-parse --git-common-dir`, because archive resolving it through the *project* breaks once a project is repointed (TASK-61). TASK-64 has since added `worktree_repo` to the row, and `repoRootFor` reads it first — so the repository is already resolved off the task rather than the project, and no new git was needed. Split out a `resolveRepoRoot` that does *not* heal the row, because hard delete asks the question after the row is gone.
- The comment from TASK-64's review — that `deleteTask` strands the checkout, the branch and the WIP ref — is fixed here. `deleteTask` is now async and returns a `DeleteOutcome`; the row, PTYs and grouping still go synchronously first (several writes elsewhere re-read the store across an await to notice a deleted task, and doing git first would widen that window), then `purge` takes the worktree, the branch under the same expendable rule, the ref and the task directory. `purge` never throws.

## Retention

`WIP_RETENTION_MS` = 30d, `expireArchivedWip()` fired from `server.ts` after `reconcileOnBoot`. **Archived rows only** — a suspended task's `wip_ref` is where its uncommitted work is *stored*, not a grace period, and expiring one by age would delete a user's work on a timer. `retentionMs <= 0` disables, matching the harvester's tiers.

## Validation

`bun run test`: 878 unit + 100 render, 0 fail. `tsc --noEmit` clean.

Also verified by hand against a real repo before the tests landed: a task with one unmerged commit and two dirty files previewed `dirty 2, unpushed 1, merged false`, archived with the branch kept and the sentence explaining why, left `git worktree list` clean, removed `~/.codetoaster/tasks/<id>/`, and put both the modified tracked file and the untracked one in the WIP commit.

## Not done, deliberately

The confirmation dialog itself. TASK-31 is labelled server/api, TASK-32 owns the card counts, and TASK-35 puts archive in the palette — so this supplies what they render (`GET /api/tasks/:id/archive`) and no UI. Nothing in the browser currently reaches archive.

Two branches are untested because they cannot be provoked without stubbing: `git would not delete <branch>` after `branchStatus` said it was expendable, and `expireArchivedWip`'s skip for a repository that can no longer be named.

## From the code review

Three collision fixes and the tests that hold them, all in `archive.test.ts`'s last describe:

- `archiveTask` waits on `resuming` before registering, the way it already waited on `evicting`. Without it the ladder's `suspended` row made step 1 skip the suspend, so the archive removed the directory the restore had just rebuilt with the agent inside it — and the ladder then wrote `live` back over `archived`. Waited on *before* registering, so this and `resumeTask`'s wait on `archiving` can never hold each other.
- `pendingWip`, `taskInfo.wipPending` and `discardTaskWip` all exclude `archiving`, not only `evicting`. `doArchive` writes the ref while `worktree_state` is still `present`, so for the length of the `worktree remove` the row reads exactly like a refused snapshot — and a discard landing there drops the one commit the archive's recoverability rests on. `discardTaskWip` needs its own guard because it does not go through `pendingWip`: dropping a ref needs the repository, not the checkout.
- `doEvict` verifies the directory is actually gone before writing `worktree_state = evicted`. `discardCheckout` swallows a failed `rm` and ignores the prune's exit code, and a row that says `evicted` over a checkout still on disk can never be restored — `assertPathFree` runs before `worktree prune`, on a path fixed by the task id.

The two collision windows are widened rather than raced (a delay inside `restoreTaskWorktree` and inside `snapshotTaskWip`): asserting the end state of an unwidened race asserts the schedule, and the first version of the resume test passed with the guard removed. Each of the five guards was checked by reverting it and watching a specific test fail.

Left alone deliberately: archive skips the snapshot when the row already holds a refused one (`if (onDisk && !row.wip_ref)`), so work done in that checkout *since* the refused restore goes with the eviction. Taking a fresh snapshot would answer the user's outstanding apply/keep/discard by destroying what they were asked about. The confirmation dialog has `status.dirty` and is where this should be said.

## Validation (updated)

`bun run test`: 882 unit + 100 render, 0 fail. `tsc --noEmit` clean.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude
created: 2026-08-31 09:02
---
From TASK-64's code review: `deleteTask` removes the row, the PTYs and the scrollback, and leaves the worktree entirely. `DELETE /api/tasks/:id` — the CLI's `kill` — on a task with a checkout strands the directory under `~/.codetoaster/worktrees/<project>/<task>`, its `codetoaster/<slug>` branch, and its `refs/codetoaster/wip/<id>`, none of which anything will ever reference again. This task already owns the destructive path, so the cleanup belongs with it; note that it needs `evictWorktree` (or the branch-aware removal this task is about) rather than `removeWorktree`, which deletes the branch because it exists to undo a failed create.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Archive is now the only way a task leaves, and hard delete finishes the job it used to leave half-done.

`POST /api/tasks/:id/archive` suspends the task, reads its branch status while the checkout is still there, snapshots the working tree unconditionally, removes the checkout, deletes the branch only when its commits survive elsewhere (merged into base_ref or on a remote — otherwise it is kept and the response says why, with the count), removes `~/.codetoaster/tasks/<id>/`, and leaves the row behind `lifecycle=archived`. `GET` on the same path previews all of it so a confirmation can state what will be lost. `POST /api/tasks/:id/delete` (requiring `confirm: true`) and `DELETE /api/tasks/:id` — the CLI's kill — reach the irreversible version, which now also takes the checkout, the branch and the ref that TASK-64's review found it stranding; `codetoaster kill` says when a branch was kept. WIP refs on archived tasks expire after 30 days on the next boot; a suspended task's ref, which is where its work is stored rather than a grace period, is never expired.

New: `lib/worktree/status.ts` (`branchStatus`, `branchIsExpendable`), `deleteBranch` in `branch.ts`, `TaskManager.archiveTask`/`archivePreview`/`expireArchivedWip`, `removeTaskDir`.

Verified: 878 unit tests + 100 render tests pass, `tsc` clean. 30 new tests — `status.test.ts` (12, real repos and a real bare origin) and `archive.test.ts` (18, covering clean, dirty, unpushed, merged, pushed, no-worktree, twice-archived, a refused snapshot carried into the archive, hard delete both ways, and all four retention cases). Also driven by hand end to end against a scratch repo.

Not done: the confirmation dialog. This task is server/api; TASK-32 renders the counts on cards and TASK-35 puts archive in the palette.

Then the code review: three collision fixes (archive waits on an in-flight resume; the apply/keep/discard trio all exclude `archiving`; eviction verifies the directory is gone before recording it) and four concurrency tests holding them, each mutation-checked against its guard. 882 unit + 100 render, `tsc` clean.
<!-- SECTION:FINAL_SUMMARY:END -->
