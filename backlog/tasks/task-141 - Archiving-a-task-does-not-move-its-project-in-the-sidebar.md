---
id: TASK-141
title: Archiving a task does not move its project in the sidebar
status: Done
assignee:
  - '@claude'
created_date: '2026-11-05T07:32:00Z'
updated_date: '2026-11-05T10:06:00Z'
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
- [x] #1 Archiving any of a project's tasks leaves the project where it was in the sidebar
- [x] #2 A project whose tasks are all archived keeps its place instead of falling to the trailing empty projects
- [x] #3 A task in a project waking after the quiet threshold still moves its project to the top, as today
- [x] #4 Order after a reload or a fresh tasks snapshot matches the order shown before it
- [x] #5 Unit tests cover archiving the top task, archiving every task, and a wake after an archive
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. TaskStore.projectRanks: each project's highest rank_at over all its tasks, archived included, in one grouped query. 2. ProjectInfo.rankAt filled by getProjects, so it rides every tasks snapshot. 3. groupByProject orders groups by the newer of the project's rank and its visible tasks' rankAt (stable on ties); groups with no rank either way trail in the order given. The sidebar passes the project ranks. 4. Unit tests for the store query and the grouping cases: archiving the top task, every task archived, a wake after an archive, between-snapshot order equal to a fresh snapshot's.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Code review (high, with fix) raised 6 findings, all fixed: the sidebar ranked projects only from the rows the filter kept, so a hidden task waking did not move its project until the next snapshot (ranks now come from every live task); the rank query ran inside getProjects, which project-scoped requests call, and a GROUP BY cannot use the rank index (moved to the tasks snapshot only); two stale doc comments in task-list.ts; the wiki archive page and log; a null check that cannot fail.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Archiving a task no longer moves its project in the sidebar. Each tasks snapshot carries a per-project rank, the highest rank of any of its tasks with archived ones included, and the sidebar orders project groups by the newer of that and its live tasks' ranks, so a task waking still lifts its project at once while an archive leaves it in place, including a project whose tasks are all archived. Review: 6 of 6 findings fixed, see notes. Verified on an isolated server in Chrome with two projects: archiving the newest task of the top project left it on top above a project with a more recent live task, typing into the other project's task past the one-minute quiet window moved that project to the top, and a reload kept the same order. Typecheck clean; vitest 594 pass; bun test 2170 pass with the known broadcasting timeout under the full run.
<!-- SECTION:FINAL_SUMMARY:END -->
