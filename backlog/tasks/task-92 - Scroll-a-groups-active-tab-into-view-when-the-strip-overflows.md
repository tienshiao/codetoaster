---
id: TASK-92
title: Scroll a group's active tab into view when the strip overflows
status: To Do
assignee: []
created_date: '2026-09-06 08:06'
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
- [ ] #1 When a tab becomes active in a group whose strip overflows, the strip scrolls so that tab is fully visible, by whatever door made it active (click, drag, split, palette, Explorer, leader chord, ?tab= link)
- [ ] #2 No scroll happens when the active tab is already fully visible, and the strip's action cluster stays pinned and reachable
- [ ] #3 A rendering test covers the scroll being requested on activation; geometry-dependent behaviour is verified in Chrome with a group narrow enough to overflow
<!-- AC:END -->
