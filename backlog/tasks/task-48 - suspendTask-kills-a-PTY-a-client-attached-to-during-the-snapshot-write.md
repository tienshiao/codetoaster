---
id: TASK-48
title: suspendTask kills a PTY a client attached to during the snapshot write
status: To Do
assignee: []
created_date: '2026-08-30 01:27'
labels:
  - server
  - tasks
  - bug
dependencies: []
documentation:
  - docs/v2-architecture.md
ordinal: 48000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by code review during TASK-19 (not introduced by it).

src/lib/tasks/manager.ts — shouldHarvest deliberately re-runs rowAllows/hasNoAttachedViews on both sides of its own await, but suspendTask then awaits a real disk write before killing the PTYs, and that write is queued per task behind any earlier one. So there is a second, longer window with no guard.

Concrete: the harvester judges task T harvestable with zero attached clients; during the snapshot write the daemon services a WebSocket attach from a user who has just clicked T, and answers it with attached/restore; suspendTask then kills the PTY. The user watches the terminal they just opened die.

Not fixed in review because the correct guard is conditional on the caller: a user's own closeTask must still suspend a task they are attached to, so this changes suspendTask's contract rather than adding a check. Options worth weighing: a precondition callback threaded from Harvester, splitting harvest() from suspendTask(), or re-checking hasNoAttachedViews only on the harvest path.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A client that attaches during the snapshot write does not have its PTY killed by a harvest already in flight
- [ ] #2 A manual close still suspends a task the closing client is attached to
- [ ] #3 A test covers the attach-during-write race on the harvest path
<!-- AC:END -->
