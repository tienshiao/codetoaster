---
id: TASK-19
title: PtyContext multiplexer and multi-instance Terminal
status: To Do
assignee: []
created_date: '2026-08-29 00:02'
updated_date: '2026-08-30 00:34'
labels:
  - frontend
  - xtmux
milestone: m-3
dependencies:
  - TASK-3
documentation:
  - docs/v2-architecture.md
priority: high
ordinal: 19000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the single terminalRef + message queue in SessionContext with PtyContext (§7.4): attach(ptyId, handlers), sendInput(ptyId, data), resize(ptyId, size), and a router that dispatches restore/stream/exit/resize to the one terminal bound to that ptyId. Terminal.tsx takes a ptyId prop and registers itself; its internals (fit-only-when-visible, theme, touch scrolling, search addon, drag/drop, RIS-on-restore) are kept as they are. Hidden tabs report size null.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Two Terminal instances on different ptyIds in one client receive only their own stream
- [ ] #2 Messages arriving before a terminal mounts are queued per ptyId and replayed on attach
- [ ] #3 A terminal in a hidden tab sends resize null and stays attached
- [ ] #4 Closing a tab sends close and unregisters the handler
- [ ] #5 Existing Terminal.tsx behaviours (fit, theme, touch, search, drop, RIS restore) still work
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Build against `frontend/components/v2/` — the v2 design system is the new UI, not a parallel track (CLAUDE.md, "The v2 design system is the new UI"). `AppShell` and the shell components already exist from TASK-46; this task supplies their data. Do not extend `components/ui/` (v1 shadcn) for new surfaces.
<!-- SECTION:NOTES:END -->
