---
id: TASK-111
title: Terminal queries alone must not count as PTY activity
status: Done
assignee: []
created_date: '2026-09-22 23:25'
updated_date: '2026-09-26 01:25'
labels:
  - bug
  - backend
dependencies: []
ordinal: 113000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Claude Code 2.1.x polls DECXCPR (ESC[?6n) about every 200ms even when idle. pty.ts counts any output as activity with a 300ms debounce, so every agent PTY is permanently active; whenever the server stalls past 300ms all tasks see a falling then rising edge and last_active_at is re-stamped at the same instant on every live task. Idle tasks jump to the top of the recency-sorted list alongside genuinely busy ones.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Output consisting only of terminal queries (DSR/CPR, DA, DECRQM, XTVERSION, kitty keyboard query, DECRQSS, OSC colour queries) neither raises nor extends PTY activity
- [x] #2 Output mixing a query with real content still counts as activity
- [x] #3 Unit tests cover query-only and mixed chunks
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Root cause observed live: every Claude Code 2.1.280 agent PTY writes ESC[?6n about every 200ms; all three live tasks were stamped last_active_at at the same second. Fix: pty.ts skips activity tracking for chunks that are only terminal queries (query-output.ts). bun run test and tsc pass.

Runtime check on an isolated server (port 4599, scratch db) with a real Claude Code agent: after startup the agent sent 278 cursor-position queries in 60s; activity went idle at 3.2s and rose only once more, at 12.7s, on real redraw output. last_active_at stayed 47s old at the end.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
PTY output that is only terminal queries (cursor-position polling, DA, DECRQM, etc.) no longer raises or extends activity, so idle Claude Code agents stop being re-stamped as recent. Verified by unit and PTY tests and against a real agent on an isolated server.
<!-- SECTION:FINAL_SUMMARY:END -->
