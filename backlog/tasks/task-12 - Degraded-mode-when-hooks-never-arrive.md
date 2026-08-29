---
id: TASK-12
title: Degraded mode when hooks never arrive
status: Done
assignee:
  - '@claude'
created_date: '2026-08-29 00:02'
updated_date: '2026-08-29 06:32'
labels:
  - server
  - tasks
milestone: m-1
dependencies:
  - TASK-11
documentation:
  - docs/v2-architecture.md
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Risk 4 (§9): a user running --bare, with hooks disabled, or a future Claude Code with changed payloads leaves tasks with no hook signal. Tasks must still work: fall back to the v1 output-activity heuristic (Pty's 300 ms debounce) for busy/idle when no hook has been seen for the task, and mark agent_state as `unknown` rather than leaving it stuck at `starting`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A task whose agent never sends SessionStart moves to agent_state=unknown after a bounded time
- [x] #2 Busy/idle for hook-less tasks is inferred from PTY output activity
- [x] #3 Once any hook arrives for a task, hook state takes precedence over the heuristic
- [x] #4 Tests cover the no-hook path
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. 'Has this task reported a hook?' is an in-memory Set on TaskManager, not a column and not a derived value. The argument: the thing it guards is a running PTY's output activity, which is per-process by definition — a task with no live PTY has no heuristic to fall back to, so a flag that does not survive a restart is not missing anything. A resumed task re-arms it, which is correct, because after a restart we genuinely do not know yet.
2. On spawn, arm a grace timer (10s, overridable for tests via setHookGrace). If it fires with no hook seen AND the row is still 'starting', the task moves to agent_state unknown. Guarded on 'starting' deliberately: if the output heuristic has already said busy or idle, that is a better answer than unknown, and overwriting it would be a downgrade.
3. onActivityChange drives busy/idle for hook-less tasks only, and broadcasts the row delta as well as the existing activity message. Once any hook has arrived the callback goes back to what it does today — recency only — so hook state always wins (#3).
4. applyHook records the flag and cancels the timer.
5. Timers and flags are cleared in closeTask, so a closed task leaves nothing behind to fire against a row that is gone.
6. Tests: a task with no hooks lands on unknown inside the grace window; PTY output moves a hook-less task to busy and back to idle; a task that reports a hook first is NOT moved by later output; the timer does not fire after close.
7. Then /code-review --fix and /verify.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
'Has this task ever reported a hook?' is an in-memory Set on TaskManager, not a column. What it guards is a running PTY's output activity, which is per-process by definition: a task with no live PTY has no heuristic to fall back to, so a flag that does not survive a restart is not missing anything, and a resumed task genuinely IS unknown again until its agent reports in. No migration.

A grace timer (10s, setHookGrace for tests) is armed on spawn and cancelled by the first hook of any kind — an unmapped payload proves the hooks are wired up just as well as a mapped one. If it fires with no hook seen and the row still says 'starting', the task becomes unknown.

Two deliberate narrowings:
- The timer only fires FROM 'starting'. If output activity has already said busy or idle, that is a better answer than unknown and replacing it would be a downgrade. This is a slight liberty with AC #1's literal wording, taken so a --bare agent that is visibly working is not relabelled 'unknown'.
- inferState only speaks about starting/unknown/busy/idle. A task that has exited, or that is sitting on needs_attention waiting for a permission prompt, is not idle just because its terminal went quiet.

Code review found a real one in TASK-11's code: isHookPayload only checked 'is an object', so a payload whose session_id arrived as a number or an object reached TaskStore.update as a bind value, bun:sqlite refused it, and the throw turned the route's documented 2xx into a 500 — in exactly the future-payload-change scenario this task exists for. Every string field is now type-checked at runtime, and applyHook is wrapped so the 'everything answers 2xx' contract holds for payloads that surprise us.

Runtime verification, two daemons each with a stand-in agent that reports no hooks at all (the --bare case):
- an agent that paints and then goes quiet: starting -> busy -> idle, entirely from PTY output.
- an agent that never writes a byte: starting -> unknown, at the grace boundary.
bun test 343 pass / 0 fail; bunx tsc --noEmit clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A task whose agent never reports a hook stays useful. TaskManager arms a grace timer on spawn and marks the task unknown if nothing has reported by the time it fires, and falls back to v1's PTY output heuristic for busy/idle — but only for tasks that have never sent a hook, so the agent's own account always wins. Verified against two hookless stand-in agents: a noisy one walks starting -> busy -> idle from output alone, a silent one lands on unknown instead of sitting on 'starting' for good.
<!-- SECTION:FINAL_SUMMARY:END -->
