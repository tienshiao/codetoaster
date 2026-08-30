---
id: TASK-58
title: Terminal search has no way in since the v1 routes went
status: To Do
assignee: []
created_date: '2026-08-30 23:10'
labels:
  - frontend
milestone: m-5
dependencies: []
ordinal: 58000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`components/TerminalSearchBar.tsx` works and has no consumer. `AgentPane` and `ShellPane` both accept an `onSearchOpen` prop and neither is ever given one — `TabPane` renders `<AgentPane taskId visible />` (src/frontend/components/tabs/panes/TabPane.tsx:58) — and `Terminal.tsx` still raises the gesture. So the search UI, the plumbing and the xterm search addon are all present and unreachable.

Orphaned by TASK-21, which deleted the v1 session routes that rendered the bar; TASK-28 kept the component rather than deleting it, because losing a working feature is not the same as deleting v1 scaffolding.

What is missing is the decision TASK-28 had no business making: where search lives in the v2 shell. Options are a per-pane overlay (v1's shape, and what `onSearchOpen` already implies), or a strip affordance beside the split control. It also wants ⌘F, which is TASK-34's territory — worth doing together or in a deliberate order.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 ⌘F in a focused terminal tab opens search against that tab's terminal, and only that one
- [ ] #2 Search is reachable without the keyboard
- [ ] #3 Closing search returns focus to the terminal, and a split's two panes search independently
<!-- AC:END -->
