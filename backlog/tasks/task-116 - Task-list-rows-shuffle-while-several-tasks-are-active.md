---
id: TASK-116
title: Task list rows shuffle while several tasks are active
status: Done
assignee:
  - '@claude'
created_date: '2026-09-26 07:57'
updated_date: '2026-09-26 08:32'
labels:
  - frontend
  - backend
  - bug
dependencies: []
ordinal: 118000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The sidebar orders tasks by last_active_at DESC, and the server rewrites that stamp on every rising edge of PTY output. The PTY activity detector goes idle after 300ms of silence, so an agent that pauses to think or run a tool trips active/idle several times a minute, and each rising edge ships an activity frame that moves the task to the top. With two or more busy tasks the rows race for the top slot and the user cannot click the one they want. Fix with hysteresis rather than rounding: keep last_active_at for the age column and the harvester, and add a separate sort key (rank_at) that advances only when a task becomes active after being quiet for at least 60 seconds. A continuously working task never moves, concurrently working tasks keep their relative order, and a task that wakes after a real pause still jumps to the top. Rounding to a minute was considered and rejected: rows would still flip at minute boundaries, and a tiebreaker would have to be mirrored in SQL and the client.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Two tasks whose agents stream output with sub-minute pauses keep their relative order in the sidebar indefinitely
- [x] #2 A task that has been quiet for at least 60 seconds moves to the top of the live list when it becomes active again, without a reload
- [x] #3 A task that becomes active after less than 60 seconds of quiet does not change rank, but its age column still updates
- [x] #4 Order after any sequence of deltas and activity frames matches what a fresh tasks snapshot would produce
- [x] #5 Existing databases migrate: every task keeps the rank it had (rank_at backfilled from last_active_at)
- [x] #6 Shell-tab activity and resume follow the same rule
- [x] #7 Unit tests cover the quiet threshold in the manager, the store ordering and backfill, and the client re-sort on rankAt
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. db.ts migration 010_tasks_rank_at: add rank_at INTEGER NOT NULL DEFAULT 0, backfill from last_active_at, index tasks_by_rank, drop tasks_by_recency. 2. store.ts: rank_at on TaskRow, updatable and inserted (defaults to last_active_at); list orders by rank_at DESC, created_at DESC, id so ties never move between reads. 3. manager.ts: RERANK_QUIET_MS = 60_000; stampActivity writes last_active_at on both edges and moves rank_at only when the task's last output edge (in-memory outputEdgeAt, falling back to the row's last_active_at for a fresh daemon) is at least the threshold behind; agent PTY frame carries at on both edges and rankAt only when the rank moved; shell tabs use the same rule and broadcast the row on both edges; resume stamps both. 4. types.ts: TaskInfo.rankAt, activity frame rankAt?. 5. Client: byRecency sorts on rankAt; TaskContext applies rankAt when newer and the age only on the falling edge or with a rank move. 6. Tests across db, store, manager, task-list and TaskContext.render.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented in commit 9da6282 on worktree-task-rank-hysteresis. Migration 010_tasks_rank_at adds rank_at (backfilled from last_active_at, indexed). store.list orders by rank_at DESC with last_active_at, created_at, id as tiebreakers. manager.stampActivity holds the rule for both the agent PTY and shell tabs: the falling edge writes last_active_at, the rising edge writes it too and moves rank_at only when the gap reached RERANK_QUIET_MS (60s). Resume stamps both. The activity frame carries at on both edges and rankAt only when the rank moved; TaskContext applies each when newer and byRecency sorts on rankAt. Hook events still stamp last_active_at (hook-state.ts), which is correct: a hook firing means the agent is not quiet. Tests: bun test 1723 pass, vitest 408 pass, tsc clean.

Runtime check on an isolated server (port 4599) over a copy of the live data.db: migration 010 applied and backfilled all 44 rows, rank index created. Shell task: two bursts 1.5s apart left rank_at at creation while last_active_at followed the falling edge, frames carried at only. After back-dating last_active_at by 2 minutes the first rising frame carried rankAt and the row moved to the top of GET /api/tasks; the next burst 1.5s later carried at only.

Code review (high) on 9da6282 found six items. Fixing five: quiet is now measured from the task's last PTY output edge held in memory, not from last_active_at, because hook events (notably the idle_prompt Notification) stamp that column without output and would suppress the wake-to-top move; the server tiebreak drops last_active_at so tied ranks cannot flip between snapshots while the client holds them still; a shell tab's falling edge broadcasts the row so the age column does not lag; the client applies the age stamp only on the falling edge or with a rank move, restoring one list update per burst; migration 010 drops the unused tasks_by_recency index. Skipped: folding the rising-edge read and write into one UPDATE RETURNING, since the in-memory edge makes the row read a fallback for a fresh daemon only.

Measured the live page (old binary, two busy tasks in different projects) in Chrome: the sidebar saw about 20 DOM mutations per second, and whole project groups were detached and re-inserted about once a second because a rank flip between tasks in different projects flips the group order (groups keyed by project id in AppShell). Node count stayed flat over three minutes, so no DOM leak; heap growth over that window was inconclusive without a GC. The hysteresis removes the group moves, since rank changes only on a real wake.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Task rows and project groups stopped racing while several tasks are busy. The list now sorts on rank_at, which moves only when a task wakes after 60s without PTY output (or on resume); last_active_at keeps the age column and harvester grace and is written on the falling edge too. Quiet is measured from the last output edge held in memory, not from last_active_at, so hook stamps such as the idle_prompt Notification cannot suppress the wake-to-top move. Ties break on created_at and id so a snapshot never reorders rows the client holds still. Verified with bun test (1726 pass), vitest (409 pass), tsc, a runtime check on an isolated server over a copy of the live database (migration backfilled all 44 rows; short bursts kept the rank, a two-minute gap moved it), and a high-effort code review whose five actionable findings were fixed. Commit f54b3d2 on worktree-task-rank-hysteresis; the running daemon needs a rebuilt binary and restart to pick it up.
<!-- SECTION:FINAL_SUMMARY:END -->
