---
id: TASK-136
title: Changed rows highlight and fade as an agent edits files
status: Done
assignee:
  - '@claude'
created_date: '2026-11-05T06:59:00Z'
updated_date: '2026-11-05T08:02:00Z'
labels:
  - frontend
dependencies: []
ordinal: 138000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
While an agent works, the Explorer lists (Changes, Files, Backlog), file trees and open diffs update in place, but nothing marks what just changed, so you cannot tell which file the agent touched a moment ago without reading the whole list again. A row or hunk that changes should flash a highlight that fades over a few seconds, so where activity is happening is visible at a glance.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A row that appears in or changes in the Changes list, the Files tree or the Backlog section gets a highlight that fades out over a few seconds
- [x] #2 An open diff or file tab whose content updates marks the changed lines or hunks the same way
- [x] #3 Nothing highlights on first load, on a remount or tab switch, or when a list is re-fetched with no actual change
- [x] #4 Repeated changes to the same row restart its fade rather than stacking
- [x] #5 The highlight colour comes from a v2 semantic token and the fade is skipped under prefers-reduced-motion
- [x] #6 Rendering tests cover a change highlighting, an unchanged refetch not highlighting, and the restart on repeat
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. change-pulse-store.ts: per-root map of path to {at, seq, ignored}, fed from TaskContext's changed frames for the same roots the invalidation reaches; clock injected; entries expire after the fade. useChangePulses(rootId) hook with a mount-time baseline, so only changes after a list mounted flash (no flash on load, remount or tab switch; a row that appears after the change still flashes). 2. Row highlight on the Explorer Changes tree, Files tree (collapsed directories roll up their descendants, ignored writes excluded from the roll-up) and Backlog cards; DiffLayout's tree too for working-tree diffs. 3. Line highlight: utils/changedLines.ts (prefix/suffix trim, LCS over the middle under a cell cap, multiset fallback) and useChangedLines(identity, lines) giving the changed line set per update; FileContent source view and DiffFile hunks, working tree only (FileViewer without sha, DiffView and DiffFilePane), so commit views never flash. 4. CSS: --changed semantic token (blue wash, light and dark), two identical keyframes alternated by pulse parity so a repeat change restarts the fade; inset box-shadow so row backgrounds are untouched; reduced motion holds the tint and drops it without fading. 5. Tests: changedLines and store unit tests; rendering tests for a change highlighting, an unchanged refetch not highlighting, a remount not highlighting, and the restart on repeat. 6. Wiki: change-watcher page section on highlighting, index, log.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Browser check found the restart broken: one store-wide counter set the class parity, so an odd number of other paths changed in between left a row on the class it already had and its second change did not flash. Sequences are now per path, and directories get pulses of their own per frame.

Code review (high, with fix) raised 8 findings; 7 fixed. Fixed: the diff tab's tree dated its baseline from DiffLayout's mount, which DiffView swaps out for No changes, so the first file into an empty diff never flashed (DiffView now holds the baseline, useChangeBaseline); a new hunk lit its context lines (only added and removed lines light, context only when nothing else did); the baseline did not reset when a mounted section switched roots; DiffLayout subscribing re-rendered every DiffFile per frame (the subscription moved into a FlashingFileTree); dead roots kept their pulses (ChangePulseStore.retain beside retainTaskViewStates); line bookkeeping ran for commit diffs (skipped when off); the line flash sequence restarted after each clear (now a mount-long counter). Left: PULSE_MS and --duration-change-flash are two constants kept in step by comments. Not rechecked in the browser after review: the review fixes are covered by rendering tests.

Rechecked after review on an isolated server: an edit opening a second hunk in a README diff tab flashed only the removed and added line, none of the six context lines it brought.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Rows and lines the agent just changed now flash a blue wash (--changed) that holds briefly and fades over three seconds. Rows (Explorer Changes, Files with collapsed directories standing in for their contents, Backlog cards, a diff tab's tree) are driven by the changed frames through change-pulse-store.ts, so an edited file flashes even when its row data is unchanged; lines (a file tab's source view, working-tree diff hunks) are driven by comparing content in useChangedLines. A list starts quiet from when it mounted or switched root, a refetch with no change and a commit view never flash, ignored writes do not light ancestors, a repeat change restarts the fade (per-path parity on two identical keyframes), and reduced motion holds the tint then drops it in one step. Review: 7 of 8 findings fixed, see notes. Verified on an isolated server (port 4599) in Chrome: a new file's Changes row, a diff tab and a file tab flashing only the rewritten lines, a Backlog card flashing on a backlog CLI edit, a second write restarting the fade with another file written in between (this found the store-wide counter bug, fixed), and the reduced-motion rule present in the served CSS. bun run typecheck clean; vitest 557 pass; bun test 2086 pass on a clean run, with one load timeout in manager.test.ts on a later run that passes alone. Follow-up: push the --changed token to the Claude Design v2 project.
<!-- SECTION:FINAL_SUMMARY:END -->
