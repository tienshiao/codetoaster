---
id: TASK-49
title: 'An error frame names no PTY, so a multi-terminal client cannot place it'
status: To Do
assignee: []
created_date: '2026-08-30 01:27'
updated_date: '2026-08-30 02:05'
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
- [ ] #1 An error provoked by a PTY-addressed request carries that ptyId
- [ ] #2 pty-router routes an addressed error to the one terminal and fans out an unaddressed one
- [ ] #3 A stale attach still paints its explanation into the grid that provoked it
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Second symptom of the same root cause, found reviewing TASK-20 — worth fixing together.

`restore-phase.ts` treats an `error` frame as 'the agent is not coming': the phase goes IDLE, the stashed empty `restore` is dropped and input is ungated. Since an error names no PTY, SessionContext fans every one of them into the terminal — so an error provoked by some *other* action arriving mid-reopen ends that reopen. The user is then typing into a screen still showing the old snapshot, and when the resumed agent finally paints, its output is appended to the snapshot instead of replacing it.

Not fixable on the client: suppressing errors during the phase would break the case the arm exists for (the agent really did die, and this is the only explanation the user gets). Addressing the frame to the PTY that provoked it fixes both symptoms at once.
<!-- SECTION:NOTES:END -->
