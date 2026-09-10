---
id: TASK-103
title: >-
  Refresh open files, the explorer and diffs when the working tree or history
  changes
status: Done
assignee:
  - '@claude'
created_date: '2026-09-10 07:44'
updated_date: '2026-09-10 09:24'
labels:
  - frontend
  - server
dependencies: []
ordinal: 107000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Nothing currently notices when files on disk or the repo's commits change: there are no filesystem watchers anywhere in src, and the file/history/diff queries use staleTime: Infinity (use-git-tree, use-git-commit, use-task-diff) or 30s (file search). So an open file, the explorer's file tree, the code-review diff and the commit list all go stale while an agent edits, commits or rebases, until the user reloads or navigates away and back. Design a change-notification mechanism and wire the views to it. Likely shape: a per-task server-side watcher (fs.watch on the task's cwd, which on macOS is FSEvents underneath; plus .git/HEAD, refs/ and index for history changes), debounced, that emits a WebSocket message such as 'fs-changed' with the task id and coarse categories (files, repo) and optionally the affected paths; on the client, invalidate the matching TanStack queries (file content for open tabs, file tree, task diff, log/tree/commit) so they refetch. Consider: ignoring node_modules and .git object churn, coalescing bursts while an agent is writing, not refetching views that are not mounted, preserving scroll/selection and unsaved editor state in an open file, and only watching tasks that have a live checkout (an evicted worktree has nothing to watch). A cheap alternative for the history side is polling HEAD/index mtimes on the existing harvester tick, but the file side needs a watcher.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Editing a file on disk (outside the browser) updates an open file tab in the browser within a couple of seconds, without a reload
- [x] #2 Creating or deleting files updates the explorer's file tree
- [x] #3 A new commit, checkout or rebase in the task's worktree updates the commit list and the code-review diff
- [x] #4 Bursts of changes (an agent writing many files, a checkout touching hundreds of paths) result in a bounded number of refetches
- [x] #5 Watchers are torn down when a task is suspended, evicted, archived or deleted; no watcher leaks across daemon lifetime
- [x] #6 Only mounted views refetch; nothing fires for tasks nobody is looking at beyond the cheap watcher itself
- [x] #7 Tests cover the server-side debounce/coalescing and the client-side invalidation mapping
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SERVER. 1. New src/lib/tasks/watcher.ts: TaskWatcher(taskId, dirs, onChange). Recursive fs.watch on the checkout root (worktree_path, else cwd) and on the repository's metadata dir plus its common dir (rev-parse answers both, through the spawn helper in api/utils). Event kind is ignored (Bun reports every event as rename); only the path is classified: under the metadata dirs it counts as a history change when it is HEAD, ORIG_HEAD, packed-refs, or under refs/, and is ignored for objects/, lfs/, index, logs/, *.lock. Under the checkout it counts as a file change unless a path segment is the metadata dir or node_modules, or the path is under .claude/worktrees (the main checkout contains every other worktree). 2. Coalescing: pending {files: Set, history: boolean} per task; flush 250ms after the last event and no later than 1s after the first, so a long stream still flushes in bounded batches. Over 200 files the list becomes null (everything). Emits one WebSocket message of type 'changed' with taskId, files (string[] | null) and a boolean history flag. 3. Lifecycle: TaskManager.reconcileWatchers() computes the desired set (live rows whose checkout exists on disk) and starts/stops watchers to match. Called from broadcastTasks and broadcastTask, which every lifecycle transition already ends in, and at the end of reconcileOnBoot. stopWatchers() on shutdown. A watcher that errors (ENOENT, EMFILE) logs once and is dropped; the task keeps working without refresh. CLIENT. 4. src/frontend/change-invalidation.ts: pure invalidationsFor(msg) to query keys. Files: ['tasks', id, 'files'], ['tasks', id, 'diff'], ['tasks', id, 'files-search'] and each ['tasks', id, 'file', path] (or the ['tasks', id, 'file'] prefix when files is null). History: the log key, the refs key, and ['tasks', id, 'diff'] (HEAD moved, so the working-tree diff's base did). The tree and file-at-sha keys are keyed by immutable sha and left alone. 5. TaskContext onMessage: on 'changed', queryClient.invalidateQueries for each key; the default refetchType 'active' is what keeps unmounted views quiet. TESTS. 6. watcher.test.ts against a real temp dir: classification and ignore rules, coalescing (two writes give one message), the 1s cap, null over 200 files, close() stops delivery. change-invalidation.test.ts for the mapping. manager.test.ts: a live task gets a watcher, suspend and delete stop it, reconcile is idempotent.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented in two halves, server and client.

