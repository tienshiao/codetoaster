---
id: TASK-53
title: 'clientCount never updates, so the shell''s viewer count is stale'
status: Done
assignee:
  - '@claude'
created_date: '2026-08-30 05:43'
updated_date: '2026-08-31 01:05'
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
- [x] #1 attachClient broadcasts a task delta so other clients see the viewer count rise
- [x] #2 detachClient does the same on the way out, including the socket-closed path that detaches every PTY
- [x] #3 A test covers the count reaching a second client without any other change provoking a broadcast
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
PtyManager.detach now returns the PTY ids it actually detached, so the caller can name the tasks whose audience changed. attachClient broadcasts the task after a successful attach; detachClient broadcasts each distinct task behind the detached PTYs, which covers the socket-closed path (no ptyId, several terminals at once) in one place. Also swapped server.ts's close handler to unregister before detaching, so the shrunken count is not sent to the socket that just went. size is fixed by the same broadcast — it is negotiated per attached client and rides on the same TaskInfo. Two tests in manager.test.ts: a second client's attach/detach moving the first client's count with nothing else provoking a broadcast, and a closing socket updating every task it held.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
attachClient and detachClient now broadcast a task delta, so clientCount (and the size negotiated alongside it) reach the other clients when they change rather than waiting for an unrelated delta. PtyManager.detach returns the PTYs it detached so the socket-closed path can name every task at once. Verified with two new tests in manager.test.ts and the full suite (734 unit / 79 render, green).
<!-- SECTION:FINAL_SUMMARY:END -->
