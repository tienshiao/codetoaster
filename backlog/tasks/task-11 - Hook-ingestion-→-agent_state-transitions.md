---
id: TASK-11
title: Hook ingestion → agent_state transitions
status: To Do
assignee: []
created_date: '2026-08-29 00:02'
labels:
  - server
  - agent
  - tasks
milestone: m-1
dependencies:
  - TASK-9
  - TASK-10
documentation:
  - docs/v2-architecture.md
priority: high
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Server endpoint that receives hook payloads and applies the §4.2 mapping: SessionStart → agent_session_id/transcript_path, state live (also handles /clear, which fires SessionEnd then SessionStart with a NEW session_id — overwrite the field); UserPromptSubmit → busy; Stop → idle, store last_assistant_message as last_message, stamp idle_since; Notification → needs_attention; SessionEnd → exited with reason; PreCompact → compacting. Each transition updates the row and broadcasts a `task` delta.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each hook event in the table produces the documented row change and a broadcast
- [ ] #2 /clear (SessionStart with source=clear and a new session_id) overwrites agent_session_id without creating a new task
- [ ] #3 Resume (SessionStart with source=resume) leaves agent_session_id unchanged
- [ ] #4 Payloads for unknown tasks or unknown events are ignored with a 2xx (never an error that surfaces in the agent)
- [ ] #5 Tests use the captured payload shapes from §4.2
<!-- AC:END -->
