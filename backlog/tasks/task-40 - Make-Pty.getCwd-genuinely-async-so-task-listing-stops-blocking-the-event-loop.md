---
id: TASK-40
title: Make Pty.getCwd genuinely async so task listing stops blocking the event loop
status: Done
assignee: []
created_date: '2026-08-29 04:34'
updated_date: '2026-08-29 07:52'
labels:
  - server
  - performance
milestone: m-5
dependencies: []
documentation:
  - docs/v2-architecture.md
priority: high
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
- [x] #1 Pty.getCwd performs no synchronous spawn: getForegroundPid and cwdForPid await Bun.spawn (or fs) rather than calling Bun.spawnSync
- [x] #2 On linux the cwd is read through fs.promises.readlink on /proc/<pid>/cwd, spawning no process at all
- [x] #3 GET /api/tasks with N live tasks resolves its cwd lookups concurrently — wall time stays close to one lookup rather than growing with N
- [x] #4 Behaviour is unchanged: the foreground process group's cwd still wins over the session shell's, and the shell's cwd is still the fallback when there is no distinct foreground process
- [x] #5 An exited PTY, a dead pid, and a lookup that fails still yield undefined rather than throwing or hanging a request
- [x] #6 Tests cover the foreground-pid preference, the shell fallback, and the undefined paths
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Raised to high after the TASK-11 review: the cost is no longer confined to listing. TaskManager.attachClient calls refreshCwd on every terminal attach, so a tab switch runs ps + lsof synchronously on the daemon's event loop, and lsof routinely costs 100-500ms on macOS. It blocks everything, not just the caller: every other task's PTY output, every in-flight HTTP request and the WebSocket pump all stall on it. v1 never paid this on attach.

getCwd is now genuinely async. A shared runCapture helper runs ps and lsof through Bun.spawn instead of Bun.spawnSync, and every failure — a non-zero exit, or a tool that is not installed, which makes Bun.spawn throw before there is a process — comes back as an empty string, so callers still read "could not tell" rather than getting a rejection they do not expect. Bun.$ would also work but is banned in this repo for deadlocking on large output.

On linux the cwd is read with fs.promises.readlink on /proc/<pid>/cwd, spawning nothing at all: it is a symlink, and reading it is a syscall, so forking readlink to do it was a fork and an exec per lookup for an answer the kernel hands over directly.

Measured on this machine: one lookup 82ms, eight concurrent 135ms, where serial would have been about 656ms. Promise.all in GET /api/tasks now buys the concurrency it was always written as if it had.

Picked up in the same pass, since it is the same "a PTY that went away" story: kill() cleared the activity debounce without sending the falling edge. Activity is edge-triggered on the wire — a client turns its dot on at active:true and off only at a later active:false — so killing a PTY inside the 300ms window (a resume-ladder rung that prints its error and is torn down) left a live activity dot on a task with no process for the rest of the daemon's life. Both kill() and the self-exit path now announce the drop.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Pty.getCwd no longer blocks the daemon's event loop: ps and lsof run through Bun.spawn, and linux reads /proc/<pid>/cwd with fs.promises.readlink and spawns nothing. Eight concurrent lookups now cost 135ms against 82ms for one, where before they serialised — which matters because TaskManager refreshes the cwd on every client attach, so each terminal tab switch stalled every other task's output and every in-flight request.
<!-- SECTION:FINAL_SUMMARY:END -->
