---
type: Gotcha
title: Bun.$ deadlocks on large git output
description: Bun's shell buffers output and deadlocks on large payloads, so every git invocation goes through gitSpawn/gitSpawnRaw, which use Bun.spawn.
tags: [gotcha, bun, git, spawn]
level: project
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-03T00:50:00Z }
sources:
  - id: claude-md
    resource: ../../CLAUDE.md
    title: CodeToaster CLAUDE.md
    author: human:tienshiao
  - id: api-utils
    resource: ../../src/api/utils.ts
    title: src/api/utils.ts
  - id: task-117
    resource: "../../backlog/tasks/task-117 - Oversized-diffs-freeze-the-page-cap-per-file-diff-payloads-and-long-lines.md"
    title: "TASK-117 — Oversized diffs freeze the page: cap per-file diff payloads and long lines"
---

# Symptom

A diff or log request hangs and never answers. The classic trigger is diffing many large untracked files: the payload is big enough that the shell's buffer fills and the process never finishes writing.[^claude-md]

# Rule

The project prefers Bun APIs everywhere, including `` Bun.$`cmd` `` over `execa`, with **one exception**: git. Every git invocation goes through `gitSpawn` / `gitSpawnRaw` in `src/api/utils.ts`, which use `Bun.spawn` and stream the output instead of buffering it in a shell.[^claude-md] [^api-utils]

# Related

Large payloads cause trouble downstream too: an uncapped diff of one huge file froze the page in the browser, which is why diffs are now capped per file and per line.[^task-117] Another Bun default that needs working around: [bunfig test options go quiet under bun run](/gotchas/bunfig-test-options-under-bun-run.md).

[^claude-md]: CodeToaster CLAUDE.md
[^api-utils]: src/api/utils.ts
[^task-117]: TASK-117 — Oversized diffs freeze the page: cap per-file diff payloads and long lines
