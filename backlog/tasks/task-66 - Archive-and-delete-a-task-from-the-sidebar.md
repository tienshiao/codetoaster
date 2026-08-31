---
id: TASK-66
title: Archive and delete a task from the sidebar
status: Done
assignee:
  - '@claude'
created_date: '2026-08-31 23:16'
updated_date: '2026-08-31 23:54'
labels:
  - frontend
  - ui
  - tasks
milestone: m-5
dependencies:
  - TASK-31
documentation:
  - docs/v2-architecture.md
ordinal: 66000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-31 built every server-side door a task can leave by — `GET /api/tasks/:id/archive` (the preview), `POST /api/tasks/:id/archive`, `POST /api/tasks/:id/delete` — and deliberately shipped no UI. Nothing in the browser reaches any of them, so the only way a task leaves the list today is Close, which suspends it and keeps the row forever.

Two gaps, and they are the same gap seen from either end:

1. A task row's hover cluster (`TaskRowActions` in `components/TaskSidebar.tsx`) offers Rename and Close and nothing else. There is no archive, and no hard delete.
2. `listTasks` sends only live and suspended rows, so the "Show archived" toggle already in the sidebar header has, by construction, nothing to show — `task-list.ts` carries a comment saying exactly that and waiting for this task. Archiving from the UI without fixing this would make a task vanish with no way to see it again or delete it for good.

The confirmation is the point, not the button. §5.6 says archive is explicit and confirmed, and TASK-31 supplies `GET /api/tasks/:id/archive` precisely so the dialog can state what will be lost — dirty files, unpushed commits, whether the branch is merged — instead of hedging. Hard delete is the one irreversible operation and carries its own dialog and its `confirm: true`.

Archived rows must not ride every `tasks` snapshot: that payload is re-broadcast on every create, close and project change, and a year of archived tasks would be re-sent with each one. Fetch them when the toggle asks for them.

Not in scope: unarchive/restore — there is no server path back (`openTask` and the resume ladder both refuse an archived row), and inventing one is its own task. The command palette's archive entry is TASK-35.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A task row offers Archive next to rename and close
- [x] #2 The archive confirmation states the task's dirty file count, unpushed commit count and merged status, read from GET /api/tasks/:id/archive before anything is destroyed, and does not draw counts it could not establish
- [x] #3 The dialog says the branch is kept when it is neither merged nor pushed, and the result reports what the archive actually did with it
- [x] #4 Archived rows reach the client and are drawn only while 'Show archived' is on, so the toggle stops showing an empty list
- [x] #5 Archived rows are not carried in the tasks broadcast — turning the toggle on is what fetches them
- [x] #6 An archived row offers Delete for good, behind its own confirmation naming what is unrecoverable, and the request carries confirm: true
- [x] #7 An archived row cannot be opened or resumed from the sidebar
- [x] #8 A failed archive or delete surfaces the server's message rather than failing silently
- [x] #9 Tests cover the archived listing route, the selection of archived rows, and the row actions' dialogs
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. **Wire types, defined once.** `ArchivePreview`, `ArchiveOutcome` and `DeleteOutcome` are now serialized straight out of the routes, so they are wire shapes and move from `lib/tasks/manager.ts` into `lib/xtmux/types.ts` — which the frontend is allowed to import and `manager.ts` then imports back. `types.ts` type-imports `BranchStatus` from `lib/worktree/status` the same way it already type-imports `Lifecycle` from `lib/db`: erased at build, one definition, no duplicated six-field interface across the boundary. Add `ArchiveResponse` for the POST's `{ archived, ...outcome, task? }`.

2. **The archived listing.** `TaskManager.listArchivedTasks()` over `store.list({ lifecycle: 'archived' })`, and `GET /api/tasks?lifecycle=archived` on the existing route rather than `/api/tasks/archived` — a static segment beside `/:id` is a route-precedence question nobody should have to answer, and this reads as the same list at a different lifecycle. No `refreshCwd`: there are no live PTYs to ask. Anything else in `lifecycle=` is a 400, so a typo does not silently return the live list.

