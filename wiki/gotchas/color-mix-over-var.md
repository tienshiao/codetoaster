---
type: Gotcha
title: color-mix over a var() renders opaque
description: Tailwind emits a color-mix over a CSS variable as an opaque fallback plus a nested @supports override that Bun's CSS bundler drops, so washes must be written oklch(var(--ct-x-ch) / alpha).
tags: [gotcha, css, tailwind, bun, design-system]
level: project
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-03T00:50:00Z }
sources:
  - id: index-css
    resource: ../../src/frontend/index.css
    title: src/frontend/index.css (palette comment)
  - id: claude-md
    resource: ../../CLAUDE.md
    title: CodeToaster CLAUDE.md
    author: human:tienshiao
---

# Symptom

A selected row comes out solid blue. A diff comes out solid green. Every transparent wash renders fully opaque in the bundled app, while the source looks right.[^index-css]

# Cause

`color-mix(in oklab, var(--ct-x) N%, transparent)` is emitted by Tailwind as an opaque fallback plus an `@supports` override nested inside the rule. Bun's CSS bundler drops that nested block, leaving only the fallback.[^index-css]

# Rule

- Write a wash as `oklch(var(--ct-x-ch) / <alpha>)`, never as a `color-mix()` over a `var()`.[^claude-md]
- The palette declares bare `L C H` channel triplets (`--ct-blue-500-ch` and friends) for exactly this. A wash over a palette step that has no `-ch` triplet means adding one first.[^index-css]
- Components never use the raw palette anyway; see [the v2 design system](/conventions/v2-design-system.md).

[^index-css]: src/frontend/index.css (palette comment)
[^claude-md]: CodeToaster CLAUDE.md
