---
id: TASK-21
title: 'Routing: /, /t/$slug, and ?tab= deep links'
status: Done
assignee:
  - '@claude'
created_date: '2026-08-29 00:02'
updated_date: '2026-08-30 09:21'
labels:
  - frontend
milestone: m-3
dependencies:
  - TASK-18
  - TASK-20
documentation:
  - docs/v2-architecture.md
ordinal: 21000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Shrink five routes to three (§7.3): `/` renders the composer pane inside the app shell; `/t/$slug` renders a task with tabs from the stored layout; `/t/$slug?tab=<tabKey>` ensures that tab exists and focuses it. Delete sessions.$slug.{diff,file,git}.tsx and the TAB_ROUTES / tabNavTarget / sessionNavTarget machinery in utils/session-nav.ts. slug.ts survives with task naming ({slugified-title}-{uuid}, id in the last 36 chars).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Only /, /t/$slug, and the ?tab= variant exist in routeTree.gen.ts
- [x] #2 A ?tab= link to a not-yet-open tab opens and focuses it; to an open tab just focuses it
- [x] #3 utils/session-nav.ts is deleted
- [x] #4 Task slugs derive from title and id; a rename changes only the slug prefix and old links still resolve
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Sequencing decision (user-approved): TASK-21 cannot land alone. Deleting the tab routes breaks compilation of App.tsx, AppSidebar, CommandPalette, TabSwitcher, GitView and SymbolPopover (TanStack types navigate() off routeTree.gen, and tsc --noEmit runs in dev). The v2 shell also cannot take over yet: routes/shell.tsx renders TerminalFixture, and without TASK-26's Explorer no tab but the agent can be opened. So 21 lands together with the v2 agent terminal host, TASK-25 and TASK-26; TASK-24 and TASK-28 then close Phase 4.

S1. Agent terminal host. AgentPane (components/tabs/panes/AgentPane.tsx) owning one XTerminal bound to task.ptyId via PtyContext: attach on ptyId change, detach on unmount, resize, acknowledge. Reopen choreography ported from SessionContext but per-task rather than through a singleton terminalRef — beginRestore, scrollback fetch to paintSnapshot, POST resume, and the resuming / could-not-resume overlays. Much of v1's complexity (resetAttached, detaching the previous PTY, currentPtyId) does not survive the port: in v2 each terminal owns its own PTY, so repointing one never happens.

S1b. TabArea must keep terminal tabs mounted. It renders only the active tab of a group, so switching to a diff tab today would unmount the terminal, drop the attachment and force a full restore on every switch. Terminal-kind tabs render alongside the active pane, hidden when inactive — which is what v1 did, and what Terminal.tsx's fit-only-when-visible logic already expects.

S2. TASK-26 Explorer: the four sections over the existing trees, opening tabs through openTab (preview on single click, pinned on double).

S3. TASK-25 sidebar: recency, filter, state dots, suspended rows, archived toggle, close/rename, project creation ported off ProjectDialog. Includes the TaskManager.loadProjects/taskIds fix its notes describe.

S4. TASK-21 proper: extract shell.tsx's host into a component shared by both routes; routes/index.tsx renders it with no task, routes/t.$slug.tsx with one plus ?tab= (ensure + focus, replace-navigate to clear the param). slug.ts becomes buildTaskSlug/parseTaskSlug over title+id. SymbolPopover takes an onGo callback instead of navigating. Delete sessions.$slug.*, shell.tsx, session-nav.ts.

S5/S6. TASK-24 composer at /, then TASK-28's deletions.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
S1 (agent terminal host) landed and verified in a browser.

Verification found two runtime bugs that no test could have caught — both need a real socket, a real PTY and a real xterm:

1. SessionContext was giving the v2 pane's attachment away. `attached` is fanned out to every socket subscriber, and the v1 adapter hands back any attachment for a task it is not showing. That was right while it was the only attacher; with AgentPane as a second one, and the adapter showing no task at /shell, it detached every PTY the agent tab attached to. Fixed by having it give back only what it took.

2. `Terminal.tsx`'s init effect — which constructs and disposes the xterm instance — had `onReady` in its dependency list, and AgentPane passed an inline arrow, so the grid was rebuilt on every render and the painted `restore` went to a disposed instance (three xterm instances on one page load). `onReady` now goes through a ref like every other callback in that file.

Also filed TASK-53: clientCount never provokes a broadcast, so the status bar's 'N viewing' is stale.

Note for whoever verifies next: `bun src/index.ts foreground` still runs with `hmr: true`, so a subagent editing frontend files while you drive the browser will remount the shell, reset the selection and unmount panes before their effects flush. Verify from a detached git worktree on its own port, or the observations are worthless.

S4 breakdown (the route collapse), after reading the call graph:

