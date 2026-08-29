---
id: TASK-11
title: Hook ingestion → agent_state transitions
status: Done
assignee:
  - '@claude'
created_date: '2026-08-29 00:02'
updated_date: '2026-08-29 06:13'
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
- [x] #1 Each hook event in the table produces the documented row change and a broadcast
- [x] #2 /clear (SessionStart with source=clear and a new session_id) overwrites agent_session_id without creating a new task
- [x] #3 Resume (SessionStart with source=resume) leaves agent_session_id unchanged
- [x] #4 Payloads for unknown tasks or unknown events are ignored with a 2xx (never an error that surfaces in the agent)
- [x] #5 Tests use the captured payload shapes from §4.2
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add 'compacting' to AgentState (src/lib/db.ts). The §4.2 table maps PreCompact to it and the union does not have it; the column is TEXT, so no migration.
2. src/lib/agent/hook-state.ts: transitionFor(payload, task) -> TaskUpdate | undefined, pure, no db and no io, so the captured §4.2 payloads can be asserted directly. Mapping: SessionStart -> agent_session_id, transcript_path, agent_state idle, lifecycle live (the doc says 'state -> live', but live is a Lifecycle and not an AgentState, so it is two writes; a suspended task reporting SessionStart is how it becomes live again). UserPromptSubmit -> busy. Stop -> idle, last_message = last_assistant_message, idle_since = now. Notification -> needs_attention. PreCompact -> compacting. SessionEnd -> exited, but ONLY for reasons that mean the process is going away.
3. SessionEnd branches on reason. /clear fires SessionEnd on the old id and then SessionStart with a new one (verified, §4.4), so an unconditional exited flickers every /clear through 'dead' and strands the task there for good if the SessionStart is ever missed or reordered. reason clear and resume are ignored; other, logout and prompt_input_exit are real exits. The captured payload in §4.2 carries reason 'other'.
4. The reason itself is not persisted — there is no column, and the state transition is what anything downstream reads.
5. Every transition also stamps last_active_at: hooks are a truer activity signal than the PTY byte debounce the recency list sorts on today.
6. src/api/hooks.ts mounts POST /api/tasks/:id/hook and calls taskManager.applyHook(id, payload), which updates the row and broadcasts a task delta. Unknown task, unknown event, and an unparseable body all answer 2xx and change nothing — anything else surfaces in the agent's transcript, which is the one thing a hook must never do.
7. Tests: hook-state over the captured payload shapes (including /clear's SessionEnd+SessionStart pair keeping one task and overwriting the id, and resume leaving the id alone), plus route tests for unknown task, unknown event and malformed body.
8. Then /code-review --fix and /verify.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
lib/agent/hook-state.ts holds the §4.2 mapping as a pure transitionFor(payload, now) -> TaskUpdate | undefined, so the captured payload shapes can be asserted without a database. api/hooks.ts mounts POST /api/tasks/:id/hook and calls TaskManager.applyHook, which writes the row and broadcasts a single task delta.

Three things the task description could not have known, found by reading the types:
- §4.2 says SessionStart sets 'state -> live', but live is a Lifecycle and not an AgentState. It is two writes: lifecycle live (how a suspended task comes back) plus agent_state idle.
- PreCompact maps to 'compacting', which was missing from the AgentState union. Added; the column is TEXT, so no migration.
- SessionEnd is NOT the end of a task. /clear fires SessionEnd on the old conversation and then SessionStart with a new id (§4.4), so an unconditional exited flickers every /clear through 'dead' and strands the task there if the SessionStart is ever dropped or reordered. It now branches on reason: logout, prompt_input_exit and other are real exits; clear, resume, and any reason we do not recognise change nothing — a running task must not be killed off by a word a future version invented.

transitionFor treats every payload field as optional, so a renamed field in a future Claude Code degrades to 'no transition' rather than throwing inside the agent's synchronous hook path.

Code review found and fixed a real one: SessionStart set agent_state idle without restamping idle_since, so a task that stopped hours ago and was then /clear'd or resumed came back live and already past harvest_after — TASK-15 would have suspended a session the user had just cleared, the moment nobody was watching it.

Runtime verification (daemon on :4599), the first end-to-end run of the whole loop: a task created with a prompt ended with agent_state idle, lifecycle live, agent_session_id and transcript_path filled in from SessionStart, and last_message 'pong' captured from Stop's last_assistant_message. Driving a second prompt through the PTY over the WebSocket and polling the row showed idle -> busy -> idle. The §4.2 mapping matches the payloads Claude Code 2.1.251 actually sends.
bun test 337 pass / 0 fail; bunx tsc --noEmit clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The daemon now receives hook payloads and moves the task row by them: POST /api/tasks/:id/hook applies the §4.2 mapping and broadcasts one task delta, so busy/idle/needs_attention comes from the agent itself rather than from the 300ms PTY output debounce v1 inferred. The mapping lives in a pure function asserted against the captured payload shapes. SessionEnd branches on reason so a /clear cannot mark a live task dead; SessionStart restamps idle_since so a cleared or resumed session is not immediately harvestable; 'compacting' joined AgentState. Every path answers 2xx — unknown task, unmapped event, unparseable body — because a hook's only channel for complaint is the agent's own transcript. Verified live: idle -> busy -> idle across two real prompts, with the reply captured as the card preview.
<!-- SECTION:FINAL_SUMMARY:END -->
