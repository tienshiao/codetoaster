---
id: TASK-137
title: The composer status bar shows the selected project's current branch
status: To Do
assignee: []
created_date: '2026-11-05T06:59:00Z'
labels:
  - frontend
dependencies: []
ordinal: 139000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On the new task screen (the composer) the status bar is empty because no task is selected yet, yet the branch the chosen project is on is what a new task will start from or branch off. Showing it there lets you catch being on the wrong branch before you start the task.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 With a project chosen in the composer, the status bar shows that project's current branch
- [ ] #2 Changing the chosen project updates the branch shown
- [ ] #3 A detached HEAD shows the short SHA, and a project that is not a git repository shows no branch item
- [ ] #4 The branch stays current if it changes on disk while the composer is open
- [ ] #5 A rendering test covers the branch item, the project switch and the no-repo case
<!-- AC:END -->
