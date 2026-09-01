---
id: TASK-72
title: 'Dragging a tab shows no proxy, only a dimmed original'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-01 00:07'
updated_date: '2026-09-01 05:13'
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
- [x] #1 A translucent proxy of the tab follows the pointer for the length of the drag
- [x] #2 An insertion marker shows where the tab would land, at the index dropIndexAt computes
- [x] #3 A press that never passes the drag threshold is still a click that selects the tab
- [x] #4 The proxy is torn down on release, on Escape, and if the component unmounts mid-drag — no gesture outlives the pointer
- [x] #5 Dragging into another group is shown before it is committed, not committed on entry
- [x] #6 A drag does not select text in the panes it crosses
- [x] #7 The reorder commits on release, not live: the strip does not reshuffle under the pointer mid-gesture
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. `index.css`: the `body[data-resizing="col"]` guard already suppresses selection and forces a cursor for a divider drag. Generalise it so a tab drag gets the same treatment under `body[data-dragging="tab"]` with `cursor: grabbing` — AC #6, and the precedent is exact.
2. `TabArea.tsx`: widen the `draggingId` state into a `drag` carrying the tab id plus the proxy's geometry — the dragged tab's width and the pointer's offset within it, both measured at pointerdown so the proxy is grabbed where it was picked up rather than snapping its corner to the cursor.
3. Draw the proxy through a portal to `document.body`: the strip is `overflow-hidden` and a proxy that stops at the strip's edge is not carrying anything. `pointer-events-none`, and deliberately no `data-tab-id` — `boxesIn` and `elementFromPoint` must not see it.
4. Position it imperatively: a ref written from the pointermove handler, re-applied by a `useLayoutEffect` with no dep array. A dependency-free effect is the point — `setDropTarget` re-renders mid-drag, and a transform living in an inline style would be reset to the position the drag started at on every one of those renders.
5. Escape cancels, wired into `listen` so its keydown listener is removed by the same `done` that removes the pointer ones — one teardown path, so release, pointercancel, Escape and unmount cannot diverge. Clearing `data-dragging` goes in the finish handler for the same reason.
6. Tests in `TabArea.render.tsx`: the proxy appears only past the threshold, Escape cancels the move and tears it down, release tears it down, and unmounting mid-drag leaves neither a proxy nor the body attribute.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Decided up front (user, 2026-09-01): the reorder commits on **release**, not live. Live reordering means the drop target moves under the pointer during the gesture, which is the thing a proxy and an insertion marker exist to make legible — so keeping it would fight the fix.

Two consequences for whoever picks this up:

- `moveIndexFor` exists to absorb the off-by-one from `moveTab` removing before inserting, and its "dropping either side of yourself is a no-op" guard was written to stop a jitter of one-pixel moves rewriting the layout on every `pointermove`. With one commit per gesture there are no per-move rewrites left to suppress, but the off-by-one is still real, so the function stays and the guard becomes cheap rather than load-bearing. Do not delete it along with the live path.
- The cross-group move currently commits the moment the pointer enters another group. That goes too: entering a group previews, releasing commits.

## Implemented

Three of the seven criteria were the real work; the rest already held (see the scope comment above).

**The proxy** (`TabArea.tsx`). Portalled to `<body>` rather than rendered into the strip: every strip is `overflow-hidden`, so a proxy drawn inside the one it came from would vanish at that group's edge — which is exactly where a cross-group drag is going. It carries `pointer-events-none` and deliberately no `data-tab-id`, or `boxesIn` and `elementFromPoint` would hit-test against the thing being dragged.

Its position never goes through state. A `TabArea` render is every group, strip and mounted pane, and a drag across one strip would pay that a hundred times, so the transform is written straight to the node from the pointermove handler. That has one hazard worth naming: `setDropTarget` re-renders the component mid-drag, and a transform React does not know about is one React will not restore — so a `useLayoutEffect` **with no dependency array** re-applies it after every render. The missing array is the point, not an oversight, and it also covers the frame the proxy mounts on. `the proxy keeps its place across a re-render mid-drag` is the regression test for exactly that.