SERVER: src/lib/tasks/watcher.ts holds TaskWatcher/startTaskWatcher - a recursive fs.watch on the checkout and on the repository metadata dirs, classified by path alone since Bun reports every event as a rename, coalesced with a 250ms settle and a 1s cap into one ChangeBatch {files, history} per burst, with the file list collapsing to null past 200 paths.

Ignored under the checkout: .git, node_modules and .claude/worktrees; under the metadata dirs: objects/, logs/, index and lock files. TaskManager.reconcileWatchers() keeps the watcher set equal to the live tasks whose checkout exists on disk, so no lifecycle site has to remember to stop one; each batch goes out as a 'changed' message carrying taskId, files and history.

CLIENT: src/frontend/change-invalidation.ts is a pure invalidationsFor(message) mapping the batch to query keys - files to tasks/id/files, tasks/id/diff, the tasks/id/files-search prefix, and either each tasks/id/file/path or the tasks/id/file prefix when the list is null.

History maps to git-log/id, git-refs/id and the diff again (HEAD moved, so the working-tree diff base moved with it), deduplicated so the diff is named once. git-tree, git-file and git-commit are deliberately left alone: they are keyed by an immutable sha, whose content cannot change.

TaskContext.tsx feeds each key to the shared queryClient.invalidateQueries, whose default refetchType of 'active' is what keeps unmounted views quiet. TESTS: watcher.test.ts (classification, coalescing, the cap, overflow, close), change-invalidation.test.ts (five mapping cases), TaskContext.render.tsx (the frame reaches the shared query client).

manager.test.ts gains a 'checkout watchers' block: nothing watched without a client, the last client leaving stops them, suspend and delete stop them, reconcile is idempotent, stopWatchers empties the set. One behaviour found while testing: deleteTask is the single lifecycle call that does not broadcast for itself - its route broadcasts immediately after, and the reconcile rides that broadcast.

ACs 1-3 are verified in a browser by the main session and are left unchecked here. Watchers are tied to client connections rather than started at boot: reconcileWatchers runs from registerClient/unregisterClient and the two broadcast paths, and a daemon with no browser attached watches nothing.

Post-review fixes: watcher root is repo_root (routes speak repo-relative paths) and a changed root restarts the watch; broadcastTask reconciles one row instead of walking all live rows; a failed watch is retried after 30s; metadata dirs are watched shallow plus refs/ recursive; ignored paths are dropped per batch via check-ignore (fail-open); history invalidates refs only and the existing refs-hash effect resets the log; query keys live in frontend/query-keys.ts and are shared by the hooks and the invalidation map.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Open files, the explorer tree, the working-tree diff and the commit list now refresh on their own when the checkout or its history changes. Server: src/lib/tasks/watcher.ts watches each live task's checkout and repository metadata with recursive fs.watch, classifies paths (user files versus HEAD/refs, ignoring objects, logs, index, locks, .git, node_modules and other worktrees), coalesces bursts (250ms settle, 1s cap, null past 200 files) and the manager broadcasts one 'changed' message per batch. Watchers are reconciled from the client register/unregister and broadcast paths, so they exist only for live tasks while a browser is attached. Client: change-invalidation.ts maps a message to TanStack query keys and TaskContext invalidates them; only mounted queries refetch. Verified with watcher, manager and invalidation tests, and in a browser against an isolated server: an outside edit appeared in the open tab within a second, a new file appeared in the tree, and a moved ref appeared on the commit list.
<!-- SECTION:FINAL_SUMMARY:END -->
