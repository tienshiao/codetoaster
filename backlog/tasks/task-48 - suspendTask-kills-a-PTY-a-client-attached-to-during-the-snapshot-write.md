---
id: TASK-48
title: suspendTask kills a PTY a client attached to during the snapshot write
status: Done
assignee:
  - '@claude'
created_date: '2026-08-30 01:27'
updated_date: '2026-09-01 06:52'
labels:
  - server
  - tasks
  - bug
dependencies: []
documentation:
  - docs/v2-architecture.md
ordinal: 48000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by code review during TASK-19 (not introduced by it).

src/lib/tasks/manager.ts — shouldHarvest deliberately re-runs rowAllows/hasNoAttachedViews on both sides of its own await, but suspendTask then awaits a real disk write before killing the PTYs, and that write is queued per task behind any earlier one. So there is a second, longer window with no guard.

Concrete: the harvester judges task T harvestable with zero attached clients; during the snapshot write the daemon services a WebSocket attach from a user who has just clicked T, and answers it with attached/restore; suspendTask then kills the PTY. The user watches the terminal they just opened die.

Not fixed in review because the correct guard is conditional on the caller: a user's own closeTask must still suspend a task they are attached to, so this changes suspendTask's contract rather than adding a check. Options worth weighing: a precondition callback threaded from Harvester, splitting harvest() from suspendTask(), or re-checking hasNoAttachedViews only on the harvest path.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A client that attaches during the snapshot write does not have its PTY killed by a harvest already in flight
- [x] #2 A manual close still suspends a task the closing client is attached to
- [x] #3 A test covers the attach-during-write race on the harvest path
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. `manager.ts` — one implementation, two doors. `suspendTask(taskId)` stays exactly what it is (unconditional, what `closeTask` and `doArchive` call); add `harvestTask(taskId, stillHarvestable)` beside it. Both delegate to a private `putDown`, which carries the resume-settling and dedupe logic unchanged, and the predicate is threaded down to `doSuspend`.

This is option 1 in the task, and it is the one that keeps the file's own rule: `suspendTask`'s comment says whether a task should be harvested is the caller's question and does not belong in there. A predicate supplied by the harvester is still the caller's question — it is only *evaluated* at the one moment the caller cannot reach, after the snapshot write and before the kill. `closeTask` remains 'the harvest path minus the guards' literally, now including the late one.

2. `doSuspend` re-checks `stillHarvestable()` between `await this.snapshot()` and the kill loop, and returns false without touching the PTYs if it has stopped being true. The snapshot already on disk is not rolled back — it is the screen the task actually had, and the task stays live to be re-snapshotted next tick.

3. The dedupe needs widening, or the fix introduces its own bug. `this.suspending` currently maps to a bare promise and every caller joins it. A manual close that joins a *harvest* in flight would adopt its verdict — so a user clicking close during the snapshot write would have the harvest abandon on their own attach and their click silently report false. So the map holds `{ done, conditional }`, and an unconditional caller that finds a conditional attempt awaits it and retries, mirroring what `suspendTask` already does for a resume in flight. A harvest joining anything, and a close joining a close, still just join.

4. `resumeTask` (manager.ts:1377) reads `this.suspending.get(taskId)` directly and has to follow the shape change to `.done`.

5. `harvester.ts` — `sweepIdle` calls `harvestTask` with `() => this.rowAllows(id, now) && this.hasNoAttachedViews(id)`, the same pair `shouldHarvest` already re-checks on the far side of its own await. Reusing it verbatim means the late guard cannot drift from the early one, and it catches 'went busy during the write' as well as 'someone attached'.

