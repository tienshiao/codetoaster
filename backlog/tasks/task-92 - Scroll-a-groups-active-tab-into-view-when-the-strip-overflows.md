---
id: TASK-92
title: Scroll a group's active tab into view when the strip overflows
status: Done
assignee:
  - '@claude'
created_date: '2026-09-06 08:06'
updated_date: '2026-09-06 08:46'
labels:
  - frontend
dependencies: []
ordinal: 96000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A group's tabs live in a hidden-scrollbar overflow-x container (TabStrip.tsx, from TASK-22, so the action cluster stays reachable in a narrow group). Nothing scrolls that container, so when a narrow group gains a tab — the palette or Explorer opening a file, a drag landing, a split — the new active tab sits past the visible end of the strip: it is selected but the user cannot see it and has no scrollbar to reach it. Seen during TASK-91's neighbouring fix: a diff split into two groups, a file opened from the palette into the left group, and the active tab hidden behind the + / find / split cluster.

VSCode's behaviour is the target: whenever the active tab changes, scroll the strip so that tab is fully visible, with the smallest scroll that achieves it (no jump when it already is). Cover the same for a tab that becomes active by click, keyboard (⌘K ] / ⌘K 1‑9) or the palette. Consider a scroll-wheel affordance too — horizontal wheel already works on an overflow container, but a vertical wheel over the strip could map to horizontal scroll the way editors do.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 When a tab becomes active in a group whose strip overflows, the strip scrolls so that tab is fully visible, by whatever door made it active (click, drag, split, palette, Explorer, leader chord, ?tab= link)
- [x] #2 No scroll happens when the active tab is already fully visible, and the strip's action cluster stays pinned and reachable
- [x] #3 A rendering test covers the scroll being requested on activation; geometry-dependent behaviour is verified in Chrome with a group narrow enough to overflow
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. components/v2/strip-scroll.ts: revealScrollLeft(scrollLeft, clientWidth, tabStart, tabEnd) — the smallest scroll that brings the tab fully into view, or the same scrollLeft when it already is; unit-tested under bun test.
2. TabStrip.tsx: a ref on the tabs' scroll container and a useLayoutEffect keyed on the active tab's id that measures the active tab against the container and writes the scrollLeft revealScrollLeft gives. Keyed on the id, not the layout: every door that changes the active tab changes that id, and a re-render that leaves it alone (a drag over the strip, a hint change) must not tug the strip. Plus a non-passive wheel listener that turns a vertical wheel over an overflowing strip into horizontal scroll — a mouse has no other way to reach a hidden tab.
3. TabStrip.render.tsx: geometry stubbed as TabArea.render does; activating an off-screen tab sets scrollLeft, activating a visible one leaves it.
4. Chrome: a split narrow enough to overflow, tabs opened from the palette and by chord, active tab visible each time; action cluster still pinned.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
strip-scroll.ts holds the arithmetic (revealScrollLeft: smallest scroll that shows the tab whole, leading edge for a tab wider than the strip, unchanged when already visible) under bun test. TabStrip keeps a ref on the tabs' scroll container and runs a layout effect keyed on the active tab's id — so every door that changes it (click, drag, split, palette, Explorer, chord, ?tab=) reveals, while a re-render that leaves it alone does not tug a strip the user wheeled away from. A ResizeObserver on the container re-reveals when the strip itself narrows (divider drag, window); it is made once and reads the current reveal through a ref, because an observer fires on attach and one rebuilt per render would snap the strip back on any re-render. A non-passive wheel listener turns a vertical wheel over an overflowing strip into horizontal scroll and consumes it; with room to spare the wheel passes through.

Verified in Chrome on :4599 with a split dragged to a ~40px strip: opening README from the palette scrolled it to the leading edge; ⌘K ] to the Agent tab scrolled back to 0; widening then narrowing the group kept the active tab in view (scrollLeft re-set within 100ms of the drag); a dispatched wheel event scrolled the strip 40px and was cancelled. The action cluster stayed pinned throughout. 1354 unit + 296 render tests green, tsc clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The strip scrolls its active tab into view whenever the active tab changes or the strip narrows, and a mouse wheel over an overflowing strip scrolls it sideways. Pure arithmetic in strip-scroll.ts under bun test, the effect and wheel handling under a TabStrip render test, and a Chrome pass on a split narrowed to a sliver.
<!-- SECTION:FINAL_SUMMARY:END -->
