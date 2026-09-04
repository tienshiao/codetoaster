---
id: TASK-83
title: A shell that queries the terminal never starts when nothing is attached
status: Done
assignee:
  - '@claude'
created_date: '2026-09-01 23:03'
updated_date: '2026-09-04 20:34'
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
- [x] #1 It is established whether an attached browser client's replies reach the PTY, and the answer is written down
- [x] #2 A shell or agent spawned with no client attached is not left blocked on an unanswered terminal query
- [x] #3 A fish user's shell tab reaches a prompt
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Server: in Pty's constructor wire this.terminal.onData back into the PTY (Pty.write), so the authoritative terminal answers every query it can whether or not anyone is attached. 2. Client: add src/frontend/utils/terminal-queries.ts with silenceTerminalQueries(term), registering CSI/DCS handlers that swallow the queries the server now answers (DA1, DA2, DSR, DECDSR, DECRQM, XTWINOPS 18, DECRQSS) so one PTY gets one reply rather than one per attached client plus the server's; OSC 4/10/11/12 colour queries stay client-answered because only the browser knows the theme. Install it in Terminal.tsx. 3. Tests: pty.test.ts — a fish-shaped probe burst ending in Primary DA is answered with no client attached (script reads the reply and prints it, asserted via serialize()); terminal-queries.test.ts — each silenced query produces no data event with the helper installed and does without it. 4. Docs: note the reply rule in docs/v2-architecture.md §5.3; refresh the stale 'headless answers none' comments in test/shell.ts and test-shell.test.ts (the pin stays, for determinism). 5. Verify in the real app with SHELL=fish via the verify skill.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC #1 (2026-09-04): an attached client's replies DO reach the PTY. Path: server broadcasts the query bytes as a data message, the browser's xterm.js answers through term.onData, Terminal.tsx sends that as an input message (gated on attachedRef), client-messages.ts routes input to TaskManager.writeToPty -> PtyManager.write -> Pty.write. So a query emitted while a client is attached is answered — once per attached client, which is a duplicate-reply hazard with two browsers on one PTY. A query emitted with nobody attached is lost for good: the headless terminal consumes it, and a later attach restores from the serialized screen, in which queries do not appear. openShell spawns from the HTTP route and the tab attaches only after the route answers, so fish's startup queries (sent within ms of spawn) always land in the unattached window; the agent PTY has the same shape on boot/resume. Headless probe (@xterm/headless 6.0.0): answers DA1 (\x1b[?1;2c), DA2, DSR 5/6, DECRQM, DECRQSS; does not answer the kitty probe, XTVERSION, OSC 11 or XTGETTCAP. Fish only needs the DA reply — it uses DA as the terminator for its probe burst. Experiment: fish on a headless Terminal with onData wired back to the PTY reaches a prompt and runs a line in <2.5s; without the wire it emits 83 bytes and blocks.

Implementation (2026-09-04): Pty wires terminal.onData back into the PTY (pty.ts); the client silences its own answers to that set via silenceTerminalQueries in frontend/utils/terminal-queries.ts, installed in Terminal.tsx. XTWINOPS 18 turned out not to be answered by either side (every windowOptions flag is off by default), so it is pinned as unanswered rather than silenced. Decision: server answers everything it can, rather than 'server answers only when nobody is attached' — the latter would have kept one reply per attached client. Colour queries (OSC 4/10/11/12) stay client-answered; with two browsers on one PTY those still arrive twice, which predates this change and is the one duplicate left (a server-side answer would need the server to know the theme). Verification: bun run test:unit 1007 pass, bun run test:render 168 pass, tsc clean. Live: server on :4599 with SHELL=fish, shell tab opened over HTTP with no client for 7s, then a non-xterm driver attached — the restore already held fish's welcome and full starship prompt, and an input line ran (HELLO_<pid> echoed). In Chrome, a fish shell tab draws its prompt, and a bash probe inside it that sends Primary DA and DSR 6 and counts replies read exactly one of each (a=7 b=0; c=6 d=0).

Review (2026-09-04): two corrections to the server-side answer. (1) xterm's Secondary DA reply (CSI > 0;276;0 c) is itself a Secondary DA request under xterm's own params[0] > 0 guard, so a tty that reflects its input (stty -echoctl with echo on, a raw-mode cat, a nested pty) turned one query into an unbounded reply stream — reproduced at ~1000 writes per 1.5s. Pty now registers a CSI > c handler that swallows the reflected form (more than one parameter; a request carries at most one); pinned in pty-queries.test.ts. (2) The headless terminal is built with cursorBlink: true to match Terminal.tsx, since DECRQSS ' q' reports the constructor option and the server was answering 'steady block' where the client answered 'blinking'. Also: terminal-queries.ts types its parameter as @xterm/xterm's IParser (type-only import, same declaration in both packages) instead of a hand-written slice; pty-queries.test.ts spawns TEST_SHELL and uses the shared test/wait.ts waitFor. Known and left: with default termios (ECHO|ECHOCTL) a reply written before the program goes raw is echoed back as ^[[?1;2c text in the buffer (an attached client's reply always did this too); OSC colour queries remain per-viewer and unanswered when unattached, now stated in the module header.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
An attached client's replies do reach the PTY (input message -> writeToPty), but only for queries it saw; a query emitted with nobody attached was consumed by the headless terminal and lost, and a shell tab is spawned before its tab attaches, so fish's startup DA was never answered. Now Pty feeds the headless terminal's own answers (DA1/DA2, DSR, DECRQM, DECRQSS) back into the PTY regardless of attachment, and the client's xterm.js is silenced on that set so a PTY gets one reply rather than one per viewer plus the server's. Documented in v2-architecture §5.3; tests in pty-queries.test.ts and terminal-queries.test.ts; verified live with fish headless-first and in Chrome (one reply per query). Not committed.
<!-- SECTION:FINAL_SUMMARY:END -->
