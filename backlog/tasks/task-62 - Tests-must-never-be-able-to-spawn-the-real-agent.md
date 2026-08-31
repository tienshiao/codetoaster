---
id: TASK-62
title: Tests must never be able to spawn the real agent
status: Done
assignee: []
created_date: '2026-08-31 04:24'
updated_date: '2026-08-31 04:37'
labels:
  - testing
milestone: m-5
dependencies: []
ordinal: 62000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-30 added a test file that spawned real Claude Code sessions — five of them per run, against throwaway git repos — because `buildAgentCommand` falls back to `claude` and the file set neither `command:` nor `CODETOASTER_AGENT_BIN`. On a machine without Claude Code the same file fails outright with `Executable not found in $PATH`.

The habit already existed: `api/tasks.test.ts`, `resume.test.ts` and `manager.test.ts` each stand in an agent of their own, and `api/tasks.test.ts` even carries a comment about this exact hazard. What does not exist is anything that makes a *new* file inherit it. Per-file discipline is the wrong mechanism for a default that costs real tokens and writes real transcripts when it lapses.

A `bun test` preload can set `CODETOASTER_AGENT_BIN` for every file at once — verified to apply under both `bun test <file>` and `bun run test:unit`. The remaining hazard is the preload itself lapsing silently, which CLAUDE.md already warns happens to some bunfig test options under `bun run`; a guard test is what turns that from silent into loud.

`spawn.test.ts` deliberately deletes the variable to assert the `claude` fallback, and must keep working — it builds argv and spawns nothing, so the guard cannot live in `buildAgentCommand`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 No test file has to remember to stand in an agent: a new one that spawns a task gets a harmless binary by default
- [x] #2 A test fails loudly if the default ever stops being applied, rather than the suite quietly spawning claude again
- [x] #3 Running the suite on a machine with no claude on PATH passes
- [x] #4 spawn.test.ts still asserts the claude fallback, since it builds argv rather than spawning
- [x] #5 The convention is written down in CLAUDE.md's Testing section
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
`test/fake-agent.sh` is the one stand-in; `test/agent-bin.ts` points `CODETOASTER_AGENT_BIN` at it; `test/preload.ts` (bunfig `[test] preload`) and `test/setup-rendering.ts` call that, so both runners are covered. `api/tasks.test.ts` and `worktree-create.test.ts` dropped the bespoke stand-ins they were each maintaining.

Two things only came out by trying it, and both are the reason a naive version of this would not have worked:

**Setting it once is not enough.** The first attempt was a preload that ran at process start. It failed: `worktree-create.test.ts` deletes the variable in its own `afterEach` — correct hygiene on its own terms — and that left every file running afterwards with nothing, including `manager.test.ts`. Now a `beforeEach` registered from the preload re-establishes it for every test.

**Filling only when empty is not enough either.** The second attempt used `??=`, so a file could still name its own agent. That failed too: `resume.test.ts` sets a stand-in and never restores it, so the value leaked forward and the guard test caught it. Assigning unconditionally makes 'every test starts from a harmless agent' true by construction. The cost is that a `beforeAll` can no longer set it — `spawn.test.ts` moved its `delete` to a `beforeEach`, which is also more honest about what it needs.

Also found in passing: `import.meta.dir` is Bun-only and undefined under Vite, so the first version of `agent-bin.ts` took all thirteen rendering files down at import time. Resolved through `fileURLToPath(import.meta.url)`, the idiom `vitest.config.ts` already uses.

Verified rather than assumed:
- `preload` applies under both `bun test <file>` and `bun run test:unit` (probed before building on it).
- Deleting `worktree-create.test.ts`'s own stand-in and running with `claude` off PATH: passes. Before this task the same shape failed four tests with `Executable not found in $PATH: "claude"`.
- The whole unit suite with `claude` absent: 787 pass, 0 fail.
- Commenting out the bunfig line: `agent-bin.test.ts` fails with `Received: "claude"`.

`bun run test`: 787 unit and 94 render, 0 fail. `bunx tsc --noEmit` clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A test can no longer spawn the real agent by forgetting. `test/preload.ts` points `CODETOASTER_AGENT_BIN` at a committed stand-in (`test/fake-agent.sh`) before every test, from both runners, so the protection is inherited rather than remembered; `agent-bin.test.ts` fails loudly with `Received: \"claude\"` if that ever stops applying, which matters because it rests on a bunfig option of the kind CLAUDE.md records as going quiet under `bun run`. Two per-file stand-ins were removed as redundant and `spawn.test.ts` moved its `delete` to a per-test hook so it still asserts the `claude` fallback. Verified by running the whole suite with `claude` off PATH (787 pass) and by disabling the preload to watch the guard fire. Convention written up in CLAUDE.md.
<!-- SECTION:FINAL_SUMMARY:END -->
