---
type: Module
title: Task naming
description: A task's stored name is a stable "<dir> · <branch>" label used for slugs and CLI matching, while the displayed label is projected at render time from a rename, the live terminal title, or the stored name.
tags: [naming, slugs, osc-title, xtmux]
level: project
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-03T00:50:00Z }
sources:
  - id: naming
    resource: ../../src/lib/xtmux/naming.ts
    title: src/lib/xtmux/naming.ts
  - id: claude-md
    resource: ../../CLAUDE.md
    title: CodeToaster CLAUDE.md
    author: human:tienshiao
---

# Two names, kept apart

| | Stored `name` | Displayed label |
| --- | --- | --- |
| What | `{dir} · {branch}`, or a manual rename | Projected by `sessionDisplayNames` at render time |
| Used for | The URL slug and the CLI's name matching | Sidebar, tabs, window title |
| Changes when | Only on a manual rename | Whenever the terminal title changes |

`name` is identity, so it must not churn every time a program repaints its title. The display label is never stored.[^naming]

# The projection

In order: an explicit rename, else the live terminal title (OSC 0/2) when it carries real content **and is unique across sessions**, else the stored name. Nothing is latched.[^claude-md]

An earlier design latched the name onto the first usable title. Every Claude Code session then froze on the generic startup title before any task existed, which is why the title is now live and falls back to the derived label when it goes quiet.[^naming]

"Real content" is decided by `meaningfulTitle` after `stripDecoration`: a shell prompt's default title (fish's `<command> <pwd>`, a bare `user@host`) is decoration, not content.[^naming]

# Slugs

Task URLs are `{slugified-name}-{uuid}`. Lookup keys off the uuid, so a rename only alters the slug cosmetically and old links keep working.[^claude-md]

# Why the module has no imports

`naming.ts` is import-free so the frontend can share the projection without pulling node builtins into the bundle. The filesystem and git lookups that feed `formatDerivedName` live in `lib/tasks/derive`.[^naming]

[^naming]: src/lib/xtmux/naming.ts
[^claude-md]: CodeToaster CLAUDE.md
