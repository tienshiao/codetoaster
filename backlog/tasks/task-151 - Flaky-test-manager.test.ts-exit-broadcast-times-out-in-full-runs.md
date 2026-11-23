---
id: TASK-151
title: 'Flaky test: manager.test.ts exit-broadcast times out in full runs'
status: To Do
assignee: []
created_date: '2026-11-23T03:30:00Z'
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
