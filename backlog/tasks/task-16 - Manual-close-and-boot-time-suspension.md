---
id: TASK-16
title: Manual close and boot-time suspension
status: Done
assignee: []
created_date: '2026-08-29 00:02'
updated_date: '2026-08-29 17:21'
labels:
  - server
  - api
  - tasks
milestone: m-2
dependencies:
  - TASK-14
documentation:
  - docs/v2-architecture.md
ordinal: 16000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Two more harvest triggers (§5.5, §6). Manual: the task list's close action calls the same harvest path minus the idle guards (the UI confirms when the agent is busy). Restart: on daemon boot, every `live` row becomes `suspended` because its PTY died with the parent — verified in Phase 0 that closing the PTY masters takes the agent and its children down, so nothing needs reaping. Chat has no close: closing a task suspends it; archive is the only way out.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 POST /api/tasks/:id/close harvests immediately regardless of idle state
- [x] #2 On boot, all lifecycle=live rows are set to suspended before any client can connect
- [x] #3 bun --hot restarts leave tasks resumable rather than gone
- [x] #4 Tests cover both triggers
- [x] #5 Closing keeps ~/.codetoaster/tasks/<id>/ intact — its settings.json and scrollback are what reopening the suspended task reads back
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Server
1. Split the two meanings "close" currently has. closeTask becomes the manual-close path and is just suspendTask (TASK-15 already built it: snapshot, kill every PTY, lifecycle=suspended, keep the row and the directory). A new deleteTask carries todays destructive behaviour — kill, remove the snapshot, delete the row, drop the project placement — and inherits the snapshot removal TASK-14 parked in closeTask, which is exactly the move that comment predicted.
2. POST /api/tasks/:id/close -> closeTask, 200 with TaskInfo, 404 unknown (AC #1). DELETE /api/tasks/:id -> deleteTask, keeping the CLI command "codetoaster kill" working; documented as the interim archive until TASK-31 gives it worktree cleanup.
3. The socket "kill" message repoints to the suspend path too, so no client can reach the destructive one by accident. Its v1 name stays; the route is the real door now.
4. listTasks widens to live + suspended (archived still excluded), which is what puts a suspended row in front of the user at all.
5. Harvester default flips from 0 to THIRTY_MINUTES_MS now that a suspended task can be reopened, and the test pinning the default flips with it.

Frontend (the interim affordance chosen over hiding suspended tasks)
6. SessionInfo gains lifecycle and fromTask carries it — it is dropped on the floor today, which is why a harvested task still looked normal.
7. AppSidebar renders a suspended row as visibly dormant (StatusDot grows a suspended state rather than showing the live green).
8. Clicking a suspended task resumes it: POST /api/tasks/:id/resume with the measured grid, then attach to the ptyId that comes back. attachSession returns false on a null ptyId today, which is the whole bug — that early return becomes the resume path. Deliberately minimal: painting the stored scrollback read-only while the agent starts is TASK-17, not this.
9. closeSession calls POST /close instead of sending the socket "kill" message.

Tests
10. Close suspends rather than deletes: row kept, lifecycle=suspended, settings.json AND scrollback.ans still on disk (AC #5).
11. Boot reconciliation (reconcileOnBoot landed with TASK-5) gets the tests ACs #2/#3 ask for: every live row is suspended before any client can connect, and the task is resumable afterwards rather than gone.
12. Route tests for both doors, including that DELETE still hard-deletes and POST /close does not.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Boot-time suspension landed early, with TASK-5: TaskManager.reconcileOnBoot() marks every live row suspended at startup, and server.ts calls it after loadProjects. Without it TASK-5 shipped a manager that listed tasks whose processes had died with the previous daemon. What remains here is the manual-close half — §6's 'closing a task suspends it' — which replaces the v1 kill semantics TASK-5 kept (closeTask still kills the terminals and deletes the row).

Until the manual-close half lands, closeTask still deletes the row while leaving ~/.codetoaster/tasks/<id>/ on disk, which orphans that directory for good: the id can never be reissued, so nothing will ever read it again. Deleting it in closeTask would be the wrong fix, since close becomes a suspend here and a suspended task's directory is exactly what reopening it needs. The removal belongs to archive (TASK-31, which now has an acceptance criterion for it). Documented on closeTask itself.

Review found six frontend defects, all from widening listTasks to include suspended rows — the server half was straightforward, the consequences were not:
- Loading / spawned an agent. reconcileOnBoot suspends every task at boot, and the index redirect to sessions[0] drove attachSession -> resumeSession, so every page load and every bun --hot reload resumed a task nobody asked to open — and silently took back whatever the harvester had just reclaimed. The redirect now picks the first non-suspended session.
- Closing a tab could resume an unrelated dormant task, because closeNavTarget returns remaining[0]. Same bug reachable from the command palette.
- inferState never stamped idle_since. Degraded mode (no hooks) writes agent_state=idle only, and nothing clears idle_since on resume — so a reopened task inherited the Stop timestamp from its previous life, landed already past harvest_after, and the very next 30s tick suspended the task the user had just reopened. This is the interaction between TASK-12 and TASK-15 that neither task could see on its own.
- A failed close left a phantom viewer: closeSession cleared attachedPtyRef without sending detach, so a 404 left the server counting a client that was gone — clamping smallest-wins negotiation and, because zero-attached-views is a hard guard, making the task permanently unharvestable.
- One failed resume made a task permanently un-openable once the toast was dismissed; the latch now clears for every task but the one being opened.
- A suspended row hovered forever on Loading..., because /preview 404s without a live terminal.

Found in browser verification, after the review: TopBar still rendered the live green dot for a suspended task while the sidebar showed it hollow — the same lie in the one surface that actually labels the task. isSuspended is now plumbed through TopBar from App.

Validation: bun test 452 pass / 0 fail; bunx tsc --noEmit clean. Driver on an isolated db: closing a BUSY task suspends it with no guards (AC #1), keeps the row, settings.json and scrollback.ans (AC #5), and leaves it listed; deleteTask still hard-deletes and takes the snapshot; reconcileOnBoot suspends live rows and the task stays listed and resumable across a restart (AC #2/#3); inferred idle restamps idle_since instead of inheriting a 99-minute-old one. End to end in Chrome against a real agent: a closed task renders hollow in both sidebar and top bar, a daemon restart leaves it suspended and does NOT auto-resume it (zero agent processes after a full page load), clicking it resumes, and a resume that cannot succeed shows "Could not resume the session" with Try again rather than looping or hanging.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Closing a task now suspends it (§6): closeTask is suspendTask, a new deleteTask carries the destructive path and the snapshot removal TASK-14 parked in closeTask, POST /api/tasks/:id/close is the door and DELETE stays as the interim archive. listTasks widened to live + suspended, reconcileOnBoot re-adopts rows into the project grouping (without which restarts left tasks correct in the database and invisible), and the harvester default flipped on now that a suspended task is reachable. Sidebar and top bar render suspended rows dormant; clicking one resumes it, with one attempt per suspension and a Try again on failure. Verified with bun test (452/0), tsc, a server-side driver over all five ACs, and an end-to-end browser run against a real agent.
<!-- SECTION:FINAL_SUMMARY:END -->