1. slug.ts -> buildTaskSlug/parseTaskSlug over title+id (id is still the last 36 chars, so an old link with a stale title prefix resolves). Unit test for AC#4.
2. layout-store gains descriptorFromKey(key) — the inverse of tabKey, splitting on the first colon so a path may contain one. It is what ?tab= needs to *ensure* a tab rather than only focus one. 'file' loses its line, which is tabKey's existing contract, not a new loss.
3. SymbolPopover stops navigating: an onGo(entry) prop replaces useNavigate/useParams. This is a live v2 bug, not only a cleanup — DiffFilePane and FilePane already render it, and its go-to-definition currently navigates to /sessions/$slug/file, i.e. straight out of the v2 shell. DiffView takes onOpenTab so TabPane can supply it.
4. shell.tsx's body becomes components/TaskShell.tsx: same markup, but taskId/onSelectTask arrive as props instead of useState, plus pendingTab/onTabEnsured so the ?tab= ensure runs where the layout lives while the URL stays the route's business.
5. routes/index.tsx renders TaskShell with no task and no redirect (v1's 'jump to the first live session' is deliberately not ported — it is the auto-resume hazard the old comment describes, and TASK-24 puts the composer here). routes/t.$slug.tsx parses the slug, validates search {tab?}, ensures+focuses then replace-navigates the param away, and replaces to / only once TaskContext is loaded and the id still matches nothing (so a deep link on a cold load does not bounce before the socket answers).
6. Deletions: routes/sessions.$slug.*, routes/shell.tsx, utils/session-nav.ts, App.tsx, AppSidebar.tsx, FileView.tsx, components/CommandPalette.tsx, components/TabSwitcher.tsx, components/git/GitView.tsx, hooks/use-sidebar-drag.ts (closes TASK-25 AC#6), hooks/use-terminal-preview.ts, and view-state-store's 'nav' slot, whose every reader is on that list.

Two regressions this knowingly creates, both already owned: no command palette and no tab switcher until TASK-35, and / is a placeholder until TASK-24.

Left for TASK-28 on purpose: SessionContext.tsx and its provider, TopBar.tsx, ProjectDialog.tsx and the PtyContext bridge. SessionContext's isDiff route test goes permanently false once the v1 routes are gone; harmless while nothing v1 renders, and TASK-28 removes the adapter whole.

S4 landed. Verified in Chrome against a live daemon on its own port and db (two real tasks, real PTYs):

- / renders the v2 shell with no task and no redirect; clicking a sidebar row navigates to /t/{slug}-{uuid} and mounts the agent terminal.
- ?tab=file%3Asrc%2Ffrontend%2Futils%2Fslug.ts opened and focused a new file tab; ?tab=agent focused the tab already open without adding a second; ?tab=diffAll opened Changes. Every one of them cleared the parameter from the URL by replace-navigating, as intended.
- A slug whose id matches nothing redirects to / — and, because the route draws TaskShell with no task while that lands, writes no layout for the dead id. Confirmed in localStorage: only the real task's keys are there. Without that guard the ensure effect would have run first (effects are child-first) and persisted a layout for a task that does not exist.
- Go-to-definition through the reworked SymbolPopover opens a file tab at the line and stays inside the shell. Deduped onto the already-open tab and moved the cursor (label became 'slug.ts :9'), which is tabKey ignoring 'line' doing its job.
- Switching between two tasks keeps each task's own tabs, scroll offsets and terminal; the header label falls back from the OSC title to the stored name once two tasks both report 'Claude Code', which is naming.ts's uniqueness rule.
- No console errors or warnings on the happy path.

Two things dropped rather than carried over as fixtures: TaskHeader's hardcoded path/branch/badge and the status bar's '+142 −38 · 4 files'. Neither is on the wire, and inventing them at / is worse than omitting them; the path and branch arrive with Phase 5's worktrees.

Also turned off FilterInput's ⌘K hint in AppShell. The v1 command palette owned that binding and went with the session routes, so the label was promising a shortcut nothing answers. TASK-35 can turn it back on when there is something behind it.

Left orphaned but compiling, for TASK-28 to sweep with the adapter: SessionContext.tsx and its provider, TopBar.tsx, ProjectDialog.tsx, types/tab.ts. SessionContext's isDiff test was route-typed and could not survive the deletion, so it is now a pinned true with a comment, and the v1 'switching diff → terminal acknowledges' effect is gone — AgentPane already acknowledges on mount and on focus, which is the same rule stated where the terminal is.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Five routes became two. / and /t/$slug both render components/TaskShell.tsx — shell.tsx's body with the selected task arriving as a prop instead of useState — and /t/$slug?tab=<tabKey> ensures that tab exists, focuses it and replace-navigates the parameter away. slug.ts is now buildTaskSlug/parseTaskSlug over title+id, with the id still the last 36 characters, so a link written before a rename resolves. layout-store gained descriptorFromKey, the inverse of tabKey, which is what lets ?tab= open a tab rather than only focus one. SymbolPopover stopped navigating and takes an onGo callback, fixing a live v2 bug: go-to-definition inside the tab area was routing to /sessions/$slug/file, out of the shell.

Deleted: routes/sessions.$slug.*, routes/shell.tsx, utils/session-nav.ts, App.tsx, AppSidebar.tsx, FileView.tsx, CommandPalette.tsx, TabSwitcher.tsx, GitView.tsx, use-sidebar-drag.ts (closing TASK-25 AC#6), use-terminal-preview.ts, and view-state-store's nav slot.

Verified by tsc --noEmit, 678 unit tests and 40 render tests, and by driving a live daemon in Chrome: deep links that open, deep links that focus, a ghost slug that redirects without persisting a layout, go-to-definition, and two tasks that keep separate tabs and terminals. No console errors.

Known regressions, both already owned: no command palette or tab switcher until TASK-35, and / is a placeholder until TASK-24.
<!-- SECTION:FINAL_SUMMARY:END -->
