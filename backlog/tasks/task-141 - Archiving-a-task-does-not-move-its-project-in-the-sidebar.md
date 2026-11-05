---
id: TASK-141
title: Archiving a task does not move its project in the sidebar
status: To Do
assignee: []
created_date: '2026-11-05T07:32:00Z'
labels:
  - frontend
  - backend
dependencies: []
ordinal: 145000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A project group sits wherever its highest-ranked live task sits (groupByProject takes groups in order of first appearance in the rank_at-sorted list). Archiving that task drops the project to the rank of its next task, which may be weeks old, and the project ends up far down the list and hard to find again. Project order should keep following recency, which was chosen over manual or alphabetical order, but archiving should never be what moves a project.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Archiving any of a project's tasks leaves the project where it was in the sidebar
- [ ] #2 A project whose tasks are all archived keeps its place instead of falling to the trailing empty projects
- [ ] #3 A task in a project waking after the quiet threshold still moves its project to the top, as today
- [ ] #4 Order after a reload or a fresh tasks snapshot matches the order shown before it
- [ ] #5 Unit tests cover archiving the top task, archiving every task, and a wake after an archive
<!-- AC:END -->
