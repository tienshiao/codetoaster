---
id: TASK-140
title: Take Close off the task row; keep it in the palette as Suspend now
status: To Do
assignee: []
created_date: '2026-11-05T07:32:00Z'
labels:
  - frontend
dependencies: []
ordinal: 144000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The sidebar row's Close button suspends the task at once: it kills the agent and shells, keeps scrollback and worktree, and resumes on open. The harvester already does this by itself after 30 idle minutes with no viewer, so the button offers no workflow value, and its name makes it read like something final, which leaves users unsure what it does or why they would use it. It is still useful occasionally, to free memory now or stop a runaway agent, so it moves to the command palette under a name that says what it does.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Task rows in the sidebar no longer show a Close button
- [ ] #2 The command palette offers Suspend now for a live task, and its description says the task resumes when opened
- [ ] #3 Suspending a busy task from the palette still asks for confirmation first
- [ ] #4 Docs and the wiki that mention closing a task from the sidebar describe the palette action instead
- [ ] #5 Rendering tests cover the row without Close and the palette entry
<!-- AC:END -->
