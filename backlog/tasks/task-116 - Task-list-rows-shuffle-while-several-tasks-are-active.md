---
id: TASK-116
title: Task list rows shuffle while several tasks are active
status: Done
assignee:
  - '@claude'
created_date: '2026-09-26 07:57'
updated_date: '2026-09-26 10:17'
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
1. db.ts migration 010_tasks_rank_at: add rank_at, backfill from last_active_at, index tasks_by_rank, drop tasks_by_recency. 2. store.ts: rank_at on the row (insert defaults to last_active_at); list orders by rank_at DESC, created_at DESC, id. 3. manager.ts: RERANK_QUIET_MS = 60s. Per-PTY output edges in memory (seeded on adopt for agent and shell). stampActivity writes last_active_at on both edges of every PTY; only the agent PTY's rising edge may rerank, and only when its own previous edge and the task's rank are both at least the window old. Shell output never ranks; a shell rising edge broadcasts the row only after a long gap, its falling edge always. wakeOnInput (from writeToPty and the upload route's typeIntoPty) reranks when the data passes isUserInput and the cached rank is at least the window old. stampRank is the single writer of rank_at and its cache, used by createTask, the resume success rung, stampActivity and wakeOnInput. unmapAndKill unmaps before killing at every kill site and sends a bare falling activity frame when the agent was mid-burst. 4. xtmux: user-input.ts classifies input (keys, Escape, Alt+key, paste yes; focus, mouse, terminal replies no); query-output.ts treats notification-only chunks (OSC 9/777/99, BEL) as non-activity like queries. 5. types.ts: TaskInfo.rankAt, activity frame rankAt?. 6. Client: byRecency sorts on rankAt; TaskContext applies rankAt when newer and the age on the falling edge or with a rank move. 7. Tests across db, store, manager, resume, query-output, user-input, task-list and TaskContext.render.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented in commit 9da6282 on worktree-task-rank-hysteresis. Migration 010_tasks_rank_at adds rank_at (backfilled from last_active_at, indexed). store.list orders by rank_at DESC with last_active_at, created_at, id as tiebreakers. manager.stampActivity holds the rule for both the agent PTY and shell tabs: the falling edge writes last_active_at, the rising edge writes it too and moves rank_at only when the gap reached RERANK_QUIET_MS (60s). Resume stamps both. The activity frame carries at on both edges and rankAt only when the rank moved; TaskContext applies each when newer and byRecency sorts on rankAt. Hook events still stamp last_active_at (hook-state.ts), which is correct: a hook firing means the agent is not quiet. Tests: bun test 1723 pass, vitest 408 pass, tsc clean.

Runtime check on an isolated server (port 4599) over a copy of the live data.db: migration 010 applied and backfilled all 44 rows, rank index created. Shell task: two bursts 1.5s apart left rank_at at creation while last_active_at followed the falling edge, frames carried at only. After back-dating last_active_at by 2 minutes the first rising frame carried rankAt and the row moved to the top of GET /api/tasks; the next burst 1.5s later carried at only.

Code review (high) on 9da6282 found six items. Fixing five: quiet is now measured from the task's last PTY output edge held in memory, not from last_active_at, because hook events (notably the idle_prompt Notification) stamp that column without output and would suppress the wake-to-top move; the server tiebreak drops last_active_at so tied ranks cannot flip between snapshots while the client holds them still; a shell tab's falling edge broadcasts the row so the age column does not lag; the client applies the age stamp only on the falling edge or with a rank move, restoring one list update per burst; migration 010 drops the unused tasks_by_recency index. Skipped: folding the rising-edge read and write into one UPDATE RETURNING, since the in-memory edge makes the row read a fallback for a fresh daemon only.

Measured the live page (old binary, two busy tasks in different projects) in Chrome: the sidebar saw about 20 DOM mutations per second, and whole project groups were detached and re-inserted about once a second because a rank flip between tasks in different projects flips the group order (groups keyed by project id in AppShell). Node count stayed flat over three minutes, so no DOM leak; heap growth over that window was inconclusive without a GC. The hysteresis removes the group moves, since rank changes only on a real wake.

Second runtime check on the final commit f54b3d2 over a fresh copy of the live database: migration and backfill applied to all 45 rows and tasks_by_recency was dropped. Two short bursts kept the rank; back-dating only the row's age by two minutes did not rerank (the in-memory output edge is authoritative); after 65 seconds of real silence the first rising frame carried rankAt and the task led GET /api/tasks, and the next burst 1.5 seconds later carried at only.

Second code review (high) on f54b3d2 found six items, all being applied: shell output no longer moves the rank (a dev server logging every 90s would bounce its task to the top), and user input to any of the task's terminals becomes the wake signal instead; a rising edge never reranks while another PTY of the task is still active; an edge for a row that is gone ranks nothing; deleteTask clears the output-edge map after the kills, whose synchronous falling edge re-inserted it; a new task is stamped when its agent PTY is adopted rather than at row creation, so setup time and hook timing no longer decide where it lands; shell rising edges no longer broadcast a row nothing can show.

Second fix round verified: bun test 1731 pass, vitest 409 pass, tsc clean. Runtime on an isolated server (commit dd062c5) over a fresh copy of the live database: the task's primary terminal (agent PTY) reranked on output after 70s of quiet and carried rankAt on the activity frame, and fresh input did not rerank; a shell tab's output after 70s of quiet moved the age only, with task deltas on the falling edges and no activity frames; the first keystroke into the shell tab after 66s of quiet moved the rank once as a task delta and the rest of the line and its echo did not. Both commits are now folded into dd062c5 on worktree-task-rank-hysteresis.

Third code review (high) on dd062c5 found seven items, being applied: xterm's own focus reports and colour-query replies travel through the input path, so clicking away from a quiet task reranked it (fix: a pure isUserInput filter strips control sequences before input counts as a wake); a shell tab logging periodically kept the output edge fresh and blocked input from ever waking the task (fix: input is gated on its own last-input time and the rank's age, not on output); a rank now moves at most once per quiet window, which also stops the echo after an input wake from moving it again; the per-edge SQL row read is gone unless the edge map is empty or a rerank is possible; a shell rising edge broadcasts the row only when the previous edge is a minute or more old; the rank stamp moves out of adopt into createTask and the resume success write so a failed resume no longer reranks; closeShell unmaps before killing like deleteTask.

