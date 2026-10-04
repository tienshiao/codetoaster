---
type: Convention
title: Two test runners, split by filename
description: Non-rendering tests run under bun test as *.test.ts, rendering tests run under Vitest with happy-dom as *.render.tsx, and no test ever spawns the real agent.
tags: [testing, bun, vitest, happy-dom]
level: project
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-04T01:07:00Z }
sources:
  - id: claude-md
    resource: ../../CLAUDE.md
    title: CodeToaster CLAUDE.md
    author: human:tienshiao
  - id: preload
    resource: ../../test/preload.ts
    title: test/preload.ts
  - id: agent-bin
    resource: ../../src/lib/agent/agent-bin.test.ts
    title: agent-bin.test.ts
---

# The split

| File | Runner | Command |
| --- | --- | --- |
| `*.test.ts`, anything that does not mount a component | `bun test` | `bun run test:unit` |
| `*.render.tsx`, anything calling `render()` / `renderHook()` | Vitest, `environment: happy-dom` | `bun run test:render` |

`bun run test` runs both and is what CI and a pre-commit check use.[^claude-md]

The rule is the filename so that nothing has to be configured to keep the runners apart. `*.render.tsx` has no `.test` in it, and Bun only discovers files with `.test` or `.spec` in the name, so the render tests are invisible to `bun test` without an ignore flag. Do not rename them to `.test.tsx`: the ignore options that would make that work are silently dropped under `bun run`. See [bunfig test options under bun run](/gotchas/bunfig-test-options-under-bun-run.md).[^claude-md]

Why a second runner exists at all is a [decision of its own](/decisions/vitest-for-rendering-tests.md).

# What goes where

- A **lifecycle** behaviour (when a subscription binds, when a ref is written, what survives a remount) gets a rendering test.
- **Pure logic** belongs in a `.test.ts` against the function that holds it. That is why `drag.ts` and `layout-store.ts` live apart from the components using them, and why [terminal link](/modules/terminal-links.md) matchers are DOM-free modules.[^claude-md]
- Happy DOM has no layout engine. Anything that depends on real geometry stubs it (`TabArea.render.tsx` is the example) and is better checked in a browser; see [Verify on an isolated server](/runbooks/verify-on-isolated-server.md).

# No test spawns the real agent

`buildAgentCommand` falls back to `claude`, so a test that creates a task without standing something in would start a real Claude Code session: a transcript on disk and tokens spent, per test, and an outright failure on a machine without `claude`.[^claude-md]

`test/preload.ts`, wired through `bunfig.toml`'s `[test] preload` and from `test/setup-rendering.ts` for Vitest, points `CODETOASTER_AGENT_BIN` at `test/fake-agent.sh` **before every test**.[^preload] Before every test rather than once, because files move the variable around: one deletes it in an `afterEach`, another sets it and never restores it, and either leaves the next file with something other than the default.

A file that needs a different agent sets the variable from its own `beforeEach` or test body, which run after the global hook. A `beforeAll` no longer works. `spawn.test.ts` is the worked example: it asserts the bare `claude` fallback, so it clears the variable per test.[^claude-md]

`agent-bin.test.ts` guards the guard: if the preload stops applying, it fails with `Received: "claude"` instead of the suite quietly spawning agents.[^agent-bin]

# Test first, where it makes sense

- **Logic and server code** (`lib/`, the helpers in `api/`, `frontend/utils/`, the stores): failing test first, then the change, then refactor. A change that adds behaviour without a test that would have failed before it needs a stated reason.[^claude-md]
- **API routes**: every new or changed route has route-level tests through a real `Bun.serve` on port 0, as `tasks.test.ts` does, covering the happy path, validation failure (400), not found (404) and conflict (409). Unit tests of what the route calls do not exercise parsing, status codes or error bodies. The daemon has no authentication to cover; its one guard is the origin check that `guardApiRoutes` applies to the whole route table, covered by `origin.test.ts`.[^claude-md]
- **Frontend**: optional. Behaviour that matters gets a test, preferably against logic pulled out of the component; markup and styling are checked in a browser.[^claude-md]
- **Determinism**: inject the clock as a `now: () => number` dependency, wait on a condition with `waitFor` from `test/wait.ts` rather than sleeping, and build git fixtures with `test/git-repo.ts`.[^claude-md]

# Before committing a code change

`/code-review --fix`, then `/verify`. Commit only when `bun run test` and `bunx tsc --noEmit` are clean, the change has been driven on an [isolated server](/runbooks/verify-on-isolated-server.md), and its test, Backlog task and wiki pages are in place. Docs-, wiki- and backlog-only commits skip this.[^claude-md]

[^claude-md]: CodeToaster CLAUDE.md
[^preload]: test/preload.ts
[^agent-bin]: agent-bin.test.ts
