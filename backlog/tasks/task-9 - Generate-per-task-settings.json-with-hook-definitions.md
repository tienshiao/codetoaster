---
id: TASK-9
title: Generate per-task settings.json with hook definitions
status: To Do
assignee: []
created_date: '2026-08-29 00:02'
labels:
  - server
  - agent
milestone: m-1
dependencies:
  - TASK-8
documentation:
  - docs/v2-architecture.md
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Write ~/.codetoaster/tasks/<task-id>/settings.json containing hook entries for SessionStart, UserPromptSubmit, Stop, Notification, SessionEnd, PreCompact — all pointing at the single command `codetoaster hook` (§4.2). The task id and port travel in the env, so the file is identical for every task apart from its path. Verified in Phase 0: --settings merges with the user's own hooks rather than shadowing them.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 settings.json is written before spawn and passed via --settings
- [ ] #2 Every hook event in the §4.2 table is registered with the `codetoaster hook` command
- [ ] #3 The directory ~/.codetoaster/tasks/<id>/ is created on demand
- [ ] #4 A test asserts the generated JSON shape
<!-- AC:END -->
