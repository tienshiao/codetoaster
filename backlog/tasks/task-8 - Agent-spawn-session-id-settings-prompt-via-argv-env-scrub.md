---
id: TASK-8
title: 'Agent spawn: --session-id, --settings, prompt via argv, env scrub'
status: Done
assignee:
  - '@claude'
created_date: '2026-08-29 00:02'
updated_date: '2026-08-29 04:30'
labels:
  - server
  - agent
milestone: m-1
dependencies:
  - TASK-5
documentation:
  - docs/v2-architecture.md
modified_files:
  - src/lib/agent/spawn.ts
  - src/lib/agent/spawn.test.ts
  - src/lib/tasks/manager.ts
  - src/lib/tasks/manager.test.ts
  - src/api/tasks.test.ts
  - src/server.ts
priority: high
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
lib/agent/spawn.ts builds the `claude` argv from a task row (§4.1): `--session-id <uuid we allocate>`, `--settings <per-task settings.json>`, optional `--model` / `--permission-mode`, and the initial prompt as a positional argument (never written into the PTY after startup). Scrub inherited CLAUDECODE, CLAUDE_CODE_*, CLAUDE_PID, CLAUDE_EFFORT from the child env — a daemon started from inside an agent session otherwise spawns children with transcript saving off and nothing to resume. Add CODETOASTER_TASK_ID and CODETOASTER_PORT to the child env.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 argv is an array; prompts containing newlines and quotes reach the agent verbatim
- [x] #2 agent_session_id is allocated before spawn and stored on the task row
- [x] #3 Child env contains no CLAUDECODE / CLAUDE_CODE_* / CLAUDE_PID / CLAUDE_EFFORT keys even when the daemon's env does
- [x] #4 Child env carries CODETOASTER_TASK_ID and CODETOASTER_PORT
- [x] #5 Unit tests cover argv construction and env scrubbing
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. src/lib/agent/spawn.ts (pure, no I/O): buildAgentCommand(row, {settingsPath}) -> argv array [claude, --session-id <uuid>, --settings <path> when given, --model/--permission-mode when the row has them, positional prompt when initial_prompt is non-empty]; agentEnv(sourceEnv, {taskId, port}) -> overrides map with CLAUDECODE / CLAUDE_CODE_* (enumerated by prefix from sourceEnv) / CLAUDE_PID / CLAUDE_EFFORT mapped to undefined, plus CODETOASTER_TASK_ID and CODETOASTER_PORT. Bun.spawn drops undefined-valued env keys (verified), which is the removal contract PtyOptions.env already documents; taskSettingsPath(taskId) -> ~/.codetoaster/tasks/<id>/settings.json, whose file TASK-9 writes.
2. TaskManager.createTask allocates agent_session_id (crypto.randomUUID) before spawn and stores it on the row, then spawns the agent argv + env by default. An explicit options.command still wins (tests today, extra shell tabs in TASK-27). --settings is omitted while the file does not exist yet; TASK-9 turns it on.
3. TaskManager learns the daemon port from startServer so CODETOASTER_PORT is real.
4. Tests: spawn.test.ts covers argv construction (newlines/quotes verbatim, optional flags on and off) and env scrubbing, plus a real Bun.spawn assertion that a poisoned parent env reaches the child clean.
5. Then /code-review --fix and /verify.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added src/lib/agent/spawn.ts: buildAgentCommand (pure argv from the row) and taskEnv (overrides map; scrubbed keys map to undefined, which Bun.spawn drops — the removal contract PtyOptions.env already documented), plus taskDir/taskSettingsPath for TASK-9. TaskManager.createTask now allocates agent_session_id up front and spawns the agent by default; options.command still overrides. --settings stays out of the argv until TASK-9 writes a file, since claude refuses a missing settings path. startServer hands the manager its port so CODETOASTER_PORT is real.

Added a $CODETOASTER_AGENT_BIN fallback for the binary, beyond the original scope: a task now starts an agent, so the route tests were spawning real Claude Code sessions (transcripts and all). They point it at 'cat' for the run; it also covers a daemon whose PATH has no claude.

Code review (--fix) found and fixed: the prompt needed a `--` separator before it (the agent's parser is option-first, so a prompt opening with a dash exited the process with "unknown option" — verified against the real binary); two tests asserted a blanket CLAUDE* sweep rather than the scrub's actual key set, and one deleted the poisoned vars instead of restoring them; the 'cat' stand-in agent exited on `--session-id` rather than idling, so the route tests were racing a dead PTY (now a temp `exec cat` script that ignores argv); setPort took the requested port instead of the listener's, which would hand an agent CODETOASTER_PORT=0 under --port 0.

Flagged, not fixed, outside this diff: GET /api/tasks fans refreshCwd out under Promise.all, but Pty.getCwd is async in signature only — it runs two Bun.spawnSync calls — so listing N tasks blocks the event loop on 2N synchronous spawns.

Runtime verification (docs skill /verify), daemon on :4599 started from inside an agent session — i.e. the exact poisoned-env hazard §4.1 describes:
- argv with a dash-leading prompt: `claude --session-id <uuid> -- --- do not run anything…`; promptless task: `claude --session-id <uuid>` with no positional.
- `ps eww` on the spawned agent shows CODETOASTER_TASK_ID and CODETOASTER_PORT=4599 and *no* CLAUDE* key at all, though the daemon's own env had CLAUDECODE, CLAUDE_CODE_CHILD_SESSION, CLAUDE_PID, CLAUDE_EFFORT and five more.
- ~/.claude/projects/-Users-tma-Projects-codetoaster/<agent_session_id>.jsonl exists: transcript saving stayed on, so the task is resumable — which is the failure the scrub exists to prevent.
- The row's agent_session_id matches the id in argv; the terminal painted.
bun test 293 pass / 0 fail; bunx tsc --noEmit clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
lib/agent/spawn.ts builds the agent's argv and environment as pure functions of the task row: buildAgentCommand emits --session-id always, --settings/--model/--permission-mode only when there is something to name, and the initial prompt last as a positional behind `--`; taskEnv returns an overrides map that names CLAUDECODE, CLAUDE_CODE_*, CLAUDE_PID and CLAUDE_EFFORT for removal and adds CODETOASTER_TASK_ID and CODETOASTER_PORT. TaskManager.createTask allocates agent_session_id before the spawn and stores it on the row, then runs the agent by default — options.command still overrides, for tests and TASK-27's shell tabs — and applies taskEnv to every PTY a task owns. startServer hands the manager the listener's port. --settings is deliberately absent until TASK-9 writes a file, since claude refuses a missing settings path. A $CODETOASTER_AGENT_BIN fallback keeps the route tests from starting real Claude Code sessions. Verified by unit tests over argv and env, and at runtime against a daemon launched from inside an agent session: the child came out with no CLAUDE* keys and left a transcript under the id we allocated.
<!-- SECTION:FINAL_SUMMARY:END -->
