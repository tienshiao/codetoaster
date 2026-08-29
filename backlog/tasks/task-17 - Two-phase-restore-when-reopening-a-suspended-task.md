---
id: TASK-17
title: Two-phase restore when reopening a suspended task
status: Done
assignee: []
created_date: '2026-08-29 00:02'
updated_date: '2026-08-29 18:07'
labels:
  - server
  - frontend
  - tasks
milestone: m-2
dependencies:
  - TASK-13
  - TASK-14
documentation:
  - docs/v2-architecture.md
ordinal: 17000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A resumed agent repaints from scratch, so the snapshot and the live screen will not agree (§5.5, Risk 2). Make that honest: (1) on open, immediately send scrollback.ans as a `restore` rendered read-only with a 'suspended — resuming…' affordance; (2) spawn claude --resume; on its first paint, reset the terminal and swap to the live PTY. Terminal.tsx's RIS-through-the-write-buffer already exists for the reset.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Opening a suspended task shows the stored scrollback within one round-trip, before the agent process exists
- [x] #2 The read-only phase visibly indicates the task is resuming and does not accept input
- [x] #3 On the resumed agent's first output the view resets and becomes the live PTY with no leftover snapshot content
- [x] #4 If resume fails, the view shows the could-not-resume state instead of hanging on 'resuming…'
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Delivery: GET /api/tasks/:id/scrollback, not a new socket message. A restore frame is addressed by ptyId and AC #1 requires painting before any PTY exists, so there is nothing to name it with; §5.4 already moved data routes off live processes, and the client fires this in parallel with POST /resume. Answers {data, size} where data is null for a task that has no stored screen (suspended before TASK-14, or an agent that died before a snapshot) and size is the row last_size, which may be null.

The null last_size case (noted on this task from TASK-14): the client paints at its OWN measured grid rather than falling through to 80x24. If we do not know what grid the snapshot was taken at, the viewers current grid is no worse and usually right, whereas DEFAULT_SIZE is a guess that reflows.

The swap is a client-side state machine, and it has to buffer. On attach the server sends restore for the freshly spawned PTY BEFORE any data; applying it immediately would wipe the snapshot and leave a blank screen for the whole of the agents startup. So while restoring: attached is recorded but input stays blocked, restore is stashed rather than applied, and the FIRST data frame triggers RIS -> apply the stashed restore -> write the data -> go live. The snapshot stays on screen until there is something real to replace it with.

Input (AC #2) is nearly free: onData already gates on attachedRef, so the gate becomes attachedRef && !restoring. The affordance is an overlay over the terminal container, not text written into the grid — RIS would wipe it, and writing into the grid corrupts the snapshot underneath.

Race: restoring is set synchronously at click time, before either request is fired, so a resume that beats the scrollback fetch cannot have the snapshot painted over its live output.

AC #4: a resume landing on could_not_resume ends the restoring phase and shows that state in the overlay with Try again, keeping the snapshot painted — it is the last thing the user saw and it is still the most useful thing on screen. It must not sit on resuming... forever.

Testing: there is no DOM test infrastructure and adding happy-dom is out of scope, so the state machine goes in a pure module (frontend/utils/restore-phase.ts) in the manner of view-state-store and commitGraph, tested with bun:test — which frames, in which order, produce which transition. Terminal.tsx only wires it. The route gets ordinary server-side tests.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
From TASK-14: snapshot() writes scrollback.ans before updating last_size on the row, so a snapshot can exist whose grid the row does not record (a crash in the gap, or a file written by an older build). Repainting it at DEFAULT_SIZE reflows it into nonsense, so this path must tolerate a null last_size explicitly rather than falling through to 80x24. If the restore format grows a header, carrying the grid inside the file removes the disagreement at the source — that is the preferred fix and it is TASK-17's call to make, since nothing consumes the format yet.

Two corrections to the plan, both found rather than designed.

1. The swap trigger in the plan was wrong. It said "the first data frame", but runResumeLadder awaits awaitAgentStart (a hook, or a four-second cap) before the route answers, and only then does the client learn which PTY to attach to — so the agent has normally already painted, and that paint is in the headless terminal and reaches the client as the RESTORE, not as data. Holding it back would strand a resumed-but-quiet agent behind a read-only snapshot for good. The distinction the phase actually turns on is that what deserves holding back is a BLANK screen, not a screen: an empty restore is stashed, one with content in it is the swap. Verified the awaitAgentStart ordering in manager.ts before changing anything. The test fixtures had encoded the same wrong premise (they modelled a fresh PTYs restore as having content) and were rebuilt on restore("").

2. A resumed agent can also start, print nothing and stay alive, so no frame ever arrives. timeoutRestore performs the same swap after five seconds — reset, then the stashed restore. Merely dropping the phase would leave live output appending to a snapshot of a previous life; a quiet agents stashed restore is empty, so what the user gets is the clean empty terminal that is the truth about it. Armed only once the PTY exists, since before that the resume may still be walking its ladder.

Found during browser verification, and worse than the review reported: closing a task you are CURRENTLY VIEWING left it unreopenable. The row survives now, so the slug still resolves and the routes attach effect stays latched on an attachment that died with the PTY; clicking the sidebar row navigates to the slug it is already on and does nothing. Reproduced it in ordinary use — the click started no resume at all. Fixed in two halves, because the obvious single fix is wrong: (a) a third overlay state, "This session is suspended - Reopen", calling the resume directly; (b) the routes latch clears when the slug task ACQUIRES a ptyId, never when it loses one. Clearing it on loss would re-run the attach effect against a task with no terminal and reopen it the instant the user closed it. Without (b) the reopen half-worked in the worst way: the server resumed, the row went live, and the browser never attached — clientCount 0 with the overlay stuck on resuming... forever.

Validation: bun test 476 pass / 0 fail; bunx tsc --noEmit clean. Route driven directly: 1256 bytes of real ANSI carrying the agents own output, size 110x30 off the row, data null before any snapshot exists, 404 for an unknown task. End to end in Chrome against a real agent, all four ACs seen on screen: the stored scrollback painted under a "Suspended - resuming..." pill with the killed PTYs exit notice repainted away (AC #1, #2), the swap to the live agents own screen with no snapshot residue and clientCount going 0 -> 1 (AC #3), and an earlier run showing "Could not resume the session - Try again" rather than hanging (AC #4).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Reopening a suspended task now shows its stored screen immediately and swaps to the live agent when one paints. GET /api/tasks/:id/scrollback carries the snapshot (HTTP, because a restore frame needs a ptyId and AC #1 is about the moment before one exists); a pure restore-phase.ts holds the state machine, since there is no DOM test infrastructure and the ordering is the whole task. A restore with content in it is the swap, an empty one is stashed, and a five-second timeout swaps anyway so a silent agent cannot strand the grid read-only. Also fixed a hole this exposed: a task suspended while being viewed could not be reopened at all. Verified with bun test (476/0), tsc, the route driven directly, and an end-to-end browser run against a real agent covering all four ACs.
<!-- SECTION:FINAL_SUMMARY:END -->
