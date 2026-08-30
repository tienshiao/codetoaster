---
id: TASK-26
title: 'Right-hand Explorer: Changes, Files, History, Refs'
status: To Do
assignee: []
created_date: '2026-08-29 00:03'
updated_date: '2026-08-30 00:34'
labels:
  - frontend
milestone: m-3
dependencies:
  - TASK-22
  - TASK-23
documentation:
  - docs/v2-architecture.md
ordinal: 26000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
frontend/components/Explorer.tsx (§7.1): a collapsible right sidebar hosting the trees that today occupy full tabs — the diff FileTree (Changes), the file browser tree (Files), CommitList/CommitGraph (History), and RefSidebar (Refs). Selections open tabs through the layout store: single click = preview tab, double click = pinned.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each of the four sections renders the existing tree component against the current task
- [ ] #2 Single-clicking an entry opens a preview tab of the right kind; double-click pins it
- [ ] #3 Clicking an entry whose tab is already open focuses it instead of duplicating
- [ ] #4 The Explorer collapses and remembers its collapsed state per device
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Build against `frontend/components/v2/` — the v2 design system is the new UI, not a parallel track (CLAUDE.md, "The v2 design system is the new UI"). `AppShell` and the shell components already exist from TASK-46; this task supplies their data. Do not extend `components/ui/` (v1 shadcn) for new surfaces.
<!-- SECTION:NOTES:END -->
