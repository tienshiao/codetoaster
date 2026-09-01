---
id: TASK-78
title: Hover-revealed row actions are invisible but still clickable
status: To Do
assignee: []
created_date: '2026-09-01 17:57'
labels:
  - frontend
  - ui
  - mobile
milestone: m-5
dependencies:
  - TASK-33
references:
  - src/frontend/components/v2/AppShell.tsx
ordinal: 78000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Both hover-revealed action strips in the sidebar — `RowActions` (AppShell.tsx:161) and the project group's strip (AppShell.tsx:455) — hide themselves with `opacity-0` and nothing else. Opacity does not remove a hit target, so every button in those strips is clickable while fully invisible.

On a pointer this is nearly harmless: the strip only fails to be visible when the pointer is not on the row, and moving the pointer onto it reveals it first. On touch there is no hover, so the strip is never revealed and the buttons are permanently invisible and permanently live. TASK-77 widened the project strip by one button, so the right end of a project header now navigates to the composer on a tap that was meant to collapse the group.

The obvious fix is `pointer-events-none` alongside the `opacity-0`, re-enabled in the same `group-hover`/`group-focus-within` variants. It is filed rather than applied because it is a convention both strips share deliberately, and because the touch answer may not be "reveal on hover, hidden otherwise" at all — a phone may want the actions always visible, or behind a long-press. That is TASK-33's call, on a device.

Note for whoever takes it: `RowActions`' doc comment already explains that opacity paints the whole subtree regardless of a descendant's position, which is why anything outliving the hover portals out. `pointer-events` has the same reach, so a portalled dialog opened from the strip is unaffected, but anything left inline is not.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The buttons in RowActions and in the project group's action strip are not clickable while the strip is hidden
- [ ] #2 Tapping the right end of a project header on a touch device collapses the group rather than opening the composer
- [ ] #3 A dialog or menu opened from a row action still works once the pointer leaves the row (portalled content is unaffected)
- [ ] #4 Whatever touch affordance TASK-33 settles on for row actions is applied to both strips, not just one
<!-- AC:END -->