The grab offset is measured at pointerdown, not when the threshold is crossed: by then the pointer has moved, and what matters is where inside the tab the user actually pressed. Verified in the browser — grabbed 30px into a 140px tab, the proxy stayed 30px left of the cursor for the whole gesture.

**Escape** goes through the same `done` as pointerup, pointercancel and unmount. Four exits from one gesture is four chances to leave a proxy on screen unless they are one path, so the keydown listener is registered and removed alongside the pointer ones.

**Selection** (`index.css`). `body[data-resizing="col"]` already existed for `ResizeHandle`; the guard is now shared with `body[data-dragging="tab"]`, with the cursor stated per gesture since `col-resize` and `grabbing` differ. Set on `<body>` for the same reason as the divider: the pointer spends the drag over panes, not over the strip.

## Validation

`bun run test` — 974 unit + 147 render, 0 fail. `tsc --noEmit` clean. Four new tests in `TabArea.render.tsx`.

Driven in a real browser (`verify` skill, isolated instance on :4599) by dispatching pointer events, since the interesting states only exist mid-gesture:
- Proxy: `position: fixed`, `opacity 0.75`, `z-50`, width tracking the source tab's 140px, no `data-tab-id`, transform exactly pointer-minus-grab.
- Source tab dimmed to 0.4; marker 2px primary, on the correct edge — leading edge of the tab aimed at, and the last tab's trailing edge for an append.
- `body`: `data-dragging="tab"`, computed `cursor: grabbing`, `user-select: none`; all three gone after release.
- Release committed the move; Escape left the order untouched and a pointerup arriving *after* Escape did not resurrect it. No console errors.

AC #5 (cross-group previewed, not committed on entry) was verified by reading the commit path rather than by driving a split in the browser — the move has one call site, in the finish handler, so the group a drop lands in cannot be committed before release.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude
created: 2026-09-01 05:02
---
Scope check before starting: the description is stale on its two central claims. It describes the drag as `TASK-22` first built it, but the gesture was restructured after (`5b72ddf` and the commits following), and as of `18b79fb`:

- The move already commits in the finish handler, not on every `pointermove` (`TabArea.tsx:230-243`). AC #7 holds today, and so does #5 — a cross-group drop is previewed by `dropTarget` and committed only on release.
- The insertion marker already exists: `dropBefore`/`dropAfter` draw a 2px primary rule at exactly the index `dropIndexAt` returns (`TabStrip.tsx:113-124`). AC #2 holds.
- AC #3 holds and is tested (`TabArea.render.tsx:106`). AC #4 holds for release, `pointercancel` and unmount; only Escape is missing.

So `moveIndexFor`'s no-op guard is already in the cheap-rather-than-load-bearing position the notes anticipated, and no live path remains to remove.

What is actually left is #1 (no proxy — the original merely dims), the Escape half of #4, and #6 (nothing suppresses selection; the description's "pointer capture stays as it is" refers to something the component does not do — it tracks on the window instead). Proceeding on those three.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A dragged tab is now carried: a translucent proxy follows the pointer, portalled to `<body>` so it survives the strip's `overflow-hidden` and can cross between groups. Escape abandons a drag the pointer is still holding, through the same teardown as release, cancel and unmount. A drag no longer paints the panes it crosses blue — `index.css`'s existing `ResizeHandle` selection guard is now shared with it, under `body[data-dragging="tab"]` with a grabbing cursor.

The other four criteria already held: the commit-on-release the notes called for, the insertion marker, the cross-group preview and the click threshold were all in place before this, having arrived with the fixes after TASK-22 — the description was describing code that had since been restructured. Recorded as a comment rather than silently narrowing the task.

The proxy's position is written imperatively and re-applied by a dependency-free layout effect, because `setDropTarget` re-renders mid-drag and React will not restore a transform it never rendered. Verified in a browser and by four new tests; `bun run test` 1121 pass, 0 fail.
<!-- SECTION:FINAL_SUMMARY:END -->
