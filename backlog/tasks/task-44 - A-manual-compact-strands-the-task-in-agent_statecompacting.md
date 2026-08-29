---
id: TASK-44
title: A manual /compact strands the task in agent_state=compacting
status: To Do
assignee: []
created_date: '2026-08-29 09:05'
labels:
  - server
  - agent
  - bug
dependencies: []
ordinal: 44000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by code review during TASK-14 (not introduced by it).

src/lib/agent/hook-state.ts:63 — the compact SessionStart declines to set a state so 'whatever state the turn was in survives'. But PreCompact has already replaced that state with 'compacting', so 'compacting' is what survives. After an auto-compact mid-turn the following Stop or UserPromptSubmit clears it; after a manual /compact typed at the prompt, nothing does, and the task shows as compacting for the rest of the session.

Telling the two apart needs PreCompact's trigger field ('manual' | 'auto'), which HookPayload does not currently model.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 HookPayload models PreCompact's trigger field
- [ ] #2 A manual /compact returns the task to idle rather than leaving it compacting
- [ ] #3 Auto-compact mid-turn still preserves the turn's state
<!-- AC:END -->
