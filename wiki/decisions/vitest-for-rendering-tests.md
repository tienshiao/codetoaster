---
type: Decision
title: Vitest for rendering tests only
description: Rendering tests run under Vitest with happy-dom because Bun has no per-file test environment, and a global DOM preload would break the server tests.
tags: [decision, testing, vitest, happy-dom, bun]
level: project
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-03T00:50:00Z }
sources:
  - id: claude-md
    resource: ../../CLAUDE.md
    title: CodeToaster CLAUDE.md
    author: human:tienshiao
  - id: vitest-config
    resource: ../../vitest.config.ts
    title: vitest.config.ts
---

# Decision

Component tests (`*.render.tsx`) run under Vitest with `environment: happy-dom`. Everything else stays on `bun test`.[^claude-md]

# Why

A rendering test needs a DOM. Bun has no per-file test environment, and its `preload` is global. The only way to give the frontend a `document` from inside `bun test` would be to give the server tests one too, then hand back the `fetch`, `Request` and `Response` that the route tests compare by identity. Scoping the DOM by runner means the server tests never see one at all.[^claude-md]

# Alternatives

| Option | Why not |
| --- | --- |
| One `bun test` run with a global happy-dom preload | Server tests get a DOM and lose the real `fetch`/`Request`/`Response` |
| `.test.tsx` names with an ignore pattern | The ignore is [silently dropped under bun run](/gotchas/bunfig-test-options-under-bun-run.md) |

# Cost and the one hazard

Two bundlers over one tree. A test resolving a module differently from the app is the real risk, so `vitest.config.ts` mirrors `tsconfig`'s `@/*` alias: if one moves, the other has to.[^claude-md] [^vitest-config] The day-to-day rules are in [Two test runners](/conventions/testing.md).

[^claude-md]: CodeToaster CLAUDE.md
[^vitest-config]: vitest.config.ts
