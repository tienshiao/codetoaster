---
id: TASK-33
title: Mobile pass on the new shell
status: To Do
assignee: []
created_date: '2026-08-29 00:03'
updated_date: '2026-08-30 00:34'
labels:
  - frontend
  - mobile
milestone: m-5
dependencies:
  - TASK-28
documentation:
  - docs/v2-architecture.md
ordinal: 33000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Risk 6 (§9): v1 has real accumulated mobile work — touch scrolling in the alt buffer, pinch, keyboard viewport, sidebar sheets. Below the mobile breakpoint force a single tab group and render both sidebars as sheets. Re-verify every v1 touch fix on the new shell explicitly.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Below the mobile breakpoint there is exactly one tab group and split is unavailable
- [ ] #2 Task list and Explorer open as sheets on mobile
- [ ] #3 Alt-buffer touch scrolling, pinch, and keyboard viewport handling work as in v1 (checked on a real device)
- [ ] #4 The composer is usable on a phone
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Build against `frontend/components/v2/` — the v2 design system is the new UI, not a parallel track (CLAUDE.md, "The v2 design system is the new UI"). `AppShell` and the shell components already exist from TASK-46; this task supplies their data. Do not extend `components/ui/` (v1 shadcn) for new surfaces.
<!-- SECTION:NOTES:END -->
