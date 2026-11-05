---
type: Module
title: Change watcher and shared watch streams
description: Each live task's TaskWatcher folds file and ref events into changed batches for the browser, over fs.watch streams shared per directory through a refcounted WatchPool, and only while a browser is connected; the browser refetches what they stale and flashes the rows and lines that changed.
tags: [module, watcher, fs-watch, tasks, invalidation]
level: project
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-04T08:00:00Z }
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
  - id: pulse-store
    resource: ../../src/frontend/change-pulse-store.ts
    title: src/frontend/change-pulse-store.ts
  - id: changed-lines
    resource: ../../src/frontend/hooks/use-changed-lines.ts
    title: src/frontend/hooks/use-changed-lines.ts
  - id: task-136
    resource: "../../backlog/tasks/task-136 - Changed-rows-highlight-and-fade-as-an-agent-edits-files.md"
    title: "TASK-136 — Changed rows highlight and fade as an agent edits files"
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

# Change highlighting

The same frame tells the user where the work is happening (TASK-136). Rows and lines that just changed get a blue wash (`--changed`) that holds briefly and fades over three seconds.[^task-136]

- **List rows** (the Explorer's Changes, Files and Backlog sections, and the tree in a working-tree diff tab) are driven by the frame, not by comparing list data: an edited file's row in the Files tree looks exactly as it did, and only the watcher knows it moved. `change-pulse-store.ts` records each frame's paths per root, for the same roots the invalidation reaches. An overflow (`files: null`) records nothing, because lighting every row says nothing about where.[^pulse-store]
- **Lines** (a file tab's source view, and the hunks of a working-tree diff) are driven by comparing content, because the frame names files, never lines. `useChangedLines` diffs the lines it drew last against the new ones: it trims the common prefix and suffix, runs an LCS over the middle under a size cap, and falls back to counting lines past it.[^changed-lines]

What does not flash, and why:

- A list starts quiet. Its baseline is the moment it mounted, or was pointed at another root (the Explorer is not keyed by root, so a task switch has to reset it too), so a tab switched back to, or a section the rail just opened, shows nothing for a change it was not open for. A row that *appears* because of the change (a new file in Changes) belongs to a list that was already mounted, and flashes as it arrives. Where the list itself is swapped out for an empty state (the working-tree diff tab's "No changes detected"), the component that stays holds the baseline (`useChangeBaseline`) and hands it down.
- Context lines a new hunk brings into a diff: nobody wrote them, so in a diff only the added and removed lines light, unless nothing else did (a reverted edit leaves no line of its own, and the one standing there is the only cue).
- A refetch that changed nothing: no frame means no pulse, and identical lines compare equal.
- A commit's file or diff: those views are fixed, and moving between commits is not an edit. Only the working-tree consumers opt in.
- Writes to ignored paths flash their own rows but do not light a collapsed ancestor, or a build writing `dist/` would keep every ancestor lit for as long as it runs.

A collapsed directory stands in for the rows it hides, using a pulse of its own that is recorded once per frame for every ancestor of a changed path.

A repeat change restarts the fade. Two identical keyframes under two names are alternated by a per-path count, because changing `animation-name` is what makes a browser restart a running animation. The count has to be per path: a store-wide counter let the changes to other paths in between decide the parity, and a row's second change could land on the class it already had and not flash at all. Under reduced motion the wash holds for the whole window and then goes in one step.[^pulse-store]

# Related

How ignored paths are reported and who reads them: [File listing and ignored files](/modules/file-listing.md). The pool's stream and subscription counts are in `GET /api/diagnostics`: [Diagnose daemon memory](/runbooks/diagnose-daemon-memory.md).

[^watcher]: src/lib/tasks/watcher.ts
[^watch-pool]: src/lib/tasks/watch-pool.ts
[^manager]: src/lib/tasks/manager.ts
[^task-103]: TASK-103 — Refresh open files, the explorer and diffs when the working tree or history changes
[^task-135]: TASK-135 — Share fs.watch streams between tasks watching the same directories
[^task-136]: TASK-136 — Changed rows highlight and fade as an agent edits files
[^pulse-store]: src/frontend/change-pulse-store.ts
[^changed-lines]: src/frontend/hooks/use-changed-lines.ts
