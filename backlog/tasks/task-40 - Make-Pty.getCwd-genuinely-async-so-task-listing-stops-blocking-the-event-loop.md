---
id: TASK-40
title: Make Pty.getCwd genuinely async so task listing stops blocking the event loop
status: To Do
assignee: []
created_date: '2026-08-29 04:34'
labels:
  - server
  - performance
milestone: m-5
dependencies: []
documentation:
  - docs/v2-architecture.md
priority: medium
ordinal: 40000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`Pty.getCwd()` is async in signature only. Underneath it runs `Bun.spawnSync(["ps", "-o", "tpgid=", …])` and then, on darwin, `Bun.spawnSync(["lsof", …])` — both block the event loop for the whole of the child process's life (src/lib/xtmux/pty.ts, getForegroundPid and cwdForPid).

Callers already assume otherwise. `GET /api/tasks` fans `taskManager.refreshCwd` out under `Promise.all` (src/api/tasks.ts), which buys no concurrency at all: listing N live tasks serially blocks on 2N synchronous spawns, plus a `git rev-parse` and a row write for each task whose cwd actually moved. Every `codetoaster list` and every WebSocket attach pays it, and v2's premise is thirty cattle tasks rather than v1's handful, so the cost scales with exactly the thing the design is trying to make cheap.

Two straightforward wins: on linux, `/proc/<pid>/cwd` can be read with `fs.promises.readlink` and spawn nothing whatsoever; on darwin the `ps` and `lsof` calls become awaited `Bun.spawn`. Worth considering as part of the same change: one `ps` invocation covering every live PTY instead of one per PTY, since the foreground-pgid lookup is the half that runs for all of them.

The behaviour must not change — the foreground process group's cwd is preferred over the session shell's, because a program that chdir's into a worktree is what the user perceives as "where they are", and the shell's own cwd is the fallback.

Found while reviewing TASK-8; flagged rather than fixed there because it is nowhere near that diff.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Pty.getCwd performs no synchronous spawn: getForegroundPid and cwdForPid await Bun.spawn (or fs) rather than calling Bun.spawnSync
- [ ] #2 On linux the cwd is read through fs.promises.readlink on /proc/<pid>/cwd, spawning no process at all
- [ ] #3 GET /api/tasks with N live tasks resolves its cwd lookups concurrently — wall time stays close to one lookup rather than growing with N
- [ ] #4 Behaviour is unchanged: the foreground process group's cwd still wins over the session shell's, and the shell's cwd is still the fallback when there is no distinct foreground process
- [ ] #5 An exited PTY, a dead pid, and a lookup that fails still yield undefined rather than throwing or hanging a request
- [ ] #6 Tests cover the foreground-pid preference, the shell fallback, and the undefined paths
<!-- AC:END -->
