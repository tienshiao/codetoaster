---
id: TASK-53
title: 'clientCount never updates, so the shell''s viewer count is stale'
status: To Do
assignee: []
created_date: '2026-08-30 05:43'
labels:
  - server
  - bug
dependencies: []
ordinal: 53000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while verifying the v2 agent terminal in a browser (TASK-21 work; not introduced by it).

`TaskInfo.clientCount` is computed fresh in `taskInfo()` from `pty.getClientCount()`, but neither `attachClient` nor `detachClient` in src/lib/tasks/manager.ts broadcasts a task delta. So the number only reaches clients when something *else* provokes a broadcast.

Concrete: open a task in the v2 shell. The attach succeeds and `GET /api/tasks` reports `clientCount: 1`, while the status bar — fed by the socket's pushed `TaskInfo` — keeps saying '0 viewing' until an unrelated delta arrives. A second browser attaching or leaving is likewise invisible to the first.

The multi-client story is a selling point of the product (§5.4), so 'who else is looking at this' being wrong is worse than it not being shown. `attachClient`/`detachClient` should `broadcastTask(taskId)` — cheap, and both already have the task id to hand (`ptyToTask`).

Worth checking whether the same staleness affects `size`, which is negotiated per attached client and rendered beside it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 attachClient broadcasts a task delta so other clients see the viewer count rise
- [ ] #2 detachClient does the same on the way out, including the socket-closed path that detaches every PTY
- [ ] #3 A test covers the count reaching a second client without any other change provoking a broadcast
<!-- AC:END -->
