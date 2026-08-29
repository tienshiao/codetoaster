---
id: TASK-37
title: README for v2
status: To Do
assignee: []
created_date: '2026-08-29 00:03'
labels:
  - docs
milestone: m-5
dependencies:
  - TASK-28
  - TASK-30
documentation:
  - docs/v2-architecture.md
ordinal: 37000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Rewrite the README for the cattle model: what a task is, the composer, resume/suspend semantics, worktrees, the codetoaster hook subcommand and why it must stay silent, harvest_after configuration, and the daemon-from-inside-an-agent caveat (§4.1).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 README describes tasks, suspend/resume, archive, and worktrees
- [ ] #2 README documents harvest_after and the hook subcommand
- [ ] #3 README warns about starting the daemon from inside a Claude Code session
- [ ] #4 docs/v2-architecture.md status line is updated from 'design draft' to reflect what shipped
<!-- AC:END -->
