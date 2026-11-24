---
type: Runbook
title: Install a server binary and restart the daemon
description: Build the standalone binary, install it as a new file (the old one moved aside, then cp), and restart the daemon on it with its own flags, from anywhere including a CodeToaster terminal, with scripts/install-server.sh.
tags: [runbook, daemon, binary, deploy]
level: project
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-24T00:00:00Z }
sources:
  - id: script
    resource: ../../scripts/install-server.sh
    title: scripts/install-server.sh
  - id: task-156
    resource: "../../backlog/tasks/task-156 - Script-to-install-a-built-server-binary-and-restart-the-daemon.md"
    title: "TASK-156 — Script to install a built server binary and restart the daemon"
---

# When

A server or frontend change is merged and the daemon you use day to day runs
the built binary (`~/bin/codetoaster`), not `bun run dev`. A change is not live
there until the binary is rebuilt, installed and the daemon restarted.

# Steps

```sh
bun run install:server --build          # build, install, restart port 4000
scripts/install-server.sh --build       # the same
scripts/install-server.sh --no-restart  # install only
scripts/install-server.sh --port 4001 --dest ~/bin/codetoaster
```

The output of the stop and start goes to `~/.codetoaster/restart.log`.
Restarting suspends every live task; opening one resumes it.

# What it takes care of

- **Moved aside, then cp.** Copying over the old binary in place does not
  work on macOS (the copy is killed, most likely because the old file's code
  signature is cached against it). Renaming the old one out of the way first
  makes the copy a new file, as removing it would. Moving the binary of a
  running daemon is harmless: the process keeps the file it opened.
- **A binary that will not run is not installed over a working one.** It runs
  `help` on the build before touching anything, then on the installed copy;
  if the copy fails, the old binary is put back and the daemon is left alone.
  Leaving a broken binary at the destination would break the running daemon
  too, since its agents report through `<dest> hook`.
- **The daemon keeps its flags.** They are read off the running daemon's
  command line (everything after `foreground`), so `--host`, `--allowed-host`,
  `--db` and the sweep durations survive. A plain `codetoaster` would start on
  loopback with defaults and lose remote access.
- **The daemon keeps its directory.** The new one starts in the running one's
  working directory (read with `lsof`, `$HOME` if that is gone), not in the
  task worktree the script may have been run from: the daemon's directory is
  where a task with no project opens, and what a relative `--db` resolves
  against.
- **The start waits for the old daemon to exit.** `codetoaster stop` stops
  waiting after a second and falls back to SIGTERM, and a shutdown that is
  draining a harvest tick can outlast that. Started while the old process still
  holds the port, the new daemon would fail to bind and leave nothing running,
  so the start waits (up to 30 seconds) for the old pid to be gone.
- **It can be run from inside CodeToaster.** Stopping the daemon closes every
  terminal it owns. A `codetoaster stop; codetoaster` typed into a shell tab
  dies with that tab before the start runs, and an agent session there is
  killed the same way. The script runs the stop and start in a new session
  (`perl` `POSIX::setsid`; macOS has no `setsid` command) under `nohup` with no
  terminal, so it outlives the daemon. Run from a CodeToaster tab, that tab
  disconnects; reload the page once the daemon is back.
