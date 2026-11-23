---
type: Module
title: Task list order and the reorder lockout
description: The sidebar's task list is sorted by rankAt, which moves only when a task wakes after a quiet gap; when the drawn order still changes (a rank move, a task added or leaving), the rows that moved flash and the list ignores clicks for 500ms so a row that slid under the pointer cannot be opened or archived by mistake.
tags: [module, frontend, sidebar, tasks, v2]
level: project
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-23T02:00:00Z }
sources:
  - id: task-list
    resource: ../../src/frontend/task-list.ts
    title: src/frontend/task-list.ts
  - id: reorder-guard
    resource: ../../src/frontend/reorder-guard.ts
    title: src/frontend/reorder-guard.ts
  - id: sidebar
    resource: ../../src/frontend/components/TaskSidebar.tsx
    title: src/frontend/components/TaskSidebar.tsx
  - id: app-shell
    resource: ../../src/frontend/components/v2/AppShell.tsx
    title: src/frontend/components/v2/AppShell.tsx
  - id: task-116
    resource: "../../backlog/tasks/task-116 - Task-list-rows-shuffle-while-several-tasks-are-active.md"
    title: "TASK-116 — Task list rows shuffle while several tasks are active"
  - id: task-146
    resource: "../../backlog/tasks/task-146 - Task-list-reorders-are-visible-and-briefly-lock-out-clicks.md"
    title: "TASK-146 — Task list reorders are visible and briefly lock out clicks"
---

# Order

The list is the server's `rank_at DESC`. `rankAt` is not the age shown on the row (`lastActiveAt`, which moves on every burst of output); it moves only when a task wakes after a real quiet gap, so two busy tasks do not race each other for the top. Between snapshots `byRecency` re-applies the order to the list a delta disturbed. It is stable, and it returns the same array when nothing is out of order, so a delta about one task's state redraws that row and moves nothing.[^task-116] [^task-list]

# Reorders still happen

Hysteresis makes reorders rare, not impossible. A task that wakes moves up, a new task arrives at the top, and an archived or suspended one leaves. Each of these puts a different row under a pointer that may already be on its way down, and a click aimed at one task opens or archives its neighbour (TASK-146). So a reorder does two things: the rows that moved flash, and the list ignores clicks for `REORDER_LOCK_MS` (500ms), counted from the latest reorder.[^task-146] [^reorder-guard]

**What counts** is a change in the sequence of rows the list draws, compared with the sequence it drew last. In the flat list that is the row ids. Grouped, it is each project header followed by its rows when the group is open. The comparison catches all three ways a row ends up under the pointer:

- a row moving, either a rank change or one project group overtaking another;
- a row inserted above it, which pushes it down;
- a row removed above it, which pulls it up. Removal is the case the user reported, and the rows' relative order does not change, so a detector that only looked for moves would miss it.

**What does not count:**

- Anything redrawn in place, such as the age column, the state dot, the preview line or the selection. None of them is in the sequence.
- The first non-empty sequence (the snapshot on load, when nothing was under the pointer), and a remount, which starts a fresh baseline.
- Changes the user makes to the view: the filter, the grouping toggle, a group's chevron, the archived toggle, and the archived rows that toggle fetches a moment later. Locking after a filter keystroke would block the click the filter was typed for. A view change is only taken as the cause when the live task list did not change in the same render. If both changed, it counts, because a spurious half-second lock costs less than a missed one.[^sidebar]

The comparison runs during render rather than in an effect, so the frame that commits the moved rows is already locked.

# The cue

Inserted rows flash, and so do rows that fell outside the longest run of rows that kept their relative order (the complement of a longest increasing subsequence). One task jumping to the top therefore lights that task and not every row it passed. A removal lights nothing, because no row is left to light, and the dimmed list is its only cue. The flash is the change flash from [the change watcher](/modules/change-watcher.md): the `--changed` wash, the same two alternating keyframes, and a per-row count so a row that moves again mid-fade restarts it instead of stacking a second one. Cues are removed by a timer when the flash has run, so a row mounted later (a group reopened, the sidebar shown again) does not replay it. Under reduced motion the wash holds and drops in one step, and the lockout is unchanged.[^reorder-guard]

# The lockout

`AppShell` takes `taskListLocked` and enforces it. The list container drops every click at the capture phase, so rows, row actions and group headers all ignore it, including keyboard activation, since Enter and Space on a button arrive as clicks. It sets `aria-busy`, dims, and shows a not-allowed cursor while locked. Only clicks whose DOM target is inside the container are refused. React routes a portaled dialog's events through the row that owns it, and the archive confirmation does not move when the list does, so its buttons keep working.[^app-shell]

[^task-list]: src/frontend/task-list.ts
[^reorder-guard]: src/frontend/reorder-guard.ts
[^sidebar]: src/frontend/components/TaskSidebar.tsx
[^app-shell]: src/frontend/components/v2/AppShell.tsx
[^task-116]: TASK-116 — Task list rows shuffle while several tasks are active
[^task-146]: TASK-146 — Task list reorders are visible and briefly lock out clicks
