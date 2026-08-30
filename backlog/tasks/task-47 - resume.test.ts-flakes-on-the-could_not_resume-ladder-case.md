---
id: TASK-47
title: resume.test.ts flakes on the could_not_resume ladder case
status: To Do
assignee: []
created_date: '2026-08-30 00:09'
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
- [ ] #1 The failing assertion and its actual-vs-expected values are captured from a real failing run
- [ ] #2 The test is deterministic: 50 consecutive runs of resume.test.ts pass
- [ ] #3 The fix removes the timing dependency rather than widening a timeout or adding a retry
<!-- AC:END -->
