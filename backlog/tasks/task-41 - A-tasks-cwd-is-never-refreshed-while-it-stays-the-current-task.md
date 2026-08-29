---
id: TASK-41
title: A task's cwd is never refreshed while it stays the current task
status: To Do
assignee: []
created_date: '2026-08-29 06:14'
labels:
  - server
  - frontend
milestone: m-5
dependencies:
  - TASK-40
documentation:
  - docs/v2-architecture.md
priority: medium
ordinal: 41000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TaskManager.attachClient calls refreshCwd, and the comment there claims opening a task's terminal 'is the only such moment the browser reaches'. It is not: attachSession (frontend/SessionContext.tsx) early-returns when the id already matches currentSessionIdRef, so moving between the Terminal, Changes, Files, History and git tabs of the *current* task never re-attaches and never refreshes anything.

Concretely: the agent cd's from repo A into repo B — a worktree, a submodule, a sibling checkout — the user clicks Changes, and the diff, file tree, git log and symbol routes keep answering out of repo A for as long as that task stays selected. Only switching to a different task and back fixes it. A single-task user never hits the refresh at all.

This is the cost side of §5.4's trade: the routes read the row instead of asking a process on every request, which is right, but then something has to notice when the row goes stale. The fix needs a trigger that is not 'a git call per data request' — an explicit refresh route the tab hosts can call, or a socket message on tab activation — and it should land alongside TASK-40, since today's refreshCwd blocks the event loop on ps + lsof and making it fire more often would make that worse rather than better.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Switching between the tabs of the current task picks up a cwd the agent has moved to, without a full re-attach
- [ ] #2 The refresh does not add a git call or a process spawn to every data request — §5.4's trade stays intact
- [ ] #3 A task whose agent cd'd into a different repository answers diff, files, git and symbols out of the new repo_root
- [ ] #4 Tests cover a cwd change observed without switching tasks
<!-- AC:END -->