6. Tests in `harvester.test.ts`: a client attaching during the snapshot write leaves the task running (AC #1/#3), following the existing 'attached while the guards ran' idiom but hooking `manager.snapshot` so the attach lands after the write and before the kill. Plus: a manual close of a task the closing client is attached to still suspends (AC #2), and a close arriving during a harvest that then abandons still suspends rather than inheriting the refusal.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implemented

`harvestTask(taskId, stillHarvestable)` beside `suspendTask(taskId)`, both delegating to a private `putDown`. The predicate is asked once more inside `doSuspend`, after `await this.snapshot()` and immediately before the first `kill`.

This keeps the rule the file already states — whether a task should be harvested is the caller's question — because the predicate *is* the caller's: `sweepIdle` hands over the same `rowAllows(id, now) && hasNoAttachedViews(id)` pair that `shouldHarvest` re-checks either side of its `ps`, rather than the manager learning what idle means. Passing it instead of reimplementing it is also what stops the late guard drifting from the early one. `closeTask` is untouched and still literally 'the harvest path minus the guards'.

A refused harvest leaves the snapshot on disk on purpose: it is the screen the task really had, the task stays live, and the next tick writes another. Nothing was killed, which is the point.

**The fix needed a second half to avoid introducing its own bug.** `this.suspending` mapped to a bare promise and every caller joined it, so a close landing during a harvest would adopt the harvest's verdict — and the commonest reason a harvest now refuses is a client attaching, which is exactly what a user who then clicks close has just done. Their click would report false and leave the task live. So the map carries `{ done, conditional }`, and an unconditional caller finding a conditional attempt waits it out and asks again, mirroring what a suspend already does for a resume in flight. Every other pairing still joins. `resumeTask` reads that map directly and followed the shape change.

## Validation

`bun run test` — 977 unit (+3) and 148 render, 0 fail; `tsc` clean.

The three new tests were checked against the unfixed behaviour rather than merely passing, since a race test that passes either way proves nothing:
- Late guard neutered, plumbing intact → `attached during the snapshot write` and `does not inherit its refusal` both fail.
- Dedupe branch neutered, late guard intact → `does not inherit its refusal` fails on its own.
- `a manual close still suspends a task the closing client is attached to` passes in both worlds, as AC #2's regression guard should.

No runtime browser pass: the window is a queued disk write inside the daemon and cannot be hit by hand. The tests open it deliberately by hooking `manager.snapshot` to attach between the write and the kill, which is the same idiom the existing 'attached while the guards ran' test uses one await earlier.

## Code review (`/code-review --fix`, post-commit)

One finding, and a fair one: the commit's own comment claimed the late guard was 'passed rather than reimplemented so it cannot drift from the early one', while the call site spelled the `rowAllows && hasNoAttachedViews` conjunction out a third time. Three copies is exactly the drift the comment was claiming to prevent — a fourth cheap guard would mean editing three lines and silently getting two-of-three. Extracted as `Harvester.cheapGuards(taskId, now)` and used at all three sites, so the predicate handed to `harvestTask` is now literally the function the early guards call. Behaviour-identical, short-circuit included.

No correctness defect found in the concurrency, which was the part worth a second pair of eyes. Confirmed independently of the review: no wait cycle is introduced (`doSuspend` never waits on `resuming`/`evicting`/`archiving`, and `putDown`'s new await sits after the `resuming` check); the `.finally` cannot delete a foreign entry, since a joiner adopts or awaits the finally-wrapped promise itself; and the late predicate is reached with no await before the first `kill`, so a synchronously-serviced attach really is visible to it.

The reviewer also flagged, and I agree, that re-asking `nothingRunning` late would be wrong rather than more thorough: a `ps` per terminal opens a fresh multi-second window of its own, and a process long enough to matter was already foreground at the early check.

Re-ran the neutering check after the refactor to confirm the guard is still load-bearing: with `stillHarvestable` disabled, the same two race tests fail. `bun run test` 977 + 148, 0 fail; `tsc` clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A harvest now re-checks its caller's guards from inside `doSuspend`, after the snapshot write and before the first kill — the window in which the daemon can answer a WebSocket attach with `attached`/`restore` and then kill the terminal the user just opened. `harvestTask` takes the predicate; `suspendTask` and so `closeTask` stay unconditional, so a user closing a task they are attached to still closes it.

Fixing it needed the in-flight suspend map to record whether the attempt may refuse: a close joining a harvest would otherwise inherit a refusal caused by its own user's attach. An unconditional caller now waits out a conditional one and asks again, the way a suspend already waits out a resume.

Verified by neutering each half in turn and confirming the right tests fail: the late guard carries two of them, the dedupe branch carries the third. 977 unit + 148 render, 0 fail.
<!-- SECTION:FINAL_SUMMARY:END -->
