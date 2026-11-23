---
type: Module
title: Archive and unarchive
description: Archive suspends a task, snapshots its worktree to a WIP ref kept 30 days, removes the checkout and deletes the branch only when merged or pushed; unarchive recreates a deleted branch, flips the row to suspended and resumes it, which rebuilds the checkout and applies the snapshot.
tags: [module, tasks, worktrees, archive, lifecycle]
level: project
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-23T16:59:19Z }
sources:
  - id: archive
    resource: ../../src/lib/tasks/archive.ts
    title: src/lib/tasks/archive.ts
  - id: route
    resource: ../../src/api/tasks.ts
    title: src/api/tasks.ts
  - id: types
    resource: ../../src/lib/xtmux/types.ts
    title: src/lib/xtmux/types.ts
  - id: wip
    resource: ../../src/lib/worktree/wip.ts
    title: src/lib/worktree/wip.ts
  - id: restore
    resource: ../../src/lib/worktree/restore.ts
    title: src/lib/worktree/restore.ts
  - id: summaries
    resource: ../../src/frontend/unarchive-summary.ts
    title: src/frontend/unarchive-summary.ts
  - id: architecture
    resource: ../../docs/v2-architecture.md
    title: docs/v2-architecture.md §5.6 and §6
  - id: task-139
    resource: "../../backlog/tasks/task-139 - Unarchive-a-task-restore-its-worktree-from-the-archive-snapshot-and-resume.md"
    title: "TASK-139 — Unarchive a task: restore its worktree from the archive snapshot and resume"
---

# What archive keeps

Archive is the explicit, confirmed way a task leaves the list (§6).[^architecture] `TaskManager.archiveTask` runs in this order, and the order is what makes it recoverable:[^archive]

1. Suspend a live task through `suspendTask`.
2. Read the branch status while the checkout is still there to read.
3. Snapshot the working tree to `refs/codetoaster/wip/<task-id>`, always, clean or dirty, through a throwaway index so the live tree is not touched.[^wip] A failed snapshot aborts the archive with nothing removed.
4. Remove the checkout, keeping the branch.
5. Delete the branch only when its commits survive it: merged into `base_ref`, or contained in some remote. A branch with no commits of its own counts as merged, so archive usually deletes it.
6. Remove `~/.codetoaster/tasks/<id>/`.

The row stays, with `lifecycle = archived`, `worktree_state = evicted` (or `none` for a task that ran in the project directory), and `worktree_path`, `branch`, `base_ref` and `wip_at` remembered. `wip_at` is restamped at archive time, because retention runs from the archive.

Archiving does not move the task's project in the sidebar (TASK-141). The `rank_at` stays on the archived row, and every `tasks` snapshot carries each project's `rankAt`: `TaskStore.projectRanks`, the highest `rank_at` among all its tasks, archived ones included. `groupByProject` orders the groups by the newer of that and the project's live tasks' own ranks, which `activity` frames and `task` deltas move between snapshots. So archiving the top task leaves its project where it was, a project whose tasks are all archived keeps its place instead of falling to the never-used projects at the bottom, and a wake still lifts its project at once.[^archive]

# Retention

`expireArchivedWip` runs once at boot and drops the WIP ref of every archived task whose `wip_at` is more than `WIP_RETENTION_MS` (30 days) old. It touches archived rows only: a suspended task's ref is where its work is stored, not a grace period. It clears `wip_ref` and keeps `wip_at`, which is the only record that there was a snapshot to lose. It skips a task with an unarchive in flight.[^archive]

The archive confirmation ends with "It can be unarchived, uncommitted work included, until <date>": today plus `wipRetentionDays` from the preview (`archiveSummary` takes the clock and the date formatter as parameters).

# Unarchive

`GET /api/tasks/:id/unarchive` returns an `UnarchivePreview`; `POST` performs it and answers `{ task }` with the resumed task. Both answer 404 for an unknown task and 409 for one that is not archived; a `WorktreeError` is a 409 with its `kind`.[^route] [^types]

`planUnarchive` reads git, not the row, and serves both. It chooses the checkout by how much of the work each option keeps:

| `checkout` | When | Branch recreated at |
|---|---|---|
| `none` | the task ran in the project directory | (nothing to rebuild; resume only) |
| `restore` | the branch still exists | (left alone) |
| `from-snapshot` | branch gone, WIP ref present | the snapshot's parent, so HEAD equals `wip.parent` and the restore applies it |
| `from-remote` | branch gone, no snapshot, `origin/<branch>` exists | that commit |
| `from-base` | none of the above | `base_ref` (or `HEAD`); the branch's own commits and the dirt are lost |

The snapshot is reported separately. `kept` means the ref exists, so the restore will apply it. `expiresAt` can already be in the past on a daemon that has not restarted, and `stale` means the branch has moved off the snapshot's parent, so the restore will hold it back for apply or discard. `expired` means the row has `wip_at` or `wip_ref` but git has no ref. `none` means no snapshot was ever recorded.

Expiry is the sweep dropping the ref, not the clock passing. If the preview called a snapshot past its date "expired" while the ref still existed, the dialog would say the work was lost and the restore would then apply it. Dropping the ref at the click to match would destroy work that could still be recovered.

`unarchiveTask` then:[^archive]

1. Recreates a deleted branch (`git branch <name> <commit>`, under the repository lock). A failure throws `branch-recreate-failed` and changes nothing.
2. Sets `lifecycle = suspended`, keeping `worktree_state = evicted`, and stamps `rank_at` so the task returns at the top of the list even if the resume never reaches the ladder's own stamp. An archived task with a checkout is the same as an evicted one waiting to be rebuilt.
3. Broadcasts the list and returns `resumeTask`. The ladder's `restoreTaskWorktree` rebuilds the checkout and applies the snapshot.[^restore] `spawnAgent` rewrites the settings file on every spawn, so the task directory archive removed comes back with it.

A failure after step 2 leaves the task suspended and evicted, with its branch and snapshot intact, so it can be opened again from the live list. Putting it back to `archived` would put its snapshot back on the retention timer.

`resumeTask` still refuses an archived row. Unarchive is the only way back.

# Serialization

Unarchive is the fifth of the per-task in-flight maps (`resuming`, `suspending`, `evicting`, `archiving`, `unarchiving`). A second unarchive joins the first. An archive waits for an unarchive in flight and then archives the live task it produced; an unarchive waits for an archive in flight and then starts over. Each consults the other's map before registering in its own, so neither can wait on the other. `evictTask` refuses during an unarchive.

Archive, unarchive and delete live in `src/lib/tasks/archive.ts`. The five maps live together in `inflight.ts`, shared by every lifecycle module. [TaskManager layout](/modules/task-manager-layout.md) tabulates every pairing.

# In the browser

An archived row in the sidebar's archived list carries Unarchive beside Delete. In the command palette, typing lists each archived task as "Unarchive <title>"; the list is fetched on the first keystroke. Both open `UnarchiveTaskDialog`, whose body is `unarchiveSummary(preview)`, which states what cannot come back before anything is done.[^summaries] A preview the server refused with a 409 (`repo-unknown`, `bad-base-ref`, not archived) is quoted, with a line saying the unarchive will be refused too; any other preview failure is a generic line and still lets the unarchive through. `usePreviewOnOpen` holds the fetch-on-open rules for this dialog and the archive one. Confirming posts, moves the row from `archivedTasks` into `tasks` locally (so the route does not bounce the slug), and opens the task. A failure is the request helper's toast, and refetches the archived list when it has been loaded: a restore that fails does so after the row has left `archived`.
