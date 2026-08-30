---
id: TASK-49
title: 'An error frame names no PTY, so a multi-terminal client cannot place it'
status: Done
assignee:
  - '@claude'
created_date: '2026-08-30 01:27'
updated_date: '2026-08-30 02:20'
labels:
  - frontend
  - xtmux
dependencies:
  - TASK-19
documentation:
  - docs/v2-architecture.md
ordinal: 49000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ServerMessage's error variant carries only a message, no ptyId, so pty-router fans it out to subscribers rather than routing it. SessionContext currently forwards it to the single terminalRef, which is correct only while one terminal renders.

Once TASK-22 puts several terminals on screen, 'Terminal "…" not found' and 'Not attached to terminal "…"' — the server's answer to a stale attach or a keystroke — have no grid to land in. Painting them into all of them is wrong; dropping them leaves a dead terminal with no explanation, which is the regression TASK-19's review caught.

The likely fix is on the server: address an error to the PTY that provoked it where one exists (attach, input, resize all name a ptyId), leaving a ptyId-less error for genuinely client-wide failures. Then the router places it like any other frame.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An error provoked by a PTY-addressed request carries that ptyId
- [x] #2 pty-router routes an addressed error to the one terminal and fans out an unaddressed one
- [x] #3 A stale attach still paints its explanation into the grid that provoked it
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. types.ts: ServerMessage error gains an optional ptyId — present when a PTY-addressed request provoked it, absent for genuinely client-wide failures.
2. Extract the websocket message switch out of server.ts into src/lib/xtmux/client-messages.ts as handleClientMessage(manager, ws, clientId, raw), so the addressing is unit-testable without booting a server (server.ts imports index.html and cannot be imported from a test).
3. sendError gains a ptyId argument; attach and input pass theirs. Everything else (bad JSON, unknown type, task/project failures) stays unaddressed.
4. pty-router: ptyIdOf returns message.ptyId ?? null for an error, so an addressed one is placed like any other frame (queued if the terminal has not mounted) and an unaddressed one fans out.
5. SessionContext stops forwarding every error into the single terminalRef — addressed ones now arrive through the router. What fans out is client-wide, so it becomes a toast; that also closes the restore-phase hole, where an unrelated error ended a reopen.
6. Tests: client-messages.test.ts for the addressing, pty-router.test.ts for the routing and queueing.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Second symptom of the same root cause, found reviewing TASK-20 — worth fixing together.

`restore-phase.ts` treats an `error` frame as 'the agent is not coming': the phase goes IDLE, the stashed empty `restore` is dropped and input is ungated. Since an error names no PTY, SessionContext fans every one of them into the terminal — so an error provoked by some *other* action arriving mid-reopen ends that reopen. The user is then typing into a screen still showing the old snapshot, and when the resumed agent finally paints, its output is appended to the snapshot instead of replacing it.

Not fixable on the client: suppressing errors during the phase would break the case the arm exists for (the agent really did die, and this is the only explanation the user gets). Addressing the frame to the PTY that provoked it fixes both symptoms at once.

Done. The websocket switch moved out of server.ts into src/lib/xtmux/client-messages.ts (server.ts imports the frontend HTML entry, so it cannot be imported from a test, and the manager there is a singleton while every test builds its own). sendError takes an optional ptyId; attach and input pass theirs, everything else stays client-wide.

pty-router's ptyIdOf now answers message.ptyId ?? null for an error, so an addressed one is placed exactly like a data frame — queued if the terminal has not mounted, dropped for a PTY this client gave back — and only client-wide ones fan out. SessionContext no longer forwards every error into its single terminalRef; what fans out becomes a toast, and TaskContext (v2, which was dropping them silently) got the same.

Validation: bunx tsc --noEmit clean; bun test 595 pass / 0 fail; and a real daemon on port 0 answered a stale attach with {message: 'Terminal "pty-gone" not found', ptyId: 'pty-gone'}, a stray keystroke with ptyId 'pty-other', and 'Task "no-such-task" not found' with no ptyId at all.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The error frame gained an optional ptyId and the server now fills it in wherever a PTY-addressed request provoked the refusal, so pty-router places the explanation in the grid that asked for it instead of fanning it out. Fixes both symptoms at once: a multi-terminal client can place a stale attach's refusal, and an unrelated error can no longer end a reopen mid-restore. Verified with tsc, the full suite (595 pass), and a live daemon returning addressed and unaddressed errors as intended.
<!-- SECTION:FINAL_SUMMARY:END -->
