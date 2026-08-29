---
id: TASK-15
title: Idle harvester with conservative guards
status: Done
assignee: []
created_date: '2026-08-29 00:02'
updated_date: '2026-08-29 16:09'
labels:
  - server
  - tasks
milestone: m-2
dependencies:
  - TASK-14
  - TASK-11
documentation:
  - docs/v2-architecture.md
modified_files:
  - src/lib/tasks/manager.ts
  - src/lib/tasks/harvester.ts
  - src/lib/tasks/harvester.test.ts
  - src/lib/xtmux/pty.ts
  - src/server.ts
priority: high
ordinal: 15000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
lib/tasks/harvester.ts (§5.5): a single ~30 s interval over live tasks. Harvest only when ALL hold: lifecycle=live, agent_state=idle (never busy or needs_attention), zero attached views across all clients, now - idle_since > harvest_after (default 30 min, configurable, 0 = never), and no shell PTY has a foreground process other than the shell (getForegroundPid). Harvesting: snapshot, kill every PTY of the task, lifecycle=suspended, broadcast. Risk 3: when in doubt, do not harvest.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A task is harvested only when every guard in §5.5 holds; each guard has a test that blocks harvest on its own
- [x] #2 harvest_after is configurable and 0 disables the idle harvester
- [x] #3 Harvest snapshots, kills all of the task's PTYs (agent and shells), sets lifecycle=suspended, and broadcasts a task delta
- [x] #4 The interval never throws out of its tick; one failing task does not stop others being evaluated
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Split the action from the decision. TaskManager.suspendTask(taskId) does the harvesting itself — snapshot, kill every PTY of the task, drop the ptyToTask/taskPtys entries, lifecycle=suspended, broadcast — and keeps the row and the task directory. The harvester only decides *whether*. TASK-16's manual close is then this same method minus the guards, which is exactly what §5.5 says it should be.
2. Pty.hasForegroundProcess(): Promise<boolean> — public wrapper over the existing private getForegroundPid, true when the tpgid differs from the shell's own pid. An unknown answer (ps failed, timed out, the mount is wedged) returns TRUE, blocking the harvest: Risk 3 says when in doubt do not harvest, and 'could not tell' is doubt.
3. lib/tasks/harvester.ts: a ~30s interval over live tasks. All five guards from §5.5, each a separate predicate so each gets its own blocking test: lifecycle=live; agent_state=idle (never busy, never needs_attention); zero attached views summed across every PTY of the task; now - idle_since > harvest_after, with a null idle_since blocking; and no PTY carrying a foreground process other than its shell.
4. harvest_after: default 30 min, settable (setHarvestAfter, matching the existing setHookGrace/setStartTimeout/setCwdRefreshWindow pattern), 0 = never and the interval does no work at all.
5. Robustness: every task's evaluation is individually try/caught so one bad task cannot end the tick, and the tick itself can never reject. The interval is unref'd so it never holds the process open by itself, and stop() exists for tests and shutdown. server.ts starts it after reconcileOnBoot.
6. Tests: each of the five guards blocking harvest on its own; harvest_after=0 disabling; a successful harvest doing all four things (file written, PTYs dead, row suspended, delta broadcast); and a task that throws mid-tick leaving the others still evaluated.

Note: agent_state stays 'idle' through a harvest — it is what was true and what the sidebar should show. reconcileOnBoot's 'unknown' is for the different case where the daemon never saw the process die.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Landed as planned; no design change was needed.

Guard coverage was verified by mutation, not just by the tests passing: each of the five predicates was replaced with `true` in turn and the suite re-run. Four of them fail a test on their own straight away. The lifecycle guard did not, because `liveTasks()` filters on the same column, so a suspended row never reaches it in the ordinary path — the guard is there for the race the tick actually has (a sweep spawns a `ps` per terminal and can take seconds to reach a given task, during which a resume, a manual close or an attach can move the row). It is now covered by a test that hands the tick a listed row whose lifecycle has since changed, which is exactly that race, and which fails with the guard removed.

Two things worth recording:
- `bash -i` plus a written `sleep` is a real foreground-process case, so that guard is tested against a live `ps` rather than a stub. A non-interactive `sh -c` is not: it runs its command in its own process group and is indistinguishable from an idle shell from outside. The could-not-tell arm is tested separately by making `runCapture` answer "" — what a failed, timed-out or missing `ps` actually produces.
- `tick()` takes a re-entrancy flag beyond the plan. The last guard costs a bounded 2s `ps` per terminal, so a daemon with enough live tasks can take longer than one 30s interval to walk them, and two overlapping sweeps would evaluate guards against a task the other is mid-way through killing.

`suspendTask` clears `disarmHookGrace`, `hookSeen` and `cwdCheckedAt` — the three pieces of `closeTask`\s bookkeeping that are claims about a running process rather than about a task. It leaves the row, the task directory, the project placement and `agent_state` alone.

Validation: bun test 438 pass / 0 fail across 35 files (resume.test.ts included, no flake this run); bunx tsc --noEmit clean.

Review + verify after implementation.

Sequencing bug caught in review and fixed here: the harvester shipped enabled with the specced 30-minute default, but nothing in the frontend can render or reopen a suspended task — fromTask does not carry lifecycle, and no client code calls POST /api/tasks/:id/resume. A five-task user would have had four agents killed thirty minutes after they stopped typing, with the sidebar still showing those tasks as normal and clicking them doing nothing. DEFAULT_HARVEST_AFTER_MS is therefore 0 (off) and the exported THIRTY_MINUTES_MS is what TASK-16 flips it to alongside the resume affordance. The interval is still armed at boot so turning it on is a setting, not a restart. Covered by a test that builds the daemon's own harvester rather than the switched-on one the suite's helper hands out.

Also fixed in review: the guards read the TaskRow captured by liveTasks() at the top of the tick, but the last guard spawns a bounded ps per terminal, so a sweep can span minutes — a task that went busy after it was listed was still harvested and its agent killed mid-turn. nothingRunning cannot catch that, because an agent is its own PTY's foreground process. shouldHarvest now re-reads the row and re-checks attached views on the far side of that await.

Validation: bun test 441 pass / 0 fail; bunx tsc --noEmit clean. Runtime drive on an isolated in-memory db: the shipped default harvested nothing; switched on it suspended the row, kept agent_state=idle, wrote scrollback.ans, persisted last_size 110x28, killed the PTY and kept both the row and the task directory. Each of the five guards was then shown to block on its own — busy, not-idle-long-enough, null idle_since, an attached view, and a real foreground process (bash -i running sleep 30, which does the tcsetpgrp a non-interactive shell does not). Daemon boots with the harvester wired and /api/shutdown stops it cleanly.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added lib/tasks/harvester.ts: a 30s unref'd sweep applying §5.5's five guards, with TaskManager.suspendTask doing the harvesting itself (snapshot before kill, since kill disposes the terminal) so TASK-16's manual close is literally the same path minus the guards. Pty.hasForegroundProcess answers true when it cannot tell, so a wedged ps declines the harvest rather than killing a working agent. Ships OFF (harvest_after 0) because nothing can yet reopen a suspended task; TASK-16 flips it to THIRTY_MINUTES_MS with the resume affordance. Verified with bun test (441/0), tsc, and a runtime drive proving each guard blocks alone.
<!-- SECTION:FINAL_SUMMARY:END -->
