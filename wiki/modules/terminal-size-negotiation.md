---
type: Module
title: Terminal size negotiation
description: When several browsers attach to one PTY, the terminal takes the smallest measured cols and rows across clients, ignoring clients that have not measured or reported garbage.
tags: [xtmux, pty, multi-client, resize]
level: project
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-03T00:50:00Z }
sources:
  - id: pty
    resource: ../../src/lib/xtmux/pty.ts
    title: src/lib/xtmux/pty.ts
  - id: claude-md
    resource: ../../CLAUDE.md
    title: CodeToaster CLAUDE.md
    author: human:tienshiao
---

# Smallest wins

A PTY can have any number of attached clients, and a program can only draw at one size. The server takes the minimum `cols` and the minimum `rows` across every client that has measured its terminal, resizes its `@xterm/headless` copy and the real PTY, and broadcasts a `resize` to all clients.[^pty] [^claude-md]

Nothing happens when the result equals the current size, so a client re-reporting the same dimensions is free.[^pty]

# Who does not get a vote

- **A client with no size yet.** It attached but has not measured (its container is not laid out). It does not constrain the result. If no client has measured, the current size is kept.[^pty]
- **A client reporting garbage.** Sizes come off the wire, so `sanitizeSize` rejects anything that is not an integer pair in range (cols 2–10000, rows 1–10000) and treats it as no measurement. Letting `NaN` or `0` into `Math.min` would resize every client's terminal to nonsense.[^pty]
- **A client that left.** Recalculation runs when clients come and go, so the size grows back once the smallest browser detaches.

# Restore

The server holds the authoritative screen in `@xterm/headless` and serializes it for a newly attached client, so a late joiner gets the current screen at the negotiated size rather than a blank terminal. Over the socket, `attached` pairs the task with its PTY and arrives before that PTY's `restore`.[^claude-md]

[^pty]: src/lib/xtmux/pty.ts
[^claude-md]: CodeToaster CLAUDE.md
