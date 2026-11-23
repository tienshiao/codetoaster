---
id: TASK-148
title: Task confirmation dialogs set the task name apart from the prose
status: In Progress
assignee:
  - '@claude'
created_date: '2026-11-23T01:42:00Z'
updated_date: '2026-11-23T02:11:00Z'
labels:
  - frontend
dependencies: []
references:
  - src/frontend/components/TaskSidebar.tsx
  - src/frontend/components/UnarchiveTaskDialog.tsx
ordinal: 151000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The dialogs that confirm an action on a task (archive, suspend, delete for good, unarchive, all in TaskSidebar.tsx and UnarchiveTaskDialog.tsx, reached from the sidebar rows and the command palette) put the task name inside the description sentence as plain text, e.g. "<label> leaves the list, and ...". It has the same size, weight and colour as the words around it, so the user has to read the sentence to find which task is about to be acted on, and a wrong target, such as a row that moved under the pointer (TASK-146), is easy to confirm without noticing. The name is the one thing these dialogs need to make obvious at a glance.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every task-scoped confirmation (archive, suspend, delete for good, unarchive) shows the task name styled apart from the surrounding text so it reads at a glance, using v2 semantic tokens rather than colour literals
- [ ] #2 The name shown is the same display label the sidebar row shows for that task
- [ ] #3 A long name truncates or wraps without breaking the dialog layout, and the full name is still available (e.g. on hover)
- [ ] #4 The styling is shared by all four dialogs, so a new task-scoped confirmation gets it without restyling
- [ ] #5 Rendering tests check that each dialog renders the task name in its distinct element
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. v2 Dialog gains a 'subject' prop: the thing the confirmation acts on, rendered in its own element between title and description (data-dialog-subject, font-medium text-foreground on a bordered bg-chrome well, truncate with the full name in title=), and wired into aria-describedby. 2. Archive, Suspend, delete-for-good (TaskSidebar.tsx) and Unarchive (UnarchiveTaskDialog.tsx) pass label as subject and drop it from the description sentence; minimal diff in TaskSidebar.tsx. 3. Confirm label sources: sidebar rows and palette both project through sessionDisplayNames/taskDisplayNames; archived rows use the stored title in both. 4. Rendering tests: each of the four dialogs renders the name in the subject element, long name keeps full text in title; palette test pins that Suspend gets the projected display label. 5. Wiki: v2 design system page notes the subject slot; log entry. 6. bun run test + typecheck, notes, commit.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
v2 Dialog gained a subject?: string prop, drawn as its own element under the title (data-dialog-subject; font-medium text-foreground on a rounded-md border-border bg-chrome well; line-clamp-2 break-words; full name in title=) and wired with the description into aria-describedby via useId. Archive, Suspend, delete-for-good (TaskSidebar.tsx) and Unarchive (UnarchiveTaskDialog.tsx) pass label as subject; their sentences now say It / The task. Label sources checked: sidebar rows and the palette both project live tasks through sessionDisplayNames (taskDisplayNames), archived rows use the stored title in both; no change needed. Tests: TaskSidebar.render.tsx checks the subject in all four dialogs plus a long name keeping full text in title; Dialog.render.tsx covers the slot, its absence for empty, and aria-describedby; CommandPalette.render.tsx now drives taskDisplayNames from a hoisted map and pins that Suspend gets the projected label, and the palette Unarchive shows the stored title as subject. Wiki: conventions/v2-design-system.md section on the subject slot, log entry. /code-review medium --fix: two nits fixed (aria-describedby, wiki claim narrowed to task-scoped confirmations; the unclaimed-worktree delete still names its path in prose, a possible follow-up). bun run test: 2198 bun + 608 vitest pass; typecheck clean; isolated server on 4603 booted and served /. Browser check of the clamp and styling deferred to the main session.

Browser check found the padded line-clamp let the top of line three show through the bottom padding; split the subject into a padded outer box (data-dialog-subject, title, id) and an unpadded inner span carrying line-clamp-2 break-words, test updated to assert the clamp is on the inner element.

/code-review high v2: 5 findings. Fixed: subject span uses wrap-anywhere (break-words left the min-content width at the longest unbreakable word, widening the panel at phone width) and the wiki page's generated.at set to the real edit time. Skipped: label not frozen while open (pre-existing; the confirm acts on the task id, so a repainted title is the same task), empty subject leaving It with no referent (the API refuses blank titles), and ACs/final summary (left to the main session).
<!-- SECTION:NOTES:END -->
