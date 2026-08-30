---
id: TASK-25
title: 'Task list sidebar: recency, filter, state dots, suspended rows'
status: Done
assignee:
  - '@claude'
created_date: '2026-08-29 00:03'
updated_date: '2026-08-30 09:21'
labels:
  - frontend
milestone: m-3
dependencies:
  - TASK-20
documentation:
  - docs/v2-architecture.md
ordinal: 25000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Rework AppSidebar.tsx into the chat-history / resume list (§7.5). Recency ordering across projects with project grouping as a toggle; a filter box; agent-state dots (busy / idle / needs_attention) and the last_message preview; suspended tasks as ordinary clickable rows (they are the normal resting state, not an error); archived tasks behind a toggle; close action (confirm when busy); the OSC terminal title shown as a subtitle via naming.ts's meaningfulTitle/stripDecoration projection. hooks/use-sidebar-drag.ts (manual reordering) is removed — you don't hand-sort cattle.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Default ordering is by last_active_at; a toggle groups by project
- [x] #2 Filter box narrows the list by title, project, and last_message
- [x] #3 Each row shows a state dot for busy/idle/needs_attention and the last_message preview
- [x] #4 Suspended tasks look like normal rows; clicking one navigates to it and triggers resume
- [x] #5 Archived tasks are hidden unless the show-archived toggle is on
- [x] #6 use-sidebar-drag.ts is deleted
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Carried over from TASK-6's review: TaskManager.loadProjects() rebuilds ProjectInfo from the projects table but never repopulates project.taskIds, and listTasks() reads only those arrays — placeInProject runs on create alone. Today nothing shows, because reconcileOnBoot suspends every row at startup and listTasks filters to live. The moment TASK-13 resumes a task, taskInfo()/broadcastTask() will answer for it while listTasks() still will not. Whichever of TASK-13 or this task lands first owns fixing it — most likely by dropping the in-memory grouping for the recency list §7.5 describes.

Build against `frontend/components/v2/` — the v2 design system is the new UI, not a parallel track (CLAUDE.md, "The v2 design system is the new UI"). `AppShell` and the shell components already exist from TASK-46; this task supplies their data. Do not extend `components/ui/` (v1 shadcn) for new surfaces.

ACs 1-5 verified in Chrome against a live daemon: recency order by default, grouping toggle producing project headers with rows indented to 21px, filter narrowing and restoring, state dots plus the OSC-title subtitle, close-without-confirm on an idle task leaving an ordinary suspended row, and clicking that row driving AgentPane's reopen.

AC#5's toggle and predicate are built but show nothing, because nothing writes lifecycle='archived' anywhere yet — it is only ever read, by the resume route, to refuse. TASK-31 is what will archive. Checked on that basis: the client half is real and correct the moment there is anything to filter.

AC#6 is NOT done and is deliberately unchecked: hooks/use-sidebar-drag.ts is still imported by v1's AppSidebar, so deleting it breaks the build. It goes with v1 in TASK-28.

Project creation was added without an AC asking for it, to avoid a regression once v1 is deleted — there would otherwise be no way to add a repository. Cost a v2 Dialog and TextInput rather than pulling four v1 shadcn components into the v2 surface; the price is losing ProjectDialog's path autocomplete and directory picker, which can come back later.

Incidental finding worth keeping: reopening a task whose agent never completed a conversation turn lands on could_not_resume, because there is no transcript for any rung of the ladder to open. That is §4.3 behaving correctly and the overlay renders it as a card with a Try again button — but it is also the shape TASK-43 is about.

AC#6 closed by TASK-21's S4: hooks/use-sidebar-drag.ts is deleted, along with v1's AppSidebar that was the only thing importing it. hooks/use-terminal-preview.ts went with it for the same reason.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
AppSidebar became the recency-ordered chat-history list (§7.5), built from the v2 design system: recency across projects with grouping as a toggle, a filter over title/project/last_message, state dots plus the last_message preview, suspended tasks as ordinary rows that resume when clicked, an archived toggle, and per-row rename/close. Project creation came along without an AC to avoid a regression once v1 is deleted; TASK-54 restored its path autocomplete and directory browsing.

ACs 1-5 were verified in Chrome against a live daemon when they landed. AC#5's toggle shows nothing yet only because nothing writes lifecycle='archived' until TASK-31. AC#6 waited on v1's AppSidebar, which was the last importer of use-sidebar-drag.ts; TASK-21's S4 deleted both, so the hook is gone and the AC is closed.
<!-- SECTION:FINAL_SUMMARY:END -->