Third fix round verified: bun test 1759 pass, vitest 409 pass, tsc clean; commit 06cb207. Runtime on an isolated server over a fresh copy of the live database: migration and backfill applied to all 45 rows. On the task's primary terminal, injected focus reports after 66s of quiet reranked via the output path, because a plain shell echoes the escape bytes and output after quiet is a legitimate agent-PTY wake; Claude Code consumes focus reports silently, so a real agent does not. On a shell tab, where output can never rerank, focus-out and focus-in after 66s of quiet left the rank alone and a typed line moved it once as a task delta with no activity frames, which proves the input filter.

Fourth code review (high) on 06cb207: eight items. Applying five: quiet is measured from the agent PTY's own output edges rather than the task's, since a shell tab logging every 30s otherwise blocked the agent's wake for good, and with shell output no longer ranking the other-PTY-active check and the last_active_at fallback are dropped; the input gate keys on an in-memory rank cache instead of a last-input stamp that could delay a wake by up to a minute; keyboard sequences (Escape, Shift+Tab, arrows, Home/End, PgUp/PgDn/Delete, SS3 keys) count as input while focus, mouse and terminal replies still do not; discardPty unmaps before killing like the other sites; deleteTask sends the same bare falling activity frame doSuspend does so clients do not keep a stuck busy flag. Noted, not applied: the client still allocates a new row per falling edge for the age stamp (that is the pre-existing per-burst rate and what refreshes the age column); test seams on TaskManager instead of an injectable clock.

Fourth fix round verified: bun test 1771 pass, vitest 409 pass, tsc clean; commit b5a239d. Runtime on an isolated server over a fresh copy of the live database: with a shell tab printing a line every 20 seconds, the task's agent PTY printing after 66 seconds of its own silence moved the rank exactly once (one activity frame carrying rankAt at t=68) and neither the shell ticks nor the initial inputs to a fresh task moved it.

Fifth code review (high) on b5a239d: eight items. Applying five: Claude Code's idle notification reaches the PTY as OSC 9/777/99 or a bare BEL about 60s after the prompt goes quiet and counted as an agent rising edge, racing the window, so notification-only chunks are excluded from activity the way query-only chunks already were (TASK-111); the upload route's typed file path now goes through the same input wake as keystrokes; modified F1/F2/F4, keypad Begin and kitty-protocol keys count as input (R stays out because a modified F3 is byte-identical to a cursor-position report); adoptShell seeds the shell's edge so opening a tab does not broadcast a third identical row; one helper writes rank_at and its cache. Noted, not applied: store.update's read-back on every edge; test seams instead of an injectable clock; carrying shell stamps on the activity frame with a ptyId instead of task deltas, which is a protocol change worth its own task if the delta traffic ever matters.

Fifth fix round verified: bun test 1787 pass, vitest 409 pass, tsc clean; commit 6d4577c. Boot smoke on an isolated server over a fresh copy of the live database: migration applied, no row left unranked, the task list served with ranks in descending order.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Task rows and project groups stopped racing while several tasks are busy. The list sorts on a new rank_at that moves at most once per 60-second window and only on a real wake: the agent PTY's output resuming after 60 seconds of its own silence, the user typing (or dropping a file) into any of the task's terminals, or the task starting or resuming. Shell-tab output, xterm's own focus and mouse reports, terminal query replies, and Claude Code's idle notification never move it. Quiet is measured per PTY from in-memory output edges rather than from last_active_at, which hooks also stamp. last_active_at keeps the age column and harvester grace and is written on both edges. Ties break on created_at and id so a snapshot never reorders rows the client holds. Verified after each of five review rounds with both test runners (final: 1787 unit, 409 render), tsc, and isolated servers over copies of the live database covering the migration, short bursts, a 65-second wake, shell-tab output versus typing, focus reports, a logging shell beside a waking agent, and a boot smoke; the sixth review pass reported no findings. Commit 6d4577c on worktree-task-rank-hysteresis; the running daemon needs a rebuilt binary and restart to pick it up. Measured separately: the SweepSpotter backend page freeze is a 50 MB working-tree diff (a 22 MB single-line GeoJSON) parsed and rendered on the client, not the terminal; proposed as follow-up work.
<!-- SECTION:FINAL_SUMMARY:END -->
