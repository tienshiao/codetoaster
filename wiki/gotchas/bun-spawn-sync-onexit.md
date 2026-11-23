---
type: Gotcha
title: Bun.spawn can run onExit before it returns
description: When the child is already gone by the time Bun.spawn finishes, Bun runs the spawn's onExit synchronously inside the call, so a listener registered after the spawn returns never hears that exit unless Pty holds it.
tags: [gotcha, bun, spawn, pty]
level: project
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-23T14:24:04Z }
sources:
  - id: pty
    resource: ../../src/lib/xtmux/pty.ts
    title: src/lib/xtmux/pty.ts
  - id: pty-test
    resource: ../../src/lib/xtmux/pty.test.ts
    title: src/lib/xtmux/pty.test.ts
  - id: task-151
    resource: "../../backlog/tasks/task-151 - Flaky-test-manager.test.ts-exit-broadcast-times-out-in-full-runs.md"
    title: "TASK-151 — Flaky test: manager.test.ts exit-broadcast times out in full runs"
---

# Symptom

A task whose agent dies at once (a command that fails immediately, a `true`) sometimes never shows `exited`. It stays `starting` (or `unknown`, once a hook-capable profile's grace runs out), and nothing about it changes until the user acts. In the test suite this showed as `broadcasting > an exiting terminal marks the task exited and sends the row` timing out in about one run in a hundred, in isolation as well as in full runs.[^task-151]

# Cause

`Bun.spawn`'s `onExit` option is usually called later, from the event loop. When the child has already exited by the time the spawn finishes setting it up, Bun calls it **synchronously, inside `Bun.spawn`** (Bun 1.4.4, macOS, with `terminal:`). The stack of such a call reads `onExit ← spawn ← new Pty`. In a loop of `Pty`s running `true` it happened about three times in a thousand.[^task-151]

`Pty` spawns in its constructor and exposes `onExit(cb)` as a setter. A caller cannot register until the constructor returns, so an exit delivered inside it ran with no listener and was dropped. `pty.exited` was true, but the manager never wrote the row.[^pty]

# Rule

`Pty` keeps an exit that arrived with no listener (`exitUnheard`). The first `onExit(cb)` releases it, once, on a microtask rather than inline, to whichever listener is registered when the microtask runs, as a live exit goes to the current one. The caller then finishes wiring the PTY first, as it does for a process that exits just after the spawn returns, so the resume ladder and the `ptyToTask` guards in `TaskManager` see the same ordering in both cases.[^pty]

Anything else that spawns with a callback option and registers its listeners after the call returns has the same exposure. Either pass the handler into the spawn, or hold the event as `Pty` does.

`pty.test.ts` covers this deterministically: it waits for `pty.exited` before registering, which takes the same path with nobody listening.[^pty-test]

# Related

Another Bun behaviour worth knowing before spawning: [Bun.$ deadlocks on large git output](/gotchas/bun-shell-deadlock.md).

[^pty]: src/lib/xtmux/pty.ts
[^pty-test]: src/lib/xtmux/pty.test.ts
[^task-151]: TASK-151 — Flaky test: manager.test.ts exit-broadcast times out in full runs
