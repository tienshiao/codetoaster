---
type: Module
title: Change watcher and shared watch streams
description: Each live task's TaskWatcher folds file and ref events into changed batches for the browser, over fs.watch streams shared per directory through a refcounted WatchPool, and only while a browser is connected.
tags: [module, watcher, fs-watch, tasks, invalidation]
level: project
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-29T10:30:00Z }
sources:
  - id: watcher
    resource: ../../src/lib/tasks/watcher.ts
    title: src/lib/tasks/watcher.ts
  - id: watch-pool
    resource: ../../src/lib/tasks/watch-pool.ts
    title: src/lib/tasks/watch-pool.ts
  - id: manager
    resource: ../../src/lib/tasks/manager.ts
    title: src/lib/tasks/manager.ts
  - id: task-103
    resource: "../../backlog/tasks/task-103 - Refresh-open-files-the-explorer-and-diffs-when-the-working-tree-or-history-changes.md"
    title: "TASK-103 — Refresh open files, the explorer and diffs when the working tree or history changes"
  - id: task-135
    resource: "../../backlog/tasks/task-135 - Share-fs.watch-streams-between-tasks-watching-the-same-directories.md"
    title: "TASK-135 — Share fs.watch streams between tasks watching the same directories"
---

# What it does

A task's checkout is watched so the browser learns when its file, tree, diff and log views are stale. The server half coalesces events into one small `changed` message per burst, saying whether files changed (and which, up to a cap), whether history moved, and which of the paths the repository ignores; the client turns that into query invalidations and refetches only what it has mounted.[^task-103] [^watcher]

# Streams

A `TaskWatcher` covers three kinds of directory: the checkout recursively, each metadata directory (the task's own git dir and, for a linked worktree, the common dir) shallowly for `HEAD`, `ORIG_HEAD` and `packed-refs`, and each metadata directory's `refs/` recursively. The common dir is not watched recursively because every object every worktree writes would arrive at every task's watcher, only to be discarded.[^watcher]

The streams come from a `WatchPool`, keyed by the resolved directory and its recursion (TASK-135). Tasks in one repository ask for the same directories, so four tasks in one checkout share one recursive stream instead of holding four, and every worktree of a repository shares one stream on the common dir's `refs/`. The fold stays per task: each `TaskWatcher` subscribes, applies its own path prefix and filters, and settles its own batches.[^task-135] [^watch-pool]

- A stream closes when its last subscription closes; a task stopping leaves the others on it alone.
- A stream error drops the stream from the pool first and then reaches every subscriber, so the manager's throttled retry opens a fresh stream rather than rejoining the dead one.
- A subscription from a stream that failed closes nothing when it closes late, so it cannot take down the stream that replaced it.[^watch-pool]

# When there is a watch at all

`reconcileWatchers` gives a live task a watcher only while at least one browser is connected: a `changed` message has nobody to reach otherwise, and a daemon left running should not hold streams over large checkouts for the hours between sessions. The root is the task's `repo_root`, because every route a batch invalidates speaks paths relative to it.[^manager] Streams are therefore opened and closed with every browser disconnect and reconnect, which on Bun 1.3.9 leaked a descriptor each time; see [Bun 1.3.9 leaks a directory descriptor per closed fs.watch](/gotchas/bun-fs-watch-descriptor-leak.md).

# Related

How ignored paths are reported and who reads them: [File listing and ignored files](/modules/file-listing.md). The pool's stream and subscription counts are in `GET /api/diagnostics`: [Diagnose daemon memory](/runbooks/diagnose-daemon-memory.md).

[^watcher]: src/lib/tasks/watcher.ts
[^watch-pool]: src/lib/tasks/watch-pool.ts
[^manager]: src/lib/tasks/manager.ts
[^task-103]: TASK-103 — Refresh open files, the explorer and diffs when the working tree or history changes
[^task-135]: TASK-135 — Share fs.watch streams between tasks watching the same directories
