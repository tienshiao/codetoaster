---
id: TASK-145
title: Do not harvest a task while its agent has background work running
status: Done
assignee:
  - '@claude'
created_date: '2026-11-23T01:04:00Z'
updated_date: '2026-11-23T01:36:00Z'
labels:
  - agent
  - harvester
dependencies: []
ordinal: 149000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The idle harvester (src/lib/tasks/harvester.ts) suspends a task 30 minutes after its agent goes `idle` when nobody is watching. `idle` is set by Claude Code's `Stop` hook, which fires when the main turn ends, even if the agent launched background agents (e.g. a background `code-review` subagent) that are still running inside the same `claude` process. The foreground-process check cannot see them because subagents run in-process. Observed: the user came back to a task suspended mid-review; after resume Claude reported "Background agent \"code-review\" didn't finish before the previous session ended". The task should count as busy while background work is outstanding, which likely needs extra hooks in the per-task settings.json CodeToaster launches the agent with.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A task whose agent ended its turn while a background agent is still running is not harvested by the idle harvester
- [x] #2 Once the background work finishes, the task becomes harvestable again on the normal idle timeout counted from then
- [x] #3 A missed completion signal cannot pin a task live forever (bounded fallback)
- [x] #4 Tests cover the hook-driven state transitions and the harvester guard
- [x] #5 The task list shows a task whose turn ended with background work still running differently from a task that is completely done (dot and state label)
- [x] #6 Harvest hold is capped at 4 hours after the Stop that reported the background work
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. hook-state: a Stop whose background_tasks lists running/pending entries maps to a new agent_state background (idle_since and last_message stamped as for idle); absent/empty/malformed stays idle. Probe on 2.1.330 confirmed Stop carries background_tasks and that a finished background agent triggers UserPromptSubmit then a Stop with an empty list. 2. db AgentState gains background. 3. Harvester: background is harvestable only once idle_since is older than a backgroundAfterMs cap (default 4h, HarvesterOptions), else unchanged idle rule. 4. Manager refreshes worktree status on background as on idle. 5. Frontend: TaskState background, static busy-colored dot (no pulse), label background in row tooltip and hover card. 6. Tests: hook-state fixtures from the probe payloads, harvester guard and cap, route-level hook-then-tick test, StatusDot/taskStateOf. 7. Wiki pages on agent state and harvesting updated.

8. Review follow-up: a manual /compact while background keeps background (compactingFromBackground in the manager, cleared at the four per-process cleanup sites).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Probe on Claude Code 2.1.330 (Haiku, scratch settings with logging hooks): Stop after launching a background agent carried background_tasks=[{type:subagent,status:running}]; when it finished, UserPromptSubmit (agent-message) then Stop with background_tasks=[]. SubagentStop is not usable as a completion signal (it reports the finishing agent as running, and fires for unnamed internal agents), so only Stop is read. Not handled here: session_crons (a /loop or cron schedule still dies on harvest), /clear while background (does background work survive /clear? unverified), Suspend now not confirming for an attention task (pre-existing), and whether the idle_prompt Notification can strand a task in needs_attention away from the harvester (pre-existing, unverified).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A Stop hook whose background_tasks lists running or pending work (background subagents, shells, monitors, workflows) now maps to a new agent_state background instead of idle. The idle harvester leaves background tasks alone until idle_since is older than max(4h, harvest-after); when the work reports back, Claude Code runs a new turn whose Stop returns the task to idle, and the normal 30-minute window counts from then. A manual /compact keeps background. UI: background is its own TaskState, drawn as a steady busy-coloured dot with a background label, and Suspend now asks first for it. New wiki page modules/task-suspension.md. Code review (high, --fix) found 7 issues: 3 nits fixed by the review (wiki footnotes, backgroundAfterMs 0 doc, stale harvestTask comment); the /compact hole fixed here with a test; Notification-during-background judged harvest-safe (needs_attention is never harvested); session_crons and idle_prompt left as follow-ups. Verification on an isolated server (--harvest-after 1m, shell tasks, hooks posted to /api/tasks/:id/hook): a plain Stop task was harvested after about 80s while the background task stayed live for over 3 minutes; after UserPromptSubmit plus an empty Stop it went idle and was harvested about 88s later. In Chrome the background row showed a steady blue dot and State background in the hover card. bun run test (2198 unit, 600 render) and typecheck clean; two unrelated timing tests flaked once each under load and passed on rerun. Live only after the binary is rebuilt and the daemon restarted.
<!-- SECTION:FINAL_SUMMARY:END -->
