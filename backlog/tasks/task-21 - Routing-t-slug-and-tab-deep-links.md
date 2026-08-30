---
id: TASK-21
title: 'Routing: /, /t/$slug, and ?tab= deep links'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-29 00:02'
updated_date: '2026-08-30 05:43'
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
- [ ] #1 Only /, /t/$slug, and the ?tab= variant exist in routeTree.gen.ts
- [ ] #2 A ?tab= link to a not-yet-open tab opens and focuses it; to an open tab just focuses it
- [ ] #3 utils/session-nav.ts is deleted
- [ ] #4 Task slugs derive from title and id; a rename changes only the slug prefix and old links still resolve
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
<!-- SECTION:NOTES:END -->
