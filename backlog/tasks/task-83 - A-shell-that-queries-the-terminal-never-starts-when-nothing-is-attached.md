---
id: TASK-83
title: A shell that queries the terminal never starts when nothing is attached
status: To Do
assignee: []
created_date: '2026-09-01 23:03'
labels:
  - bug
  - terminal
dependencies: []
ordinal: 83000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The server's headless terminal answers no terminal queries, so any program that waits for one before drawing blocks forever when no client is attached.

Found while fixing the test suite (the tests now pin $SHELL; see test/shell.ts). Fish is the case that exposed it. Its startup writes, in order: the kitty-keyboard probe \x1b[?u, XTVERSION \x1b[>0q, an OSC 11 background-colour request, two XTGETTCAPs, and a Primary DA \x1b[0c — then waits. src/lib/xtmux/pty.ts feeds PTY output into the headless @xterm/headless terminal and broadcasts it to clients, but nothing wires that terminal's replies back to the PTY, so with no client attached fish never reaches a prompt and never runs a line. Verified directly: bash and zsh paint immediately, fish emits zero bytes and sits in Ss+ (running, not stopped) indefinitely.

TaskManager.openShell spawns process.env.SHELL || /bin/sh, so a fish user's shell tabs run fish. The open question is whether a real attached browser client rescues it — xterm.js does answer DA/DSR, and its onData should route back through the input path — which would make this only affect a PTY spawned before anyone attaches (an agent started headless, a task restored on boot). That has not been verified either way; it is the first thing to check.

Not urgent, and not what broke the tests — the tests are fixed independently. This is the product question the investigation turned up.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 It is established whether an attached browser client's replies reach the PTY, and the answer is written down
- [ ] #2 A shell or agent spawned with no client attached is not left blocked on an unanswered terminal query
- [ ] #3 A fish user's shell tab reaches a prompt
<!-- AC:END -->
