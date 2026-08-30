---
id: TASK-28
title: New App.tsx shell and TopBar; delete v1 UI scaffolding
status: To Do
assignee: []
created_date: '2026-08-29 00:03'
updated_date: '2026-08-30 09:20'
labels:
  - frontend
milestone: m-3
dependencies:
  - TASK-25
  - TASK-26
  - TASK-24
  - TASK-17
documentation:
  - docs/v2-architecture.md
ordinal: 28000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Assemble the §7.1 layout: task list left, tab area centre, Explorer right, both sidebars collapsible. Rewrite App.tsx and TopBar.tsx, delete TabSwitcher.tsx and any remaining v1 session-era components. This is the point where the v1 UI bolted on in Phase 1 is finally removed and the branch runs only the v2 shell.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The app renders the three-column shell with both sidebars collapsible
- [ ] #2 TabSwitcher.tsx and remaining session-era components are deleted; no code references sessions
- [ ] #3 Every Phase 1-3 server feature (create, resume, close, two-phase restore) is reachable from the UI
- [ ] #4 bun run dev boots the v2 shell with no console errors on the happy path
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
The shell this task installs already exists: `frontend/components/v2/AppShell.tsx`, built in TASK-46 from the v2 design system, currently rendered with fixture data at `routes/shell.tsx`. This task is where it moves to `/` and the v1 scaffolding goes — not where it gets designed. AppShell is layout only, so the work here is wiring the props TASK-20/24/25/26 produce and deleting, not restructuring markup.

TASK-20's AC #4 ('SessionContext.tsx and its consumers are gone') was removed there and lives here as AC #2, where it belongs. TASK-20 is additive: TaskContext is added alongside SessionContext, the way PtyContext was in TASK-19, so the branch stays runnable. This task is where both adapters come out — SessionContext itself, and the PtyContext bridge SessionContext currently goes through.

TASK-21's S4 already did part of this task's deletions, because they could not compile once the session routes went: App.tsx, AppSidebar.tsx, FileView.tsx, CommandPalette.tsx, TabSwitcher.tsx, GitView.tsx, use-sidebar-drag.ts, use-terminal-preview.ts, and view-state-store's 'nav' slot. AppShell is already at / and /t/$slug via components/TaskShell.tsx.

What is left here: rewrite TopBar.tsx (or drop it — AppShell carries its own header), delete ProjectDialog.tsx and types/tab.ts, and take out SessionContext.tsx together with the PtyContext bridge it goes through. That last one is the real work and the reason it was not folded into S4: the adapter still subscribes to the socket, still owns the notification sound and web notifications, and its attachment handling was the source of the bug S1 found. Its isViewingTerminalRef is currently pinned true and its focus-acknowledge effect is inert (currentSessionIdRef is never set with no v1 UI), so nothing depends on it — but it should come out as a piece, with AgentPane confirmed to cover sound and notifications.
<!-- SECTION:NOTES:END -->