3. **Not in the broadcast.** `tasksSnapshot` is unchanged. Archived rows accumulate forever and that payload is re-sent on every create, close and project change; the toggle is what fetches them.

4. **`TaskContext`**: `archivedTasks` as its own array — deliberately *not* merged into `tasks`, because `taskById` is what `/t/$slug` uses to decide a slug is dead and bounce to `/`, and an archived task found there would render a shell for a task with no checkout. Add `loadArchivedTasks`, `archivePreviewFor`, `archiveTask`, `deleteTaskForGood`. Archiving refetches the archived list when it has ever been loaded, and deleting drops the row locally — the `tasks` broadcast cannot correct either, since it does not carry archived rows.

5. **The dialogs**, in `TaskRowActions` alongside rename and close. Archive opens the dialog and fetches the preview then; while it is in flight the confirm is disabled and the body says it is checking. A preview that fails leaves confirm enabled and says plainly that what would be lost could not be established — fail closed on the *claim*, not on the action, since refusing to archive because git was slow is the worse failure. Counts are drawn only when known and non-zero, the rule the row already follows. The result is toasted, including `branchKept`'s sentence.

6. **Archived rows.** `TaskRow` gains `archived`: the row dims, the trailing glyph is `Archive` and not `GitBranch` (the checkout is gone — a branch mark would name something that is not there), and the worktree facts line is suppressed for the same reason. No new `TaskState`: 'archived' is not a state of a running thing, and `suspended`/`exited` already share their fill so there is no spare grey to take. Its actions are Delete alone, and its `onClick` is absent — the server refuses to open one (`resumeTask`/`openTask` both guard on `lifecycle === 'archived'`), so the sidebar must not offer it.

7. **The sidebar**: `selectTasks` runs over `tasks` alone, or `[...tasks, ...archivedTasks]` when the toggle is on — appended, not merged by recency, so turning the toggle on does not reorder the live list under the pointer. The `archived` predicate in `task-list.ts` stays as the second guarantee, and its comment stops saying archived rows never arrive.

8. **Tests**: the archived route and its 400 in `api/tasks.test.ts`; the row's archive/delete dialogs and the disabled-while-checking state in `TaskSidebar.render.tsx`; the archived row's rendering in `TaskRow.render.tsx`. `bun run test` and `tsc --noEmit`.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What landed

**Server.** `TaskManager.listArchivedTasks()`, reachable as `GET /api/tasks?lifecycle=archived`. A parameter on the existing route rather than a `/api/tasks/archived` beside `/api/tasks/:id`, and an unrecognised value is a 400 — a caller that misspelled `archived` getting the *live* list back is the failure that takes longest to notice. `tasksSnapshot` is untouched: archived rows only accumulate and that payload is re-sent on every create and close.

**Wire types.** `ArchiveOutcome`, `ArchivePreview` and `DeleteOutcome` moved from `lib/tasks/manager.ts` to `lib/xtmux/types.ts`. They are serialized straight out of the routes and now read by the sidebar, which makes them contract; the alternative was a second copy of `BranchStatus` on the frontend's side of the boundary. `types.ts` type-imports `BranchStatus` the way it already type-imports `Lifecycle` from `lib/db`.

`ArchivePreview` gained `wipRetentionDays`, computed from `WIP_RETENTION_MS`. The dialog's promise is that this is recoverable *for a while*, and a client printing its own idea of how long would go on printing it after the server's retention changed.

**Client.** `archivedTasks` is a second array in `TaskContext`, deliberately not folded into `tasks`: `taskById` is what `/t/$slug` uses to decide a slug is dead and bounce to `/`, so an archived task found there would keep the shell mounted on a task with no checkout and nothing to resume. Archiving refetches the archived list when anything has ever asked for it, and deleting drops the row locally — no broadcast covers that list. Success is silent except when `branchKept` is set, which is the one thing left on the user's disk that they would not otherwise hear about.

`archive-summary.ts` is the dialog's sentences as a pure function, tested against inputs. It draws no zeros, keeps `dirty: null` (the checkout is not on disk) apart from `dirty: 0`, and always speaks to the branch when there is one.

**Two defects found in the browser, not in the tests.**

