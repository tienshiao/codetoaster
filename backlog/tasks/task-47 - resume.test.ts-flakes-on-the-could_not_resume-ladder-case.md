---
id: TASK-47
title: resume.test.ts flakes on the could_not_resume ladder case
status: To Do
assignee: []
created_date: '2026-08-30 00:09'
updated_date: '2026-08-30 08:39'
labels:
  - test
  - flaky
dependencies: []
ordinal: 47000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`resume.test.ts` > "when nothing opens, the task is a card with a button, not a dead terminal" (src/lib/tasks/resume.test.ts:254) fails roughly one run in eight.

Measured: 8 runs of the file on the current tree gave 1 failure; 8 runs with the TASK-46 code-review's manager.ts/snapshot.ts fixes stashed gave 1 failure. So the flake is pre-existing and not caused by the suspendTask-awaits-resume change — it was simply not noticed until the file was run in a loop.

The test drives the full ladder with both rungs failing, so it depends on `awaitAgentStart` timing out twice against a fake agent; the assertion that most plausibly loses the race is `expect(await agent.settled(2)).toHaveLength(2)`, which wants both spawns to have settled. Worth capturing the actual failing assertion before fixing — a single loop run reproduces it often enough.

A one-in-eight flake in the resume path is the kind that erodes trust in the suite exactly where the suite matters most, so it should be made deterministic rather than retried.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The failing assertion and its actual-vs-expected values are captured from a real failing run
- [ ] #2 The test is deterministic: 50 consecutive runs of resume.test.ts pass
- [ ] #3 The fix removes the timing dependency rather than widening a timeout or adding a retry
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC#1 satisfied — captured from a real failing run on 2026-08-30:

  expect(received).toBe(expected)
  Expected: "could_not_resume"
  Received: "starting"
  at src/lib/tasks/resume.test.ts:269
  (fail) resuming a suspended task > when nothing opens, the task is a card with a button, not a dead terminal

Mechanism, from the code review: `setStartTimeout(400)` races the stand-in agent, which is a /bin/sh script that has to be spawned, exec'd, write its log line and exit before the cap decides it stayed alive. When the cap wins, a rung that failed is recorded as a success — hence 'starting' where the ladder should have exhausted itself into 'could_not_resume'.

Two things tried and their results:
- `awaitAgentStart`'s cap now resolves `!pty.exited` instead of a bare `true` (landed, independently correct — the cap means 'quiet but still up', and a corpse is neither). This narrows the window but does NOT close it: still reproduced 1 run in 12 at 400ms.
- The review widened the cap to 1000ms. Reverted: that is precisely what AC#3 rules out, and it took the file from 9s to 19s.

So the remaining work is AC#2 and AC#3, and the shape of the fix is now clear: the test must not race the stand-in at all. The agent stub should signal its outcome deterministically — awaiting the spawned process's exit, or having the fake write a marker the harness waits on — so 'the rung failed' is observed rather than inferred from a wall clock.
<!-- SECTION:NOTES:END -->
