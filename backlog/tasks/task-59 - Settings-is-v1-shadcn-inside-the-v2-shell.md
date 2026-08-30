---
id: TASK-59
title: Settings is v1 shadcn inside the v2 shell
status: To Do
assignee: []
created_date: '2026-08-30 23:10'
labels:
  - frontend
milestone: m-5
dependencies: []
ordinal: 59000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`components/SettingsDialog.tsx` was orphaned when the v1 routes went and TASK-28 reconnected it to `AppShell`'s Settings button, which until then did nothing. Reconnecting it was the right call — it is where the notification sound, the bell, the theme and the terminal font live, and with it unreachable the sound TASK-28 moved into `TaskContext` could never be switched on — but it is still drawn from `components/ui/` (v1 shadcn) and reads as a different application from the shell around it.

Port it to `components/v2/`: `Dialog`, `Select` and `Button` all exist there. Per CLAUDE.md the v2 design system is the UI this branch is being rebuilt into, and `components/ui/` is not to grow — this is one of the last places still leaning on it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The settings dialog is composed from components/v2 and uses the semantic tokens, no colour literals
- [ ] #2 Every setting it carries today still works: theme, terminal theme, font, size, notification sound, bell sound
- [ ] #3 components/ui/ is no larger than before, and smaller if the port frees a primitive
<!-- AC:END -->
