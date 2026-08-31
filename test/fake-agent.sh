#!/bin/sh
# The agent every test spawns unless it says otherwise.
#
# `buildAgentCommand` falls back to `claude`, so without something standing in,
# a test that creates a task starts a real Claude Code session: a transcript on
# disk and tokens spent, per test, on any machine that has it — and an outright
# `Bun.spawn` failure on any machine that does not. `test/preload.ts` points
# `CODETOASTER_AGENT_BIN` here for the whole run so no file has to remember.
#
# `exec cat` and not `exec cat "$@"`: it has to stay alive on the PTY until the
# test kills it, and a real agent's argv is full of flags that `cat` would
# reject — `cat: illegal option -- -` exits at once, which reads downstream as
# a task whose terminal died on its own.
#
# Deliberately silent. A test that needs to see the argv, or needs the agent to
# fail, writes its own stand-in and sets the variable itself; this is only the
# floor.
exec cat
