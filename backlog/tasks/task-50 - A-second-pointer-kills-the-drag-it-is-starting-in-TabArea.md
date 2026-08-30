---
id: TASK-50
title: A second pointer kills the drag it is starting in TabArea
status: Done
assignee:
  - '@claude'
created_date: '2026-08-30 04:03'
updated_date: '2026-08-30 04:11'
labels:
  - frontend
  - bug
dependencies: []
ordinal: 50000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by code review during TASK-23; introduced by TASK-22.

src/frontend/components/tabs/TabArea.tsx - startDrag and startResize write their gesture to dragRef/resizeRef and *then* call listen(). But listen() begins with releaseRef.current?.(), which retires any gesture still installed by running its onFinish - and that handler's first act is dragRef.current = null / resizeRef.current = null. So when a gesture is still live, the release triggered by the new gesture nulls the ref the new gesture just wrote.

Concrete: a second finger lands on a tab before the first lifts (or a pointerup the window never saw left a gesture installed). The new drag's every pointermove reads null from dragRef and returns early, so the tab cannot be dragged and the boundary cannot be resized until both pointers lift and a fresh gesture starts cleanly. Nothing visibly breaks - the tab simply stops responding - which is why it survived the TASK-22 review.

The fix is to release before writing the ref rather than after, so the previous gesture's teardown cannot reach into the new one's state.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A gesture started while another is still installed can be dragged: dragRef survives the release that listen() performs
- [x] #2 The same holds for startResize and resizeRef
- [x] #3 The existing one-gesture-at-a-time guarantee is unchanged - no gesture outlives the component, and pointercancel still tears down cleanly
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed by calling releaseRef.current?.() at the top of startDrag and startResize, before the gesture ref is written, rather than leaving it to listen(). listen() still releases, but by then there is nothing installed, so the previous gesture's teardown can no longer reach into the new gesture's state.

Verified in a browser against a real task at /shell, by dispatching a pointerdown that never lifts and then driving a full drag with a second pointerId:

  down(Agent, id 1)          // a gesture left installed
  down(Changes, id 2)        // second pointer starts a real drag
  move past History, up

  post-fix:  [agent, diffAll, history] -> [agent, history, diffAll]
  pre-fix:   [agent, diffAll, history] -> unchanged (reordered: false)

The pre-fix run was a genuine revert of this file to HEAD with the server restarted, not a simulation, so the check is known to discriminate rather than assumed to.

No automated test: the gesture logic lives in the component and the repo has no React test harness - drag.test.ts covers only the pure helpers (dropIndexAt, moveIndexFor, resizeFlex), and the bug is in when the refs are written, which those functions never see. Worth revisiting if a component-test harness arrives.

bunx tsc --noEmit exits 0. bun test is 639 pass / 0 fail over three consecutive full runs. One earlier run showed a single failure whose name I did not capture; it did not reproduce in three full runs or eight runs of resume.test.ts, and TASK-47 documents a roughly one-in-eight flake in that file.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
startDrag and startResize now release any installed gesture before writing their own ref, instead of letting listen() do it afterwards - listen()'s release runs the previous gesture's finish handler, which nulls the ref just written, so a second pointer landing before the first lifted silently killed the drag it was starting. Verified in a browser by driving the two-pointer sequence against both the fixed and the reverted file: the tab reorders with the fix and does not without it.
<!-- SECTION:FINAL_SUMMARY:END -->
