---
id: TASK-89.4
title: 'Profiles without hooks or resume: degraded state and restart on reopen'
status: To Do
assignee: []
created_date: '2026-09-05 21:09'
labels:
  - backend
  - frontend
  - agent
dependencies:
  - TASK-89.2
parent_task_id: TASK-89
ordinal: 94000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Being honest about what degrades. A task whose profile has no hooks never gets a hook grace timer that ends in unknown; it goes straight to the output-activity heuristic for busy/idle, and the task DTO says so (a hooks: false or similar field) so the card can label the state as inferred. A task whose profile cannot resume has a resume ladder of exactly one rung: a fresh start of the same command in the task's cwd, keeping the row's session id where the profile uses one; the card and the agent pane say the conversation was not brought back and why (the profile does not support resume). A profile with resume but no continue simply skips that rung. The shell profile spawns no agent at all, and the verify skill documents it as the way to exercise the UI without a real Claude Code session.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A task on a hookless profile shows busy/idle from the heuristic with no passage through unknown, and its DTO marks the state as inferred
- [ ] #2 Reopening a suspended task on a profile without resume restarts its command in the task's cwd and the card explains why the conversation was not resumed
- [ ] #3 A profile without a continue template skips that rung and the ladder is otherwise unchanged for claude, asserted in resume.test.ts
- [ ] #4 A task on the shell profile spawns the user's shell and nothing else, and the verify skill names it as the safe way to drive the UI
- [ ] #5 tsc and bun run test clean
<!-- AC:END -->
