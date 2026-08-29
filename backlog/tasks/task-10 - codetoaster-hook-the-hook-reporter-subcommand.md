---
id: TASK-10
title: 'codetoaster hook: the hook reporter subcommand'
status: Done
assignee:
  - '@claude'
created_date: '2026-08-29 00:02'
updated_date: '2026-08-29 05:24'
labels:
  - cli
  - agent
milestone: m-1
dependencies: []
documentation:
  - docs/v2-architecture.md
priority: high
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
New cli/hook.ts (§4.2). Reads the hook payload from stdin, reads CODETOASTER_TASK_ID / CODETOASTER_PORT from env, and POSTs it to the daemon. Hard requirements: it must print NOTHING to stdout (SessionStart stdout is injected into the conversation as context), must always exit 0, and must be fast — ~1 s fetch timeout, every error swallowed. A daemon that is down must never wedge an agent.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Writes zero bytes to stdout on every path, including errors
- [x] #2 Exits 0 whether the daemon is up, down, slow, or returns an error
- [x] #3 Gives up within ~1 s when the daemon does not answer
- [x] #4 Posts the raw payload plus task id to the daemon's hook endpoint
- [x] #5 Tests cover: daemon up, daemon down, missing env vars, malformed stdin
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. src/cli/hook.ts exports cmdHook(): never throws, never writes a byte to stdout, always resolves. SessionStart stdout is injected into the conversation as context, so silence is a correctness property, not tidiness.
2. ONE deadline (~1s) covering the stdin read AND the POST, not a fetch timeout alone. A hook invoked with no stdin attached would otherwise block on a read that never ends, and the agent would wear the full 5s settings timeout on every event. AbortSignal.timeout for the fetch, Promise.race for the read.
3. POST http://localhost:$CODETOASTER_PORT/api/tasks/$CODETOASTER_TASK_ID/hook with the payload as the untouched body: the id rides in the URL, so 'raw payload plus task id' needs no wrapper object. The endpoint itself is TASK-11.
4. Missing env vars, or zero bytes on stdin: return at once, post nothing. Non-empty but unparseable: post it anyway. The reporter is transport, not a validator — one that silently dropped what it could not parse would hide a payload-shape change behind exactly the tidy negative result §4.4 warns about.
5. src/index.ts dispatches 'hook' through a dynamic import, and ./cli/commands becomes dynamic too. That static import pulls in server.ts and its whole graph: measured 180ms for `bun src/index.ts --version` against 89ms for a bare bun start, so ~90ms of pure waste on every UserPromptSubmit and Stop.
6. Tests spawn the real CLI as a subprocess, since the acceptance criteria are all about what the process does rather than what a function returns: assert empty stdout and exit 0 against a live fake daemon, a dead port, a server that never answers (and returns inside the deadline), absent env vars, and malformed stdin.
7. Then /code-review --fix and /verify.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
src/cli/hook.ts reads stdin and POSTs the payload untouched to /api/tasks/<id>/hook — the task id rides in the path, so 'raw payload plus task id' needs no wrapper object and no field of ours to fall out of date. Missing env vars or an empty payload return without posting; an unparseable payload is posted anyway, because the reporter is transport rather than a validator and one that silently dropped what it could not read would hide a payload-shape change behind exactly the tidy negative result §4.4 warns about.

Two decisions worth recording:
- ONE ~1s budget covers the stdin read AND the POST, not just the fetch. A hook whose stdin is never closed would otherwise block before it ever reached the fetch, and the agent would wear the full 5s settings timeout on every event. There is a test that holds stdin open.
- src/index.ts now dispatches 'hook' through a dynamic import, and ./cli/commands is dynamic too. That static import pulled in server.ts and its whole graph: 180ms for 'bun src/index.ts --version' against 89ms for a bare bun start. The hook path now runs in ~126ms, and hooks fire on every prompt and every stop.

Tests spawn the real CLI as a subprocess, since every criterion here is about what the process does: daemon up (payload arrives verbatim at the right path), dead port, a daemon that accepts and never answers, stdin that never closes, absent env vars, malformed stdin, empty stdin — asserting empty stdout and exit 0 on all of them.

Code review (--fix) found nothing in this diff, but four things in the branch behind it, all fixed and committed separately: a path traversal in POST /api/tasks/:id/upload (a multipart filename of '../../../Users/me/.zshrc' escaped /tmp — the uuid prefix absorbs the first '..' and the rest walk out); deleteProject reassigning rows by the manager's in-memory taskIds, which leaves a suspended task pointing at a project that no longer exists; createSession sending a stale afterTaskId that 404s the whole create over a positioning hint; and untrimmed titles reaching the row, the uniqueness check and the URL slug.

Runtime verification (daemon on :4599): a fresh task's terminal shows the plain Claude Code banner with NO hook error — the reporter runs, exits 0 and prints nothing, where before TASK-10 it printed 'Failed with non-blocking status code: Unknown command: hook'. Run by hand against the daemon it exits 0 with exactly 0 bytes on stdout, even though POST /api/tasks/<id>/hook still answers 404: the endpoint is TASK-11.
bun test 318 pass / 0 fail; bunx tsc --noEmit clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
codetoaster hook reads a hook payload from stdin and posts it to the daemon named by CODETOASTER_TASK_ID and CODETOASTER_PORT, under one ~1s budget covering the read and the post, printing nothing and always exiting 0 — the three properties matter more than the transport, since hooks run synchronously in the agent's path and SessionStart stdout is injected into the conversation as context. The subcommand is dispatched before ./cli/commands loads, by dynamic import, because that module pulls in the server's whole graph and hooks fire on every prompt and stop. Verified live: the agent's startup no longer carries a hook error, and the reporter exits 0 silently against a daemon whose endpoint does not exist yet (TASK-11).
<!-- SECTION:FINAL_SUMMARY:END -->
