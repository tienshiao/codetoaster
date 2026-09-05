---
id: TASK-89.4
title: 'Profiles without hooks or resume: degraded state and restart on reopen'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-05 21:09'
updated_date: '2026-09-05 22:28'
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
- [x] #1 A task on a hookless profile shows busy/idle from the heuristic with no passage through unknown, and its DTO marks the state as inferred
- [x] #2 Reopening a suspended task on a profile without resume restarts its command in the task's cwd and the card explains why the conversation was not resumed
- [x] #3 A profile without a continue template skips that rung and the ladder is otherwise unchanged for claude, asserted in resume.test.ts
- [x] #4 A task on the shell profile spawns the user's shell and nothing else, and the verify skill names it as the safe way to drive the UI
- [x] #5 tsc and bun run test clean
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. AgentMode gains 'restart': the start template rendered without the prompt, for a profile that can neither resume nor continue. resumeLadder returns [{mode:'restart'}] for such a profile; a profile no longer in the registry (profiles.get, not require) yields an empty ladder and could_not_resume rather than a throw out of resume.
2. Hookless profiles never arm the hook grace timer, on create and in spawnAgent, so the state goes starting → busy/idle on the first output and never through unknown. TaskInfo.hooks (the profile takes our settings file) and TaskInfo.restarted (this process is a restart, not a resume; in-memory, cleared on suspend/close/create) are added and filled in taskInfo.
3. Frontend: the agent pane shows a dismissible strip above a restarted task's terminal saying the conversation was not brought back and that the profile cannot resume; the sidebar dot's title says the state is inferred from output when hooks is false.
4. The verify skill documents profile: 'shell' on POST /api/tasks as the way to exercise the UI without a real agent.
5. Tests: hookless create never reaches unknown and reaches busy/idle from output; resume on a no-resume profile spawns the start template without the prompt and marks restarted; a claude replacement without continue skips that rung (resume.test.ts); the render test for the strip. tsc and bun run test clean.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Landed. AgentMode 'restart' renders the start template with no prompt, keeping the session id where the template names one; resumeLadder uses profiles.get, returning an empty ladder (→ could_not_resume, no throw) for a profile no longer in the registry and [restart] for a profile with neither resume nor continue. Hook grace is armed only when the profile has hooks, on create and in spawnAgent. TaskInfo.hooks and TaskInfo.restarted (an in-memory set, cleared on create, suspend, delete, discard and at the top of the ladder). AgentPane shows a dismissible Notice above a restarted task's live terminal; the sidebar dot's tooltip adds 'inferred from output' when hooks is false, on live rows only. Verify skill documents profile: shell. Deviation: awaitAgentStart still settles on the cap for hookless profiles — first output is not evidence the rung is healthy (a doomed rung prints one error line), and the activity callback slot is already taken by adopt; documented in its comment. Pre-existing observation, untouched: deleteTask right after close can race the snapshot write and leave a task dir holding only scrollback.ans. Validation: tsc clean; unit 1331 pass / 0 fail (+11); render 283 pass (+4); runtime check of a shell task's create/close/reopen/close cycle over the verify recipe.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Profiles degrade honestly: a hookless profile never arms the hook grace so its state goes starting → busy/idle from output and the sidebar says it is inferred; a profile that cannot resume or continue is restarted from its start template without the prompt and the agent pane says the conversation was not brought back; a profile removed from the registry yields could_not_resume rather than a 500. The verify skill names the shell profile as the safe way to drive the UI. Verified with manager, ladder and render tests, tsc, the full suite and a runtime cycle.
<!-- SECTION:FINAL_SUMMARY:END -->
