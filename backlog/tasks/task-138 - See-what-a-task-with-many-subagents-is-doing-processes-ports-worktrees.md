---
id: TASK-138
title: 'See what a task with many subagents is doing: processes, ports, worktrees'
status: To Do
assignee: []
created_date: '2026-11-05T06:59:00Z'
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
