---
id: TASK-135
title: Share fs.watch streams between tasks watching the same directories
status: Done
assignee:
  - '@claude'
created_date: '2026-10-29T09:47:00Z'
updated_date: '2026-10-29T10:15:00Z'
labels:
  - backend
  - watcher
dependencies: []
priority: medium
ordinal: 137000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Every live task opens its own recursive FSEvents stream on its repo root, plus streams on the git dir and refs/, so four tasks in one repository hold four identical recursive streams on the same tree, and worktrees of one repository each watch the shared common refs/. Every browser disconnect stops all of them and the next connect reopens them; on Bun 1.3.9 each close leaked a directory descriptor, which is how a daemon with 12 live tasks came to hold 92 directory handles. One stream per directory, shared by every task that needs it, removes the duplication and the churn.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Tasks whose watchers cover the same directory with the same recursion share one fs.watch stream, and each still receives its own changed batches with the same paths as before
- [x] #2 The stream closes when the last task using it stops; a task stopping does not affect the others on the same stream
- [x] #3 A stream error reaches every task on it, the failed stream is dropped from the pool, and a retry opens a fresh one
- [x] #4 Unit tests cover sharing, refcounted close, and error fan-out; existing watcher and manager tests pass unchanged
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. New src/lib/tasks/watch-pool.ts: WatchPool keyed by resolved dir + recursion; open() returns an idempotent handle, the stream closes when its last handle does; an error drops the stream from the pool first, then reaches every subscriber; fs.watch injectable for tests. 2. TaskWatcher.open subscribes through the shared pool (injectable via options) instead of fs.watch; prefix and path normalisation stay per subscriber. 3. watch-pool.test.ts: sharing, refcounted close, error fan-out and retry with a fake watch; a real-fs case with two TaskWatchers on one checkout sharing streams and both getting batches. 4. Expose pool stream/subscriber counts for TASK-134 diagnostics. 5. Run watcher and manager tests, typecheck, update wiki page for the watcher.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Pool keyed by resolved dir and recursion. Review (/code-review high --fix) found the fan-out let one throwing subscriber starve the rest of the stream; each callback is now isolated and reported (default: rethrown on a microtask). Verified on an isolated server: two shell tasks in one linked worktree hold 5 streams and 10 subscriptions (10 streams before), both receive the same changed batch for one write, and all streams close when the last client leaves.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
fs.watch streams are shared per directory through a refcounted WatchPool (src/lib/tasks/watch-pool.ts); TaskWatcher subscribes through it and keeps its own fold. A stream closes with its last subscriber, an error drops it from the pool before reaching every subscriber so a retry opens a fresh one, a late close from a dead stream cannot close its replacement, and one subscriber throwing no longer affects the others. Tests: watch-pool.test.ts (fake watch for sharing, refcount, error fan-out, isolation; a real-fs case with two TaskWatchers on one checkout); watcher and manager suites unchanged and passing. Code review ran at high with fixes applied; verified on an isolated server (5 shared streams for 2 tasks, both batches delivered). Wiki: modules/change-watcher.md, gotchas/bun-fs-watch-descriptor-leak.md. Follow-up for the user: the running daemon is a Bun 1.3.9 binary that leaks a descriptor per closed watch; rebuild and restart to pick up 1.4.
<!-- SECTION:FINAL_SUMMARY:END -->
