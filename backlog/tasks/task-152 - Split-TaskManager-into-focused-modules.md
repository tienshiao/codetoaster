---
id: TASK-152
title: Split TaskManager into focused modules
status: Done
assignee:
  - '@claude'
created_date: '2026-11-23T13:31:00Z'
updated_date: '2026-11-23T17:10:00Z'
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
- [x] #1 No behaviour change: bun run test and bun run typecheck are clean, and existing manager, resume, archive, unarchive, worktree and profiles-spawn tests pass with at most import-path edits
- [x] #2 manager.ts is under 1,500 lines, and each extracted module owns one concern together with the state only it uses
- [x] #3 Concurrent lifecycle calls on one task (resume, suspend, evict, archive, unarchive) still coalesce or serialize exactly as before, with a test covering each pairing the split touches
- [x] #4 Callers outside src/lib/tasks (server.ts, src/api, client-messages, CLI) still go through one TaskManager entry point or are updated in the same change
- [x] #5 Code, fields and comments left unreferenced by the split are removed
- [x] #6 wiki/modules pages that describe task lifecycle point at the new module layout, and wiki/index.md and wiki/log.md are updated
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Approved by the user 2026-11-23. Shape: TaskManager stays the one entry point; every public method stays on it as a non-async one-line delegator. Each concern becomes a class in src/lib/tasks/ holding a type-only host reference; any call to a method that is public on TaskManager goes through the host (tests replace snapshot, snapshotTaskWip, restoreTaskWorktree, liveTasks, suspendedTasks, refreshStaleWorktreeStatuses on the instance); reassignable state (store, db, profiles, port, origin, the Ms knobs) is read through the host, never captured. 0. Pairing tests first on the unsplit class: resume during suspend, suspend x suspend join, evict x archive, evict x unarchive, concurrent archive x archive, unarchive x resume; commit green. 1. Leaves: projects.ts, clients.ts, checkout-watchers.ts, worktree-status.ts + boot.ts, task-info.ts. 2. terminals.ts, activity.ts, hooks.ts. 3. Lifecycle: inflight.ts (the five maps only, no shared helper), create.ts, resume.ts, suspend.ts (snapshot, putDown, evict, WIP, restore), archive.ts (archive, unarchive, expire, delete). Bodies and comments move verbatim; check with git diff color-moved. Per-process maps go to the module that writes them where possible, each clear site keeping its current subset. One commit per extraction with bun run test green. 4. Wiki module pages, index, log; review and verify.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Done in three phases by Opus subagents against a shared rules brief, each phase reviewed before the next. 14 modules: projects, clients, checkout-watchers, worktree-status, boot, task-info, terminals, activity, hooks, create, resume, suspend, archive, inflight; host.ts holds the TaskHost contract (the manager passes itself; members modules need are @internal). manager.ts 4452 -> 755 lines. Unit 2303 (2294 + 9 new pairing tests) and render 643 green after every phase; existing test files untouched. Mutation check: disabling each in-flight wait/join/refuse branch in turn is caught by a test for 7 of 8; evict-refuses-unarchive is not, since doEvict refuses that row anyway, so the door guard changes no outcome. Wiki docs landed in a separate commit after the refactor commits rather than in the same one, as CLAUDE.md asks; folding them in would need an interactive rebase.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Split the 4,452-line TaskManager into one class per concern in src/lib/tasks, behind TaskManager as the single entry point (manager.ts now 755 lines, all public methods kept as non-async one-line delegators, no caller outside src/lib/tasks changed). Modules reach each other through TaskHost, which is the manager instance itself, so test monkeypatches on the instance keep intercepting internal calls; reassignable state is read through it at each use; the five in-flight maps live together in inflight.ts with each operation's wait-then-register code unchanged. Added lifecycle-pairs.test.ts first, on the unsplit class, covering the nine concurrent pairings that had no test. Review (/code-review high --fix): 111 moved method bodies verbatim after normalising host prefixes, routing, captured state, async-ness, in-flight order and clear-site order all unchanged; only wiki wording nits, fixed. Verify: on an isolated server with a scratch project, a worktree task went through create, close, resume, close+resume together, evict, resume rebuilding the checkout with the untracked file kept, concurrent double archive (same outcome), unarchive restoring the file, 409/400/404 refusals and hard delete. New wiki page modules/task-manager-layout.md; change-watcher, archive-and-unarchive and task-suspension pages and CLAUDE.md repointed.
<!-- SECTION:FINAL_SUMMARY:END -->
