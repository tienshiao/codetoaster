---
id: TASK-19
title: PtyContext multiplexer and multi-instance Terminal
status: Done
assignee: []
created_date: '2026-08-29 00:02'
updated_date: '2026-08-30 01:28'
labels:
  - frontend
  - xtmux
milestone: m-3
dependencies:
  - TASK-3
documentation:
  - docs/v2-architecture.md
priority: high
ordinal: 19000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the single terminalRef + message queue in SessionContext with PtyContext (§7.4): attach(ptyId, handlers), sendInput(ptyId, data), resize(ptyId, size), and a router that dispatches restore/stream/exit/resize to the one terminal bound to that ptyId. Terminal.tsx takes a ptyId prop and registers itself; its internals (fit-only-when-visible, theme, touch scrolling, search addon, drag/drop, RIS-on-restore) are kept as they are. Hidden tabs report size null.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Two Terminal instances on different ptyIds in one client receive only their own stream
- [x] #2 Messages arriving before a terminal mounts are queued per ptyId and replayed on attach
- [x] #3 A terminal in a hidden tab sends resize null and stays attached
- [x] #4 Closing a tab sends close and unregisters the handler
- [x] #5 Existing Terminal.tsx behaviours (fit, theme, touch, search, drop, RIS restore) still work
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Extract the routing core to `frontend/pty-router.ts` — a plain object, no React. Per-ptyId sink registry, per-ptyId queues, an `attached` set that bounds them, and subscriber fan-out for non-PTY traffic. Extracted rather than left inside the provider because 'two terminals never cross streams' is the guarantee the task exists for, and the UI renders one terminal until TASK-22 — so this is the only place it can be demonstrated.
2. `frontend/PtyContext.tsx` owns the one socket and wires it to the router. The socket's own callbacks are omitted from what components get: a consumer that could call handleConnect could fake a reconnect and clear every attachment.
3. `Terminal.tsx` self-registers under its ptyId through a stable sink, gated on the xterm existing so nothing queued is delivered into a null grid. The provider is optional so a terminal in a design-system preview has no stream rather than throwing.
4. `SessionContext.tsx` becomes the adapter: its single terminalRef routing and flat queue go, it consumes the router, and its attach/detach go through the router so the attached set stays true. Deliberately additive — v1 keeps running until TASK-28 deletes the adapter.
5. Unit-test the router for the acceptance criteria; drive the real app for the ones that need a DOM.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Build against `frontend/components/v2/` — the v2 design system is the new UI, not a parallel track (CLAUDE.md, "The v2 design system is the new UI"). `AppShell` and the shell components already exist from TASK-46; this task supplies their data. Do not extend `components/ui/` (v1 shadcn) for new surfaces.

Done. `pty-router.ts` + `PtyContext.tsx` + self-registration in `Terminal.tsx`, with `SessionContext` as the adapter that keeps v1 running until TASK-28.

**Verification.** 29 router unit tests carry AC #1-#4, because the UI renders one terminal until TASK-22 and the isolation guarantee has nowhere else to be demonstrated. AC #5 and the wire-level preconditions were driven for real: a fresh daemon, two tasks created over HTTP, one socket attached to both PTYs (two `attached` pairs, frames addressed to each, none stray), then in the browser — type AAA into task 1, switch, type BBB into task 2, switch back, and each terminal shows only its own text. Reload re-attaches and restores the scrollback including typed text, so the reconnect/list/re-attach/restore path and the RIS-on-restore machinery all survive. No console errors. The task-scoped API surface still answers (diff, files, git/log, git/refs, scrollback, symbols, preview as real serialize-HTML rather than the SPA fallback; git/commit?sha=HEAD still 400s by design).

**Three regressions I introduced and the review caught**, all real:
- Server `error` frames were silently swallowed. `ptyIdOf` returns null for them, so they fan out to subscribers, and the rewritten `onMessage` had no case — meaning `Terminal "…" not found` and `Not attached to terminal "…"` produced a dead grid with no explanation, and `restore-phase.ts`'s `case "error"` arm became dead code. Now forwarded to the terminal handle.
- An unstable `send` rebuilt the xterm on every connect and every drop. It was allocated inside the memo keyed on `isConnected`, so its identity rippled through `handleTerminalReady` → `onReady` → the init effect's deps → `term.dispose()`. Every page load built the terminal twice and every network blip wiped the grid. Now a `useCallback([], …)` through `sendRef`.
- The sink registration depended on the whole context value, so it unbound and rebound mid-stream on each reconnect — and in the same commit as an init re-run it drained the queue into a disposed `termRef`, which is exactly what gating on `ready` was supposed to prevent. Now keyed on `registerTerminal`, whose identity belongs to the router and outlives the socket.

Also fixed from the same pass: the `fresh` resume latch in `sessions.$slug.tsx` missed a p1→p2 transition, and `detach` branched on `=== undefined` locally but on truthiness for the wire.

**Known gap, not this task's:** an `error` frame is not addressed to a PTY, so with several terminals on screen there is no way to say which grid it belongs to. Routing it to `terminalRef` is right while one terminal renders; TASK-22 needs a real answer, most likely making the server address the error to the PTY that provoked it.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Replaces the single terminalRef and flat message queue with a per-PTY router. frontend/pty-router.ts holds the routing rules as a plain object — sink registry, per-ptyId queues, an attached set that bounds them, subscriber fan-out for non-PTY traffic — and PtyContext owns the one socket and wires it up. Terminal instances self-register under their ptyId, gated on the xterm existing. SessionContext becomes an adapter over the router so v1 keeps running until TASK-28 deletes it.

Verified with 29 router unit tests for the isolation and queueing guarantees (the UI renders one terminal until TASK-22, so they have nowhere else to be shown), plus a real drive: two tasks on one socket at the wire level, and in the browser two tasks typed into and switched between with no cross-talk, surviving a reload with scrollback intact. 585 tests pass, tsc clean, no console errors.

Three regressions caught by review and fixed: swallowed error frames, an unstable send that rebuilt the xterm on every connect, and a registration that unbound mid-stream. Two findings left as TASK-48 and TASK-49.
<!-- SECTION:FINAL_SUMMARY:END -->
