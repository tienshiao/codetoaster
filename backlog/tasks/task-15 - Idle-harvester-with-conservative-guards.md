---
id: TASK-15
title: Idle harvester with conservative guards
status: To Do
assignee: []
created_date: '2026-08-29 00:02'
labels:
  - server
  - tasks
milestone: m-2
dependencies:
  - TASK-14
  - TASK-11
documentation:
  - docs/v2-architecture.md
priority: high
ordinal: 15000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
lib/tasks/harvester.ts (§5.5): a single ~30 s interval over live tasks. Harvest only when ALL hold: lifecycle=live, agent_state=idle (never busy or needs_attention), zero attached views across all clients, now - idle_since > harvest_after (default 30 min, configurable, 0 = never), and no shell PTY has a foreground process other than the shell (getForegroundPid). Harvesting: snapshot, kill every PTY of the task, lifecycle=suspended, broadcast. Risk 3: when in doubt, do not harvest.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A task is harvested only when every guard in §5.5 holds; each guard has a test that blocks harvest on its own
- [ ] #2 harvest_after is configurable and 0 disables the idle harvester
- [ ] #3 Harvest snapshots, kills all of the task's PTYs (agent and shells), sets lifecycle=suspended, and broadcasts a task delta
- [ ] #4 The interval never throws out of its tick; one failing task does not stop others being evaluated
<!-- AC:END -->
