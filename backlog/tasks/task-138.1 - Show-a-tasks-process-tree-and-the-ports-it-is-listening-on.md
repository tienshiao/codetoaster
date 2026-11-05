---
id: TASK-138.1
title: Show a task's process tree and the ports it is listening on
status: Done
assignee:
  - '@claude'
created_date: '2026-11-05T07:00:00Z'
updated_date: '2026-11-05T08:31:00Z'
labels:
  - frontend
  - backend
dependencies: []
parent_task_id: TASK-138
ordinal: 141000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When a task's agent runs subagents, dev servers and test runners, there is no way to see from CodeToaster what is running under the task or which ports those processes hold, so finding a stray server or a port clash means leaving for a separate terminal.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A task view lists the process tree rooted at the task's PTY, with each process's pid, command and parent
- [x] #2 Each process holding a listening TCP port shows that port
- [x] #3 The view refreshes while open and drops processes that have exited
- [x] #4 A task with no live PTY (suspended or evicted) shows that state instead of an empty tree
- [x] #5 The route that serves it has route-level tests for the happy path and the unknown-task 404
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. src/lib/processes.ts: one ps -A for the table, walk down from each terminal pid (depth-first, children by pid), then lsof -a -nP -iTCP -sTCP:LISTEN -Fpn restricted to the tree's pids; pure parsers, injectable runner, bounded Bun.spawn; ps failing is an error (503), lsof failing is portsKnown false. 2. Pty.pid and TaskManager.processRoots (agent first, then shells; empty when nothing runs). 3. GET /api/tasks/:id/processes: 404 unknown, live false for a task with no running terminal; route tests. 4. Frontend: useTaskProcesses polling every 2s; a Processes section in the Explorer, rail item for task roots only; rows indented by depth with pid, short command (full in title) and ports as localhost links; notes for suspended and unreadable ports. 5. Rendering tests; browser check with a server started in a shell task.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Code review (high, with fix) raised 8 findings; 5 fixed: the capture timeout awaited the child's exit after the kill, so a helper stuck on a wedged mount still held the request (now raced, and the abandoned read is caught); Pty.runCapture was a copy of the same spawn and now delegates to captureCommand, which on a timeout gives Pty's lookups an empty answer instead of partial output (both read as could-not-tell); the no-live-terminal note said suspended for an open task whose agent exited (now: the task has no live terminal); the port chip copied Badge by hand (now a v2 Badge); a constant cn() call. Left: polls from several clients are not coalesced (each runs its own ps and lsof); shortCommand cuts a program path containing spaces at the first space, since ps keeps no argument boundaries; no route-level 503 test, as the route has no capture to inject. Two BacklogSection rail tests listed a task rail without Processes and were updated.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A Processes section in the Explorer, for task roots only, shows the process tree under each of the task's terminals with pids, commands and listening TCP ports as localhost links, polled every 2s while open. The new processes route reads one process table and one port listing limited to the tree's pids, through a bounded spawn now shared with the PTY lookups. Review: 5 of 8 findings fixed, see notes. Verified on an isolated server in Chrome: a server started in a shell task appeared with its port, dropped out on the next poll after it was stopped, and a closed task showed the no-live-terminal note. Typecheck clean; vitest 570 pass; bun test 2100 pass, with one PTY timing test timing out under the full run that passes alone and did so before this change.
<!-- SECTION:FINAL_SUMMARY:END -->