1. `taskStateOf` fell through to `agent_state` for an archived row, and nothing clears that column — a task archived mid-turn pulsed "busy" in the archived list for a process that had been dead a month. Archived now reads `exited`, above the existing `suspended` rule.
2. A `task` delta re-inserted an archived row into the live list. Archiving emits deltas from the suspend, the eviction and the dying PTY's exit callback, and any of them landing after the archive's snapshot put the row back — so the task showed twice, once as an ordinary row and once as archived. The delta handler now *removes* on `lifecycle: archived` rather than upserting. This was latent before this task and unreachable, since nothing could archive from the UI.

Also: `cursor-pointer` on `TaskRow` is now conditional on there being an `onClick`, since an archived row has none.

## Not done, and not this task's

The sidebar's filter, grouping and archived toggle are `useState` in `useTaskSidebar`, and `/` and `/t/$slug` render `TaskShell` from different route components — so React remounts it on navigation and all three reset. Verified by hand: typing a filter and clicking a task clears the filter. Pre-existing, and it predates the archived toggle.

## Validation

`bun run test`: 918 unit + 118 render, 0 fail. `tsc --noEmit` clean.

Driven by hand against a real daemon on :4599 as well, since the interesting halves are a git-backed preview and a browser. A task with a worktree, 2 dirty files and 1 unpushed commit previewed `dirty 2, unpushed 1, merged false` and rendered as the three sentences the dialog shows; archiving it removed the checkout, kept the branch with the sentence saying why, and moved the row to the archived list; deleting it dropped the WIP ref and the row and reported the branch it declined to take. In Chrome: the dialog, the disabled confirm while the preview is in flight, the archived row's single delete, and archiving the task that is currently open bouncing the route back to `/`.

## Review pass (/code-review --fix)

Three defects, all in the confirmation's *truthfulness*, which is the part of this that matters:

1. `labels` was projected over the live list only, and `selectTasks` filters against that map — falling back to the task **id** when it holds nothing. So an archived row was searchable only by its UUID: type the name of the task you just archived and it vanishes from the list you turned the toggle on to find it in. The display label was fine (`rows` falls back to `task.title`), which is what made it easy to miss. Archived stored titles are now merged in *after* `sessionDisplayNames` runs, so the uniqueness projection over live terminal titles is untouched — which was the reason the map was live-only.

2. `dirty === null` said "Its checkout is already gone from disk." But `dirtyCount` folds two cases into that null on purpose: the checkout is not on disk, **and** git failed on one that is (half-removed worktree, dead mount, index.lock). The second case had the dialog asserting the checkout was gone while a dirty tree sat there — `status.ts`'s fail-closed rule run backwards, in the one dialog whose whole job is to be true about uncommitted work. The sentence now names both meanings and promises only what `doArchive` actually does.

3. `status.exists === false` fell through to "will be kept, since deleting it would take that work with it" — because `branchWouldBeDeleted` is false when there is no branch to delete. That invents unpushed work on a ref nobody found. It gets its own sentence now. Reachable for an evicted task whose branch was deleted by hand or by a merged-PR cleanup.

Known and left: a second browser with the toggle on loses an archived row from both lists until the toggle is cycled, since no archived row is ever pushed. `archiveTask`'s comment owns it.

Re-validated: `tsc --noEmit` clean, 919 unit + 118 render, 0 fail.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Archive and hard-delete reach the UI. A task row now carries an Archive control whose confirmation states what will be lost — dirty files, unpushed commits, what happens to the branch, how long the snapshot is kept — read from GET /api/tasks/:id/archive when the dialog opens, with the confirm disabled until it has something to say. Archived rows reach the client through a new GET /api/tasks?lifecycle=archived, fetched when the sidebar's archived toggle goes on rather than carried in the broadcast, and each offers Delete for good behind its own confirmation. Two defects the tests could not have caught turned up in the browser and are fixed: an archived row drew the agent state frozen at archive time, and a late task delta put an archived row back into the live list. 918 unit + 118 render tests pass, tsc clean, and the whole flow was driven by hand against a real daemon and in Chrome.
<!-- SECTION:FINAL_SUMMARY:END -->
