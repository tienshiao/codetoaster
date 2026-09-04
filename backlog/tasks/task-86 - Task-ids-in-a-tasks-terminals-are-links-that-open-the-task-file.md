---
id: TASK-86
title: Task ids in a task's terminals are links that open the task file
status: To Do
assignee: []
created_date: '2026-09-04 21:37'
labels:
  - frontend
  - terminal
  - backlog
dependencies:
  - TASK-84
references:
  - src/frontend/Terminal.tsx
  - src/frontend/components/tabs/panes/AgentPane.tsx
  - src/frontend/layout-store.ts
ordinal: 86000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
An agent working a Backlog.md repository names tasks constantly — 'filed TASK-82', 'closing TASK-78' — and the user reads those in the Agent tab with no way to get from the id to the file. When the task's repository is a Backlog.md project (the route from TASK-84), every occurrence of an id in the task's terminals becomes a link: hovering underlines it the way xterm's web links are underlined, and activating it opens the task's .md in a file tab exactly as a card in the Explorer's Backlog section does — the same { kind: 'file', path } tab through the layout store, markdown preview and focus-if-open included. The prefix comes from the route (the uppercased task_prefix as ids are written in files, TASK here), not from a hard-coded name, and the id is matched as a whole word so TASK-8 does not light up inside TASK-82. An id the list does not know — a task not yet filed, or one in backlog/archive — is not a link. Implemented as an xterm ILinkProvider registered on the terminal beside the web links addon, in a module of its own so the matcher is testable without a DOM; activation follows the same modifier convention the web links addon uses in this app (check what Terminal.tsx configures before choosing click or modifier-click, and match it). Applies to the agent's terminal and to shell tabs alike: both are the task's terminals and the shell runs the same CLI.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 In a Backlog.md repository, a whole-word task id in the agent's terminal or a shell tab is underlined on hover and opens the task's .md in a file tab in markdown preview when activated, focusing the tab if it is already open
- [ ] #2 The prefix is the one the route reports, TASK-8 is not matched inside TASK-82, and an id the list does not know is not a link
- [ ] #3 Outside a Backlog.md repository nothing is matched and no provider is registered
- [ ] #4 The matcher has unit tests; the link provider's registration and activation have a test at the level the existing Terminal tests allow
<!-- AC:END -->
