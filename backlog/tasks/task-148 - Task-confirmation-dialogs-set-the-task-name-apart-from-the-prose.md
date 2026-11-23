---
id: TASK-148
title: Task confirmation dialogs set the task name apart from the prose
status: To Do
assignee: []
created_date: '2026-11-23T01:42:00Z'
labels:
  - frontend
dependencies: []
references:
  - src/frontend/components/TaskSidebar.tsx
  - src/frontend/components/UnarchiveTaskDialog.tsx
ordinal: 151000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The dialogs that confirm an action on a task (archive, suspend, delete for good, unarchive, all in TaskSidebar.tsx and UnarchiveTaskDialog.tsx, reached from the sidebar rows and the command palette) put the task name inside the description sentence as plain text, e.g. "<label> leaves the list, and ...". It has the same size, weight and colour as the words around it, so the user has to read the sentence to find which task is about to be acted on, and a wrong target, such as a row that moved under the pointer (TASK-146), is easy to confirm without noticing. The name is the one thing these dialogs need to make obvious at a glance.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every task-scoped confirmation (archive, suspend, delete for good, unarchive) shows the task name styled apart from the surrounding text so it reads at a glance, using v2 semantic tokens rather than colour literals
- [ ] #2 The name shown is the same display label the sidebar row shows for that task
- [ ] #3 A long name truncates or wraps without breaking the dialog layout, and the full name is still available (e.g. on hover)
- [ ] #4 The styling is shared by all four dialogs, so a new task-scoped confirmation gets it without restyling
- [ ] #5 Rendering tests check that each dialog renders the task name in its distinct element
<!-- AC:END -->
