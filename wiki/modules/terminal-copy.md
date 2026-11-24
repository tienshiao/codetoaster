---
type: Module
title: Copying out of a terminal
description: Option-drag forces a local selection on a Mac while a program has the mouse, and a program's own OSC 52 copy is written to the browser's clipboard; OSC 52 reads are swallowed unanswered.
tags: [terminal, xterm, clipboard, frontend]
level: project
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-24T00:00:00Z }
sources:
  - id: terminal-clipboard
    resource: ../../src/frontend/utils/terminal-clipboard.ts
    title: src/frontend/utils/terminal-clipboard.ts
  - id: terminal
    resource: ../../src/frontend/Terminal.tsx
    title: src/frontend/Terminal.tsx
  - id: task-155
    resource: "../../backlog/tasks/task-155 - Copy-agent-output-from-the-terminal-on-macOS-and-over-remote-sessions.md"
    title: "TASK-155 — Copy agent output from the terminal on macOS and over remote sessions"
---

# Copying out of a terminal

There are two ways text leaves a terminal tab for the clipboard, and before
TASK-155 neither worked on a Mac while Claude Code held the mouse.

## A local selection: Option-drag, then ⌘C

When the program in the PTY turns on mouse reporting, xterm.js forwards every
click and drag to it, so a plain drag selects nothing in the browser. xterm.js
lets a modifier force a local selection anyway: Shift-drag on Linux and
Windows, Option-drag on macOS — but the macOS one only when
`macOptionClickForcesSelection` is set, and it defaults to off.

`Terminal.tsx` sets it per press, from a capture-phase `mousedown` that reads
`term.modes.mouseTrackingMode` (`optionClickOptions` in
`utils/terminal-clipboard.ts`), rather than once at construction:

- **Only while the program tracks the mouse.** With the option on, xterm.js
  also stops treating Option-drag as a column (block) selection, so a plain
  shell keeps its column select by leaving the option off there.
- **`altClickMovesCursor` is off while tracking.** A forced selection makes a
  short Option-click xterm's too, and xterm answers one by typing arrow keys
  into the PTY to walk a shell's cursor to the click — into a TUI such as
  Claude Code, where those arrows move its input or history instead. With no
  tracking it stays on, so Option-click still places a shell's cursor.

⌘C then copies through the browser's `copy` event, which xterm.js answers from
its selection via `clipboardData`. That path needs no secure context, so it
works over plain HTTP to a remote daemon. The shell keymap claims no ⌘C, so
nothing intercepts it.

## A program's own copy: OSC 52

A program that does its own selection copies by emitting
`OSC 52 ; Pc ; base64(text) ST`. xterm.js has no handler for it, so
`handleOsc52Clipboard` (`utils/terminal-clipboard.ts`) registers one that
decodes the payload as UTF-8 and calls `navigator.clipboard.writeText`. The
server's stream passes OSC 52 through to every client unchanged
(`lib/xtmux/image-stream.ts`), and the headless terminal ignores it.

- **Write only.** A read (`Pd` of `?`) is swallowed with no reply. This is why
  it is not `@xterm/addon-clipboard`: that addon answers a read by typing the
  browser's clipboard into the PTY, handing anything the user copied to any
  program that asks, and it would be one more client answering a terminal
  query, which `utils/terminal-queries.ts` exists to stop: only the server's
  headless terminal answers those.
- **`Pc` is ignored.** A browser has one clipboard, so every selection target
  lands there.
- **Nothing is cleared.** An empty or undecodable payload is ignored rather
  than taken as xterm's "clear", so a malformed sequence never wipes the
  clipboard.
- **Only a terminal on screen, in a focused window.** Every attached terminal
  receives the sequence, a hidden tab included, so `Terminal.tsx` passes
  `handleOsc52Clipboard` a predicate: `document.hasFocus()` and a non-zero
  container. It does not require the grid itself to have focus, because a
  `/copy` sent from the composer is the user's own copy as well.
- **Synchronous handler.** The clipboard promise is not returned to the
  parser, which would otherwise wait on it.
- **Any output can write.** Like most terminals that honour OSC 52, a program
  need not be asked: `cat` of a file carrying the sequence replaces the
  clipboard of whoever is watching.

### Where it does not reach

- `navigator.clipboard` exists only in a secure context: HTTPS or `localhost`.
  A remote daemon reached through an SSH tunnel to `localhost` qualifies; plain
  `http://host:port` does not, and the write is skipped. Option-drag and ⌘C
  still work there.
- Of several browsers on one machine attached to one PTY, only the focused
  window takes the copy. Browsers on different machines each have a focused
  window of their own, so a copy made on one also lands on the other's
  clipboard while it is showing that terminal. Safari and Firefox
  can require a user gesture for `writeText`, and an OSC 52 arriving over the
  socket is not one, so they may refuse; this was verified in Chrome only.
  Failures are swallowed.
