---
id: TASK-27
title: Extra shell tabs inside a task
status: To Do
assignee: []
created_date: '2026-08-29 00:03'
labels:
  - frontend
  - server
  - tasks
milestone: m-3
dependencies:
  - TASK-22
  - TASK-4
documentation:
  - docs/v2-architecture.md
ordinal: 27000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Open a plain shell PTY as a sibling tab in a task (§3, §5.5). Shell PTYs spawn at the task cwd, are owned by the task (killed on harvest), and are not resumable. On reopening a suspended task decide the policy in the UI, not silently: respawn shell tabs empty at the task cwd or drop them from the layout.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A 'new shell' action spawns a shell PTY at the task cwd and opens it as a closable tab
- [ ] #2 Harvesting or closing the task kills its shell PTYs
- [ ] #3 The harvester's foreground-process guard considers every shell PTY of the task
- [ ] #4 Reopening a suspended task applies a visible, documented policy for stale shell tabs (respawn empty or drop)
<!-- AC:END -->
