---
type: Gotcha
title: Bun 1.3.9 leaks a directory descriptor per closed fs.watch
description: On Bun 1.3.9 every fs.watch, recursive or not, keeps its directory descriptor open after close(); 1.4.x does not, and a compiled daemon keeps the Bun it was built with until it is rebuilt.
tags: [gotcha, bun, fs-watch, descriptors, daemon]
level: project
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-29T10:30:00Z }
sources:
  - id: task-134
    resource: "../../backlog/tasks/task-134 - Daemon-memory-and-descriptor-diagnostics.md"
    title: "TASK-134 — Daemon memory and descriptor diagnostics"
  - id: task-135
    resource: "../../backlog/tasks/task-135 - Share-fs.watch-streams-between-tasks-watching-the-same-directories.md"
    title: "TASK-135 — Share fs.watch streams between tasks watching the same directories"
  - id: watch-pool
    resource: ../../src/lib/tasks/watch-pool.ts
    title: src/lib/tasks/watch-pool.ts
---

# Symptom

A long-running daemon holds dozens of read-only directory descriptors (`lsof` type `DIR`, mode `r`) on repositories that no live task is in. One daemon with 12 live tasks held 92, ten of them on a repository with two live tasks.[^task-134]

# Cause

Bun 1.3.9's `fs.watch` does not release its directory descriptor on `close()`. Fifty open/close cycles on one directory leave fifty descriptors behind on 1.3.9, recursive or not; the same script on 1.4.4 leaves none, and 1.4.4 holds no descriptor even while the watch is open.[^task-134] The task watcher's streams are closed whenever a task stops being live and, since no browser connected means nothing to tell, every time the last browser disconnects, so each reconnect left a full set behind.[^task-135]

The trap is the runtime version. `~/bin/codetoaster` is a `bun build --compile` binary and carries the Bun it was built with: a binary built before the repo moved to Bun 1.4 keeps running 1.3.9 however up to date `node_modules` is. `codetoaster status` prints the daemon's Bun version for this reason.[^task-134]

# Mitigation

Rebuild the binary (`bun run build:server`) on a current Bun and restart the daemon. Independently of the leak, the streams are now shared between tasks through a [WatchPool](/modules/change-watcher.md), so a repository has one set of streams however many tasks are in it, and the open/close churn is per directory rather than per task.[^watch-pool]

[^task-134]: TASK-134 — Daemon memory and descriptor diagnostics
[^task-135]: TASK-135 — Share fs.watch streams between tasks watching the same directories
[^watch-pool]: src/lib/tasks/watch-pool.ts
