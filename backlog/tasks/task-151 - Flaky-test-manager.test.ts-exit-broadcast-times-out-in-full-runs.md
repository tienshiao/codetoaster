---
id: TASK-151
title: 'Flaky test: manager.test.ts exit-broadcast times out in full runs'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-11-23T03:30:00Z'
updated_date: '2026-11-23T15:16:00Z'
labels:
  - test
  - bug
dependencies: []
references:
  - src/lib/tasks/manager.test.ts
ordinal: 154000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The test "broadcasting > an exiting terminal marks the task exited and sends the row" (src/lib/tasks/manager.test.ts, around line 796) times out at about 4 seconds waiting for the exited row in full bun test runs, and passes when the file runs on its own (99/99). On 2026-11-23 it failed in every full run seen across four branches (TASK-146, TASK-147, TASK-148 worktrees and the combined v2 head), and also on an untouched v2 checkout, so no change from those tasks introduced it. Because bun run test chains test:unit && test:render, this one failure stops the render suite from running at all, which hides render regressions and breaks the commit gate in CLAUDE.md. The cause is unknown: likely load-sensitive timing in the wait (a real PTY exit under a busy machine), but it could also be cross-file state. The test rules (waitFor from test/wait.ts, no bare sleeps, injected clocks) apply to the fix.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The root cause is identified and recorded in the task notes (timing under load, cross-file state, or something else)
- [ ] #2 The test passes in at least five consecutive full bun run test runs on a loaded machine, and still passes on its own
- [ ] #3 The fix keeps the test asserting what it did: the task is marked exited and the row is broadcast; it does not just raise the timeout without a reason
- [ ] #4 If the cause is a product bug rather than the test, it is fixed with its own test
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Reproduce in isolation with rerun-each to separate timing from cross-file state. 2. Probe Bun.spawn and Pty directly to locate where the exit is lost. 3. Fix in Pty so an exit that arrived with no listener reaches the first one, on a microtask. 4. Deterministic pty.test.ts case; rerun-each 2000 on the manager test; five full bun run test runs under load. 5. Wiki gotcha page, review, verify.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Root cause (AC1): a product bug, not load or cross-file state. Bun 1.4.4 sometimes runs Bun.spawn's onExit synchronously inside the spawn call when the child is already gone (stack: onExit <- spawn <- new Pty). Pty spawns in its constructor and registers listeners through a setter, so that exit fired with no listener and was dropped: pty.exited true, row left at starting forever. Rates: manager test 4/300 and 2/300 failing in isolation with nothing else running; a Pty loop of true missed 1/400 and 3/1000; raw Bun.spawn showed no sync call in 3000 tries, so it depends on timing. The earlier claim that every full run failed did not reproduce here: the first unfixed full run passed.

Fix: Pty holds an exit that arrived with no listener (exitUnheard) and releases it to the current listener on a microtask at the first onExit registration. pty.test.ts gains a deterministic case (wait for exited, then register) that fails without the fix, and a registered-in-time case. Evidence: manager exit test 750 consecutive reruns, 0 fail (150 + 600, the 600 under load average ~100 from iOS simulators another session was running); before the fix about 1.3 percent failed. Probe of 3000 Pty spawns of true: 0 missed exits (was about 3 per 1000). Isolated server (SHELL=/usr/bin/true, shell profile): 400 of 400 tasks ended exited. A 2000-rerun started while the machine was at load average ~830 had 5 harness timeouts (6-10 s, event loop starved) and Bun's dangling-process killer reporting hundreds of processes: those were the checkout watcher's git children outliving a starved test, killed by bun test and left as zombies until reaped; gitSpawn waits on every child, including killed ones, so this is not a product leak. Review (/code-review high --fix): no important findings; held exit now goes to the current listener; comment and wiki wording fixed. Pre-existing, not fixed here: a signal-killed agent is recorded as exit_code 0 (exitCode ?? 0 drops signalCode).
<!-- SECTION:NOTES:END -->
