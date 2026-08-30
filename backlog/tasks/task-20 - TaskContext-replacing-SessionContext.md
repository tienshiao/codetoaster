---
id: TASK-20
title: TaskContext replacing SessionContext
status: Done
assignee: []
created_date: '2026-08-29 00:02'
updated_date: '2026-08-30 01:46'
labels:
  - frontend
  - tasks
milestone: m-3
dependencies:
  - TASK-7
  - TASK-5
documentation:
  - docs/v2-architecture.md
ordinal: 20000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TaskContext (§7.4): the task list, projects, per-task agent state and notifications, fed by the socket's tasks/task/activity/notification messages and mutated over HTTP.

Additive. TaskContext is added alongside SessionContext rather than replacing it, the same way PtyContext was in TASK-19 — the branch stays runnable while the rest of the shell is built, and 21/24/25 get to consume a real task store without waiting on the v1 deletion.

Deleting SessionContext.tsx and its 19 consumers is TASK-28's AC #2 and stays there. It was duplicated here as an AC, which made this task look like the v1 removal and put it in conflict with TASK-28 — everything from App.tsx and AppSidebar to the sessions.$slug.* routes reads SessionContext, so honouring it here would leave the branch with no working UI until 24/25/26/28 had all landed.

Read the socket's shapes from src/lib/xtmux/types.ts (TaskInfo, ProjectInfo, ServerMessage) and subscribe through PtyContext, which owns the connection — do not open a second WebSocket.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Task list reflects tasks snapshot on connect and task deltas thereafter
- [x] #2 create/rename/close/resume go through the HTTP routes and surface errors to the UI
- [x] #3 agent_state, last_message, lifecycle are available per task for the sidebar
- [x] #4 TaskContext consumes the socket through PtyContext.subscribe rather than opening its own connection
- [x] #5 SessionContext keeps working unchanged alongside it, and bun run dev boots with no console errors
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Extend the wire shape: TaskInfo gains `lastMessage` (the Stop hook's text, already on the row as `last_message`). AC #3 asks for it and the socket does not carry it today — two lines in types.ts and the taskInfo builder.
2. `frontend/TaskContext.tsx`: tasks, projects, per-task activity and loaded state, fed by subscribing through `PtyContext` — one socket, not a second connection (AC #4).
3. Mutations over HTTP, returning a result rather than throwing: create (POST /api/tasks), rename (PATCH /api/tasks/:id), close (POST /:id/close), resume (POST /:id/resume). Failures are toasted here, the way v1 does, and also returned so a caller can do more (AC #2).
4. Deliberately NOT duplicated while SessionContext is still live: the notification sound, the web Notification, and the acknowledge send. Two subscribers both reacting would play the sound twice and double-acknowledge — so TaskContext is a store plus HTTP, and the side effects move across at TASK-28.
5. Mount above SessionProvider in __root, inside PtyProvider. Verify both contexts coexist: v1 boots, the list still works, no console errors, no doubled notifications.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Build against `frontend/components/v2/` — the v2 design system is the new UI, not a parallel track (CLAUDE.md, "The v2 design system is the new UI"). `AppShell` and the shell components already exist from TASK-46; this task supplies their data. Do not extend `components/ui/` (v1 shadcn) for new surfaces.

Done, additive. `frontend/TaskContext.tsx` sits inside PtyProvider and beside SessionProvider; both subscribe to the one socket.

**A gap this turned up.** The server sends the task snapshot only in answer to `list`, and v1 asked from `handleTerminalReady` — so the list arrived because a *terminal* had mounted. A route with no terminal never got one, which is why `/shell` came up empty the first time. Asking is the store's own business now: TaskContext sends `list` on connect, and again on mount if the socket is already open, since `onConnect` only fires on a transition.

**Wire change.** `TaskInfo` gained `lastMessage`. AC #3 asks for it for the sidebar and the socket did not carry it, though the row has had `last_message` since TASK-11.

**Kept out on purpose.** No notification sound, no web Notification, no `acknowledge`. Two subscribers both reacting would fire each twice — the user would hear the sound doubled. Those stay in SessionContext and move across at TASK-28. TaskContext is a store plus HTTP and nothing else.

**`taskStateOf`** maps the server's eight agent states onto the design's five dots: `starting`/`compacting` read as working, `unknown` reads as idle rather than as a fault because that is usually what it is, and `could_not_resume` earns its own colour as the one state with an action attached. Lifecycle wins — a suspended task's agent state is whatever it was when the process was harvested, and showing that would make a resting task look busy.

**Demonstrated** by making the shell's left column live rather than by a unit test, since a store with no consumer proves nothing: real tasks in the design's rows, real state dots, real ages, the project count, and the endpoint. Clicking + created a fifth task over HTTP and the socket delta put it in the list. Killing the daemon and clicking + again produced 'Could not start the task / Failed to fetch' and flipped the endpoint label to 'connecting…', which is AC #2 and the `loaded` semantics together.

One correctness fix on the way: I first rendered `terminalTitle || title` and got three identical 'Claude Code' rows — exactly the failure `sessionDisplayNames` exists to prevent. The label is projected through naming.ts now and reads 'codetoaster · v2', '… 2', '… 3'.

Ordering, the filter behaviour, suspended rows and the archived toggle are deliberately not built here — that is TASK-25's sidebar, on this store.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Adds frontend/TaskContext.tsx: the task list, projects and per-task activity fed by the socket through PtyContext, with create/rename/close/resume over HTTP returning a result and toasting failures. Additive — it sits beside SessionContext, which keeps v1 running until TASK-28 deletes both adapters.

Also carries lastMessage on the wire (AC #3 needed it), and moves the 'ask for the list' responsibility off the terminal and onto the store, which is why a terminal-less route could never load one.

Verified by making the shell's left column live: real tasks, states, ages and counts; a create round-tripping over HTTP and back through the socket; and a failed create surfacing as a toast with the daemon down. 585 tests pass, tsc clean, no console errors, no doubled notifications.
<!-- SECTION:FINAL_SUMMARY:END -->
