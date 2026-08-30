---
id: TASK-28
title: New App.tsx shell and TopBar; delete v1 UI scaffolding
status: Done
assignee:
  - '@claude'
created_date: '2026-08-29 00:03'
updated_date: '2026-08-30 23:11'
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
- [x] #1 The app renders the three-column shell with both sidebars collapsible
- [x] #2 TabSwitcher.tsx and remaining session-era components are deleted; no code references sessions
- [x] #3 Every Phase 1-3 server feature (create, resume, close, two-phase restore) is reachable from the UI
- [x] #4 bun run dev boots the v2 shell with no console errors on the happy path
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Both questions this task was carrying are settled by the code rather than by a judgment call.

**TopBar is deleted, not rewritten.** Nothing renders it — `grep` finds no consumer for `TopBar.tsx`, `ProjectDialog.tsx` or `types/tab.ts`; they were orphaned by TASK-21's route deletions and only still compile. What TopBar draws is v1's four-tab switcher (Terminal/Diff/Files/Git), which is the exact thing the v2 tab area replaced, and `AppShell` carries its own header. There is nothing here to port.

**The notification port goes to `TaskContext`, not to a pane.** The comment on `setViewedTask` says sound and web notifications move to 'the component that knows what is on screen', but that cannot be a pane: a notification's whole purpose is to ring for a task the user is *not* looking at, and that task's `AgentPane` is not mounted. It has to be handled by the one thing that sees every frame. `setViewedTask` moves across unchanged; `AgentPane` keeps its own acknowledge-on-focus, which is already the rule stated where the terminal is.

Slices, each independently green:

1. **Port the live behaviour.** Move the socket's `notification` branch into `TaskContext` — acknowledge when the frame names the viewed task and the window has focus, else play the sound; raise a web notification whenever the window is unfocused — along with `fireWebNotification` and `setViewedTask`. Drop `isViewingTerminalRef` rather than porting it: it has been pinned `true` since TASK-21 took the v1 diff route away, so every read of it is `&& true`. Rendering tests for the three branches, which is what makes this a port rather than a rewrite with the same name.

2. **Delete the adapter.** `SessionContext.tsx` whole, and the `PtyContext` bridge it goes through, out of `routes/__root.tsx`. This also removes a live duplicate: `TaskContext` and `SessionContext` both subscribe and both `toast.error` on a client-wide socket `error`, so every one of those currently raises two toasts. Take `TaskContext`'s 'holds no side effects' comment with it — the constraint existed only because there were two subscribers.

3. **Delete the orphans:** `TopBar.tsx`, `components/ProjectDialog.tsx`, `types/tab.ts`. Then check whether `SidebarProvider`/`useSidebar` (v1 shadcn) still has a consumer once TopBar's `SidebarTrigger` is gone; if not, it comes out of `__root` too, since `AppShell` owns its own sidebars.

4. **AC #2's long tail: `sessionId` → `taskId`.** 149 occurrences across 23 files — `DiffView`, the diff/file/git components and the query hooks — plus `use-session-diff.ts` and `use-session-files.ts`, which are renamed. Purely mechanical; the server has called this a task since TASK-6 and only the client's prop names still say session.

5. **Verify.** `bun run dev` boots the shell with no console errors, and AC #3's round trip — create, resume, close, two-phase restore — driven in a browser against an isolated daemon, since that is the acceptance criterion that cannot be read off a test.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
The shell this task installs already exists: `frontend/components/v2/AppShell.tsx`, built in TASK-46 from the v2 design system, currently rendered with fixture data at `routes/shell.tsx`. This task is where it moves to `/` and the v1 scaffolding goes — not where it gets designed. AppShell is layout only, so the work here is wiring the props TASK-20/24/25/26 produce and deleting, not restructuring markup.

TASK-20's AC #4 ('SessionContext.tsx and its consumers are gone') was removed there and lives here as AC #2, where it belongs. TASK-20 is additive: TaskContext is added alongside SessionContext, the way PtyContext was in TASK-19, so the branch stays runnable. This task is where both adapters come out — SessionContext itself, and the PtyContext bridge SessionContext currently goes through.

TASK-21's S4 already did part of this task's deletions, because they could not compile once the session routes went: App.tsx, AppSidebar.tsx, FileView.tsx, CommandPalette.tsx, TabSwitcher.tsx, GitView.tsx, use-sidebar-drag.ts, use-terminal-preview.ts, and view-state-store's 'nav' slot. AppShell is already at / and /t/$slug via components/TaskShell.tsx.

