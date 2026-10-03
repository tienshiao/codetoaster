---
type: Runbook
title: Verify on an isolated server
description: Check a change at runtime from a second server on its own port and database, driving tasks with the shell profile so no real agent starts.
tags: [runbook, verification, dev-server, browser]
level: project
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-03T00:50:00Z }
sources:
  - id: verify-skill
    resource: ../../.claude/skills/verify/SKILL.md
    title: verify skill
  - id: claude-md
    resource: ../../CLAUDE.md
    title: CodeToaster CLAUDE.md
    author: human:tienshiao
---

# When

After the suites pass, for anything a test cannot see: real geometry, xterm's mouse handling ([async link providers](/gotchas/xterm-async-link-providers.md)), a link that opens a tab, a bundling problem. Happy DOM has no layout engine.[^claude-md]

# Why a second server

The server you develop against holds real tasks in `~/.codetoaster/`. A verification server runs beside it on its own port with its own database, so nothing it creates or breaks touches that state.[^verify-skill]

# Steps

1. From the checkout under test (sessions inherit the server's cwd, so they land in this repo):

   ```sh
   bun src/index.ts foreground --port 4599 --db /tmp/verify.db
   ```

   `foreground` skips the daemon and PID file; `--db` isolates state. Ready when `/` answers 200.[^verify-skill]

2. Create a task with the **shell** profile, which runs `$SHELL` and no agent:

   ```sh
   curl -s -X POST http://localhost:4599/api/tasks \
     -H 'Content-Type: application/json' -d '{"cols":120,"rows":30,"profile":"shell"}'
   ```

   Omitting `profile` starts a real `claude`, with a transcript and tokens, once per task.[^verify-skill]

3. Exercise task routes under `/api/tasks/<task-id>/…` (`files`, `file?file=`, `diff`, `git/log`, …). An unmatched `/api/…` path answers the SPA's HTML with a 200, so check the content type before concluding a route exists.[^verify-skill]

4. For the UI, open `http://localhost:4599/` in a browser. A quick way to open a file tab is to `echo` its path in the task's shell and click it — [terminal links](/modules/terminal-links.md) make it a link. To check [markdown preview links](/modules/markdown-preview.md), open this wiki's pages.

5. Stop the server when done; its PTYs die with it.

# Gotchas

- `bun run dev` also spawns `tsr` and `tsc` watchers; use `foreground` directly.
- The task id and the PTY id differ: HTTP routes and `kill` take the task, `attach`/`input`/`resize` take the PTY. Read `ptyId` off the create response.[^verify-skill]

[^verify-skill]: verify skill
[^claude-md]: CodeToaster CLAUDE.md
