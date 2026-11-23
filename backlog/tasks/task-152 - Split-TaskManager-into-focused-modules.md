---
id: TASK-152
title: Split TaskManager into focused modules
status: To Do
assignee: []
created_date: '2026-11-23T13:31:00Z'
labels:
  - server
  - tasks
  - chore
dependencies: []
priority: low
ordinal: 155000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
src/lib/tasks/manager.ts is 4,452 lines: one TaskManager class with about 130 methods and 30 private maps and sets, and 67 commits since bffac70 replaced SessionManager. Every task feature since then (worktrees, suspend and resume, harvest, WIP snapshots, archive and unarchive, boot reconciliation, profiles, list ranking, file watchers, project CRUD) landed as methods and state on the same class, so unrelated concerns share one namespace and one file. Reviews and agents have to read thousands of lines to change one path, and manager.test.ts is 1,890 lines for the same reason. Some pieces already live outside it (harvester.ts, watcher.ts, watch-pool.ts, snapshot.ts, derive.ts, store.ts); the rest has not been split. Natural seams: project settings and CRUD; client registry and broadcasting; per-task file watchers; worktree status and boot reconciliation; activity, rank and hook-grace inference; spawn and the resume ladder; suspend, evict and WIP; archive, unarchive and delete; the TaskInfo projection. This is a behaviour-preserving cleanup, and the in-flight maps (resuming, suspending, evicting, archiving, unarchiving) that serialize lifecycle operations per task are the part most likely to break when moved.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 No behaviour change: bun run test and bun run typecheck are clean, and existing manager, resume, archive, unarchive, worktree and profiles-spawn tests pass with at most import-path edits
- [ ] #2 manager.ts is under 1,500 lines, and each extracted module owns one concern together with the state only it uses
- [ ] #3 Concurrent lifecycle calls on one task (resume, suspend, evict, archive, unarchive) still coalesce or serialize exactly as before, with a test covering each pairing the split touches
- [ ] #4 Callers outside src/lib/tasks (server.ts, src/api, client-messages, CLI) still go through one TaskManager entry point or are updated in the same change
- [ ] #5 Code, fields and comments left unreferenced by the split are removed
- [ ] #6 wiki/modules pages that describe task lifecycle point at the new module layout, and wiki/index.md and wiki/log.md are updated
<!-- AC:END -->
