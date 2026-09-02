#!/bin/sh
# The shell every test spawns. See `test/shell.ts` for why it is pinned at all.
#
# A wrapper rather than `/bin/bash` directly, for two reasons:
#
#   --norc --noprofile  Pinning the binary is not the same as pinning what it
#     runs. Spawned on a PTY with no operands, bash is an *interactive*
#     shell and sources `~/.bashrc` — so the developer's machine is back in
#     the loop, in exactly the way this pin exists to prevent. Debian's and
#     Ubuntu's stock `~/.bashrc` puts an OSC 0 title in `PS1` whenever `TERM`
#     matches `xterm*`, and `pty.ts` forces `TERM=xterm-256color`, which races
#     the prompt's title against the one the title tests write. A `~/.bashrc`
#     ending in `exec fish` reproduces the original failure verbatim.
#
#   `bash` on PATH, not `/bin/bash`  There is no `/bin/bash` on NixOS or on a
#     stock Alpine image, and `TEST_SHELL` has to be an absolute path because
#     `TaskManager.openShell` spawns `$SHELL` as-is. An absolute wrapper that
#     resolves bash through PATH is both.
#
# `exec`, and not a plain call: the pid Bun spawned has to *be* the shell.
# Left as a child, it would be a foreground process of its own and every
# `hasForegroundProcess()` guard in `harvester.test.ts` would read true.
exec bash --norc --noprofile "$@"
