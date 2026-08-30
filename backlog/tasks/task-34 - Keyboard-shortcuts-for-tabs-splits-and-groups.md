---
id: TASK-34
title: 'Keyboard shortcuts for tabs, splits, and groups'
status: To Do
assignee: []
created_date: '2026-08-29 00:03'
updated_date: '2026-08-30 00:34'
labels:
  - frontend
milestone: m-5
dependencies:
  - TASK-22
documentation:
  - docs/v2-architecture.md
ordinal: 34000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
§10 Phase 6: tab navigation (next/prev, jump to N), split, close tab, move focus between groups, focus the agent tab, new shell. Shortcuts must not steal keys the agent terminal needs while it is focused.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Documented shortcuts exist for next/prev tab, close tab, split, focus group left/right, focus agent tab, new shell
- [ ] #2 Shortcuts do not fire while typing in a terminal unless they use a reserved modifier chord
- [ ] #3 Shortcuts are listed in the command palette
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Build against `frontend/components/v2/` — the v2 design system is the new UI, not a parallel track (CLAUDE.md, "The v2 design system is the new UI"). `AppShell` and the shell components already exist from TASK-46; this task supplies their data. Do not extend `components/ui/` (v1 shadcn) for new surfaces.
<!-- SECTION:NOTES:END -->
