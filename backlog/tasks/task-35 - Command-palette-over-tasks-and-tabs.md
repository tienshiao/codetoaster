---
id: TASK-35
title: Command palette over tasks and tabs
status: To Do
assignee: []
created_date: '2026-08-29 00:03'
updated_date: '2026-08-30 09:20'
labels:
  - frontend
milestone: m-5
dependencies:
  - TASK-25
  - TASK-22
documentation:
  - docs/v2-architecture.md
ordinal: 35000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Rewrite CommandPalette.tsx to be task-oriented (§8): jump to a task (with state dots), open/focus a tab in the current task, new task, new shell, close/resume/archive current task, split, toggle sidebars.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Palette lists tasks with agent-state indicators and navigates on select
- [ ] #2 Palette lists open tabs and the Explorer's openable items for the current task
- [ ] #3 Task actions (new, close, resume, archive) and layout actions (split, toggle sidebars) are available
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Build against `frontend/components/v2/` — the v2 design system is the new UI, not a parallel track (CLAUDE.md, "The v2 design system is the new UI"). `AppShell` and the shell components already exist from TASK-46; this task supplies their data. Do not extend `components/ui/` (v1 shadcn) for new surfaces.

Nothing binds ⌘K any more. TASK-21's S4 deleted the v1 CommandPalette (it was typed off the session routes), and AppShell's FilterInput now passes shortcut={null} so the sidebar stops advertising a key hint with nothing behind it. Turn it back on here.
<!-- SECTION:NOTES:END -->
