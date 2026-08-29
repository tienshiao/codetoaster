---
id: TASK-17
title: Two-phase restore when reopening a suspended task
status: To Do
assignee: []
created_date: '2026-08-29 00:02'
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
- [ ] #1 Opening a suspended task shows the stored scrollback within one round-trip, before the agent process exists
- [ ] #2 The read-only phase visibly indicates the task is resuming and does not accept input
- [ ] #3 On the resumed agent's first output the view resets and becomes the live PTY with no leftover snapshot content
- [ ] #4 If resume fails, the view shows the could-not-resume state instead of hanging on 'resuming…'
<!-- AC:END -->
