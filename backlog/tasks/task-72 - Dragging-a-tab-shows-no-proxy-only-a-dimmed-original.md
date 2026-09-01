---
id: TASK-72
title: 'Dragging a tab shows no proxy, only a dimmed original'
status: To Do
assignee: []
created_date: '2026-09-01 00:07'
updated_date: '2026-09-01 00:12'
labels:
  - frontend
  - ui
  - polish
milestone: m-5
dependencies: []
ordinal: 72000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A tab drag in `TabArea` sets `dragging` on the tab, which `TabStrip` draws as `opacity-40`, and rewrites the layout live as the pointer crosses each midpoint. So the only feedback is that the source tab fades and the strip reshuffles underneath — nothing follows the cursor, and there is no mark saying where the drop will land.

The consequences are worse than cosmetic. Reordering live means the strip changes under the pointer during the gesture, so the thing being aimed at moves; and dragging between groups commits a cross-group move at the moment the pointer enters, rather than on release. There is nothing that reads as "carrying" a tab, and nothing that says where it would go if released now.

A translucent proxy following the pointer, plus an insertion marker at the computed drop index, is the fix. The arithmetic is already there and already tested — `dropIndexAt` and `moveIndexFor` in `components/tabs/drag.ts` answer exactly "which side of that tab did I drop on", and this is the DOM half that was never built on top of them. The drag threshold (`DRAG_THRESHOLD`, so a press is still a click) and pointer capture stay as they are.

Whether the reorder still commits live behind the proxy or waits for the release is the design question in this. Committing on release is the more conventional answer and stops the target moving mid-gesture, but the existing live behaviour is what the `moveIndexFor` no-op guard was written for, so changing it means checking that guard is still earning its place.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A translucent proxy of the tab follows the pointer for the length of the drag
- [ ] #2 An insertion marker shows where the tab would land, at the index dropIndexAt computes
- [ ] #3 A press that never passes the drag threshold is still a click that selects the tab
- [ ] #4 The proxy is torn down on release, on Escape, and if the component unmounts mid-drag — no gesture outlives the pointer
- [ ] #5 Dragging into another group is shown before it is committed, not committed on entry
- [ ] #6 A drag does not select text in the panes it crosses
- [ ] #7 The reorder commits on release, not live: the strip does not reshuffle under the pointer mid-gesture
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Decided up front (user, 2026-09-01): the reorder commits on **release**, not live. Live reordering means the drop target moves under the pointer during the gesture, which is the thing a proxy and an insertion marker exist to make legible — so keeping it would fight the fix.

Two consequences for whoever picks this up:

- `moveIndexFor` exists to absorb the off-by-one from `moveTab` removing before inserting, and its "dropping either side of yourself is a no-op" guard was written to stop a jitter of one-pixel moves rewriting the layout on every `pointermove`. With one commit per gesture there are no per-move rewrites left to suppress, but the off-by-one is still real, so the function stays and the guard becomes cheap rather than load-bearing. Do not delete it along with the live path.
- The cross-group move currently commits the moment the pointer enters another group. That goes too: entering a group previews, releasing commits.
<!-- SECTION:NOTES:END -->
