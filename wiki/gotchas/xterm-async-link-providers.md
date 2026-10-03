---
type: Gotcha
title: xterm link providers must answer synchronously
description: A link provider whose provideLinks callback fires later underlines on hover but does nothing on click, because xterm captures the link on mousedown.
tags: [gotcha, xterm, terminal, links]
level: project
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-03T00:50:00Z }
sources:
  - id: task-110
    resource: "../../backlog/tasks/task-110 - Commit-hashes-in-a-tasks-terminals-open-the-commit.md"
    title: "TASK-110 — Commit hashes in a task's terminals open the commit"
  - id: terminal-links
    resource: ../../src/frontend/utils/terminal-links.ts
    title: src/frontend/utils/terminal-links.ts
---

# Symptom

A terminal link underlines on hover and **does nothing on click**. Every test passes.[^task-110]

# Cause

xterm's `Linkifier` captures the hovered link on mousedown and activates it on mouseup, and both must name the same link. A provider whose `provideLinks` callback fires a microtask or a round trip later has nothing captured when the button goes down.[^task-110]

Combining providers made it contagious: a combinator that waits for every part defers the whole row whenever one part is async. Providers are therefore registered on the grid one by one.[^terminal-links]

# Rule

Any link provider must answer in the same turn on the path a user actually clicks. `commit-links.ts` does it with a resolver split into `peek` (synchronous, for anything already settled) and `resolve` (one round trip per unseen value), so only the very first hover over a given hash is async.[^task-110]

A rendering test cannot catch this: it calls `activate()` directly and never goes through xterm's mouse handling. Check a new provider in a real browser — see [Verify on an isolated server](/runbooks/verify-on-isolated-server.md). Background on the providers themselves: [terminal links](/modules/terminal-links.md).

[^task-110]: TASK-110 — Commit hashes in a task's terminals open the commit
[^terminal-links]: src/frontend/utils/terminal-links.ts
