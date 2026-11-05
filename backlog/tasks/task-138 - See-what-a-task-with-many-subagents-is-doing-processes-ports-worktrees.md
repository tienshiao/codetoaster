---
id: TASK-138
title: 'See what a task with many subagents is doing: processes, ports, worktrees'
status: Done
assignee: []
created_date: '2026-11-05T06:59:00Z'
updated_date: '2026-11-05T09:02:00Z'
labels:
  - frontend
  - backend
dependencies: []
ordinal: 140000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A task whose agent fans out into several subagents is hard to follow from CodeToaster: the terminal shows one interleaved stream, nothing shows which processes are running or which ports they hold, and subagents working in their own git worktrees leave files and diffs that CodeToaster has no way to open, since the Explorer only looks at the task's own checkout. This parent groups the views that make that work visible; the subtasks can ship independently.
<!-- SECTION:DESCRIPTION:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Both halves shipped: TASK-138.1 added a Processes section showing the process tree under a task's terminals and their listening ports, and TASK-138.2 added a worktree picker that points the Explorer, and the file and diff tabs opened from it, at any worktree of the task's repository.
<!-- SECTION:FINAL_SUMMARY:END -->
