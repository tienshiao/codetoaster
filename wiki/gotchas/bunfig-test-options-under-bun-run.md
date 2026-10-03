---
type: Gotcha
title: bunfig test options go quiet under bun run
description: --path-ignore-patterns and bunfig's pathIgnorePatterns work from a shell but are silently ignored under bun run, so anything the test suite depends on must not rest on them.
tags: [gotcha, bun, testing, bunfig]
level: project
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-03T00:50:00Z }
sources:
  - id: claude-md
    resource: ../../CLAUDE.md
    title: CodeToaster CLAUDE.md
    author: human:tienshiao
---

# Symptom

An exclusion or option holds when you try it by hand and fails in CI. `bun test --path-ignore-patterns …` and `bunfig.toml`'s `pathIgnorePatterns` both work from a shell, and both are silently ignored when the same tests run through `bun run`, which is how `bun run test` and CI invoke them.[^claude-md]

# Consequences in this repo

- Render tests are named `*.render.tsx`, not `*.test.tsx`. Bun only discovers files with `.test`/`.spec` in the name, so the split needs no ignore option at all. Renaming them "to be consistent" would make `bun test` pick them up, and the ignore that would stop it is exactly the one that goes quiet. See [Two test runners](/conventions/testing.md).[^claude-md]
- The fake-agent guard is a `[test] preload` line in `bunfig.toml`, the same family of option. `agent-bin.test.ts` exists so a lapse fails loudly (`Received: "claude"`) instead of spawning real agents.[^claude-md]

[^claude-md]: CodeToaster CLAUDE.md