What is left here: rewrite TopBar.tsx (or drop it — AppShell carries its own header), delete ProjectDialog.tsx and types/tab.ts, and take out SessionContext.tsx together with the PtyContext bridge it goes through. That last one is the real work and the reason it was not folded into S4: the adapter still subscribes to the socket, still owns the notification sound and web notifications, and its attachment handling was the source of the bug S1 found. Its isViewingTerminalRef is currently pinned true and its focus-acknowledge effect is inert (currentSessionIdRef is never set with no v1 UI), so nothing depends on it — but it should come out as a piece, with AgentPane confirmed to cover sound and notifications.

**The two questions the task carried were answered by the code, not by a judgment call.** Nothing rendered `TopBar.tsx`, `ProjectDialog.tsx` or `types/tab.ts` — TASK-21 orphaned them and they only still compiled — and what TopBar drew was v1's four-tab switcher, which is the thing the v2 tab area replaced. Deleted, not rewritten. And the notification port went to `TaskContext` rather than to a pane: a notification exists to ring for a task you are *not* looking at, whose `AgentPane` is by definition not mounted, so it has to be handled by the one thing that sees every frame.

**Deleting the adapter fixed a live duplicate.** `TaskContext` and `SessionContext` both subscribed to the socket and both called `toast.error` on a client-wide `error` frame, so every one of those raised two toasts. Related in symptom to TASK-57 but a different path — that one is HTTP mutations.

**`isViewingTerminalRef` was dropped rather than ported.** It has been pinned `true` since TASK-21 took the v1 diff route away, so every read of it was `&& true`; carrying it across would have moved a dead flag into new code and made the new code look conditional when it is not.

**The orphans were not all scaffolding, and the difference mattered.** Superseded or session-era, so deleted: `TerminalPreview` (v1's sidebar hover preview), `RenameDialog` (`TaskRowActions` reimplemented it), `HelpDialog` (it documents v1 keybindings that no longer exist — TASK-34 writes the real one), `DirectoryPickerDialog` and `InitialPathAutocomplete` (named in `PathField`'s own comment as the v1 reference it replaced), and eight `components/ui/` primitives left with no consumer. But two were working features orphaned by a route deletion, and deleting those would have been destroying a feature under cover of a cleanup:

- **Settings** was reconnected here. `AppShell` already drew a Settings button and passed nothing to it, so the affordance was on screen and dead — and since it is the only place the notification sound is configured, leaving it unreachable would have meant the sound this task just ported could never be switched on. Made controlled (it carried its own v1 button, which the shell already draws) and given a `DialogDescription`, which also cleared the two Radix console warnings opening it produced. Its v1 styling is TASK-59.
- **Terminal search** was kept and filed as TASK-58. `TerminalSearchBar` works, `AgentPane`/`ShellPane` both take an `onSearchOpen` that `TabPane` never supplies. Where search lives in the v2 shell is a design decision this task had no business making, and it wants ⌘F, which is TASK-34's.

**AC #2's long tail:** `sessionId` → `taskId` across 23 files, `useSessionDiff`/`useSessionFiles` → `useTaskDiff`/`useTaskFiles`, the two hook files renamed, and the react-query key prefix `"sessions"` → `"tasks"` (checked first that nothing invalidates by that key). The URLs already said `/api/tasks/` — only the client's vocabulary still said session.

Validation: `bun run test` (706 unit + 72 render), `tsc --noEmit` clean. `TaskContext.render.tsx` is new and pins the ported notification behaviour — all four tests confirmed to fail with the branch removed, which is the only thing that makes this a port rather than a rewrite that happens to share a name. AC #3 and #4 driven in a browser against an isolated daemon with a stand-in agent: boots with no console output but the HMR line, Settings opens and works, and create → close → reopen walks the two-phase restore back to `idle` with the snapshot repainted.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
v1 stops running. `SessionContext.tsx` and the `PtyContext` bridge it went through are gone from `__root`, together with `TopBar`, `ProjectDialog`, `types/tab`, five superseded components and eight `components/ui/` primitives with no consumer left — about 2,400 lines. The socket has one subscriber again, which is what lets the notification sound, the desktop notification and the `acknowledge` that answers one live in `TaskContext`; it also stops client-wide socket errors raising two toasts.

Two features the v1 route deletion had orphaned were treated as features rather than as scaffolding: Settings is reconnected to the button `AppShell` was already drawing for it (and is the only place the ported sound can be turned on), and terminal search is kept and filed as TASK-58 rather than deleted, because where it lives in the v2 shell is a design decision. TASK-59 covers restyling Settings to v2.

The client's vocabulary now matches the server's: `sessionId` → `taskId` across 23 files, and the two `use-session-*` hooks renamed. `TaskContext.render.tsx` pins the moved notification behaviour — each test verified to fail without it.
<!-- SECTION:FINAL_SUMMARY:END -->
