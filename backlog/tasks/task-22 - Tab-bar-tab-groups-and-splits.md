---
id: TASK-22
title: 'Tab bar, tab groups, and splits'
status: To Do
assignee: []
created_date: '2026-08-29 00:02'
updated_date: '2026-08-30 00:34'
labels:
  - frontend
milestone: m-3
dependencies:
  - TASK-18
  - TASK-19
documentation:
  - docs/v2-architecture.md
priority: high
ordinal: 22000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
frontend/components/tabs/* (§7.1, §7.2): the VSCode-style tab area. Tab bar per group with drag-to-reorder and drag-to-another-group, split command (disabled on terminal tabs), close (disabled on the agent tab), preview tabs rendered italic with double-click to pin, group flex resizing. Groups are a flat horizontal row.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Tabs can be reordered within a group and moved between groups by drag
- [ ] #2 Split creates a new group to the right with the split tab; the Split command is disabled on agent and shell tabs
- [ ] #3 The agent tab shows no close affordance and cannot be closed by keyboard
- [ ] #4 Preview tabs render italic; double-click pins; a second single-click open replaces the preview
- [ ] #5 Closing the last tab in a non-first group removes the group
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Build against `frontend/components/v2/` — the v2 design system is the new UI, not a parallel track (CLAUDE.md, "The v2 design system is the new UI"). `AppShell` and the shell components already exist from TASK-46; this task supplies their data. Do not extend `components/ui/` (v1 shadcn) for new surfaces.
<!-- SECTION:NOTES:END -->
