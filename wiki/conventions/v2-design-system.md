---
type: Convention
title: The v2 design system
description: New frontend work composes from components/v2 with semantic tokens only; AppShell is layout-only and replaces App.tsx in TASK-28.
tags: [frontend, design-system, tailwind, tokens]
level: project
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-03T00:50:00Z }
sources:
  - id: claude-md
    resource: ../../CLAUDE.md
    title: CodeToaster CLAUDE.md
    author: human:tienshiao
  - id: task-28
    resource: "../../backlog/tasks/task-28 - New-App.tsx-shell-and-TopBar-delete-v1-UI-scaffolding.md"
    title: "TASK-28 — New App.tsx shell and TopBar; delete v1 UI scaffolding"
---

# Status

`components/v2/` is not an experiment or a parallel track. It is the UI this branch is being rebuilt into: the task list, tab bar, Explorer and composer are all composed from it, and TASK-28 is where `AppShell` replaces `App.tsx` at `/` and the v1 scaffolding is deleted. Until then `routes/shell.tsx` renders it with fixture data and v1 keeps running.[^claude-md] [^task-28]

# Rules

- Compose from `components/v2/`. Reach for `components/ui/` (shadcn) only when touching v1 code that is still live, and do not grow it.
- `AppShell` is layout only. Every list, tab and status value arrives as a prop, so wiring tasks supply data rather than restructure markup.
- Use the semantic tokens (`bg-pane`, `text-state-busy`, `h-row`, `text-micro`, `bg-selected`), never a colour literal. The raw `--ct-*` palette is not component vocabulary.[^claude-md]

# Source of truth

The Claude Design project "CodeToaster v2 Design System" (`06f63995-570a-486c-af82-d70b8fa5976b`). It is distinct from the older `.design-sync/` pipeline, which pushes the *v1* component surface upward.[^claude-md]

# Before touching the token layer

Read the comment above the palette block in `src/frontend/index.css`. Transparent washes have a bundling trap of their own: [color-mix over a var() renders opaque](/gotchas/color-mix-over-var.md).

[^claude-md]: CodeToaster CLAUDE.md
[^task-28]: TASK-28 — New App.tsx shell and TopBar; delete v1 UI scaffolding
