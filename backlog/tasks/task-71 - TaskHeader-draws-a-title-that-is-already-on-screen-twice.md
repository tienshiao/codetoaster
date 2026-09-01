---
id: TASK-71
title: TaskHeader draws a title that is already on screen twice
status: Done
assignee:
  - '@claude'
created_date: '2026-09-01 00:07'
updated_date: '2026-09-01 00:44'
labels:
  - frontend
  - ui
  - polish
milestone: m-5
dependencies: []
ordinal: 71000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The 28px band under every tab strip renders one string: the task title. `TaskHeader` accepts `path`, `branch` and `badge` too, and `TaskShell` passes none of them — it carries a comment saying neither path nor branch is on the wire yet and that they arrive with Phase 5.

Phase 5 has since landed. `TaskInfo` carries `cwd` and `worktree.branch`, so the comment is stale and there are now two honest options rather than one.

What makes deleting it the likelier answer is the repetition. The title is already in the sidebar — on the selected row, highlighted — and in the document title. And the band is drawn *per group*: its own comment justifies that by analogy to VSCode repeating breadcrumbs per editor group, but a layout belongs to one task, so every group in a split shows the same string. Splitting the pane duplicates a title the sidebar was already showing.

The alternative is to finish it: path and branch are per task, not per group, which argues for the `StatusBar` at the foot of the shell — it already carries the task-level facts (state, grid size, viewers) and is drawn once. That is where the information belongs if it is worth showing at all.

Either way `AppShell` sheds `breadcrumb` / `ShellBreadcrumb` and `TabArea` sheds its `header` prop, and every pane gets 28px back.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The per-group title band is gone
- [x] #2 Anything worth keeping from it — the branch, the working directory — is in the StatusBar, which is drawn once per shell rather than once per group
- [x] #3 AppShell no longer takes a breadcrumb prop and TabArea no longer takes a header, with the types and exports removed rather than left unused
- [x] #4 A split shows no repeated per-group chrome that a single pane does not
- [x] #5 TaskShell no longer carries the stale comment about path and branch not being on the wire
- [x] #6 The working directory is shown alongside the branch, abbreviated so it is readable in a status bar, with the full path available on hover
- [x] #7 cwd travels on the socket snapshot the client renders from, not only on the GET /api/tasks response
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Delete `components/v2/TaskHeader.tsx` and its two exports from `v2/index.ts`.
2. `AppShell` sheds the `breadcrumb` prop and the `ShellBreadcrumb` alias; `TabArea` sheds `header`; `TaskShell` sheds the call site and the stale comment about path and branch not being on the wire.
3. Move the branch — and only the branch — to the `StatusBar`. `cwd` is *not* on `TaskInfo`: the `GET /api/tasks` route bolts it on per response and the socket snapshot never carries it, so a path in the status bar would be inventing one, which is exactly what the deleted comment warned against. `worktree.branch` is on the wire and is the fact worth keeping.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Deleted rather than finished, and the branch moved to the `StatusBar`.

The band drew one string — the task's title — which the sidebar's selected row and the document title were both already showing. Worse, it drew it *per group*: its own comment justified that by analogy to VSCode repeating breadcrumbs per editor group, but a layout belongs to one task, so splitting a pane duplicated a title that was already on screen twice. Every pane gets 28px back.

Its stale comment claimed neither path nor branch was on the wire. Half of that is now false — `worktree.branch` arrived with Phase 5 — and half is still true: `cwd` is bolted onto the `GET /api/tasks` response and never travels on the socket snapshot the client actually renders from, so a path in the status bar would be inventing one.

The branch leads the status items because it is the one fact there that says *where you are* rather than how big the grid is. The sidebar row shows it too, but the sidebar can be closed and the status bar cannot — which is what makes this a move rather than a third copy. Drawn only when there is one: a task in the project's own directory has no checkout of ours and a detached head has no branch, and neither is a blank worth a column.

## Validation

`tsc --noEmit` clean; `bun run test`: 919 unit + 119 render, 0 fail.

In Chrome at :4599, both cases: a worktree task reads `● idle  codetoaster/on-a-branch  91×45  1 viewing` with the tab strip sitting straight on the terminal, and a task without a checkout reads `● idle  91×45  1 viewing` — no empty column where the branch would have been.

## Reopened

The user overruled the judgement call above: the path is wanted too, not just the branch. My reason for leaving it out was that `cwd` never travels on the socket snapshot — that is a thing to fix, not a reason to drop the field.

Two problems to solve rather than one. `cwd` has to reach the client (it is on the row already, and `refreshCwd` already broadcasts a delta when it moves), and it has to be *readable*: `/Users/tma/.codetoaster/worktrees/ct/4b55ec75-3bd6-4dbd-a2e1-937affffb044` is not a status-bar string. Abbreviating needs the server's home directory, which the client has no way to know — `/api/directories` returns one, but that is a per-path query and the wrong shape for chrome that is always on screen. So the snapshot carries `home` once, as the per-server constant it is.

## The path, and when it is worth its width

The user's second steer: a path is only useful when it is not a generated worktree location. Verified in the browser before the change — a worktree task read `~/…/1bdb1b1f-6943-4aaa-9bed-566376a44d30`, forty characters spent on a UUID, next to a `codetoaster/in-a-worktree` that said the same thing better.

So the rule is a comparison rather than a flag. `worktreePath` joins `cwd` on the wire, and the path is drawn unless the two are equal. A task sitting in the checkout we made for it shows only its branch; a task in the project's own directory shows its path; and an agent that has cd'd *out* of its checkout gets its path back — which is the case §5.4 exists to notice and the one where a path is genuinely worth reading.

`utils/path-label.ts` is the display half: home to `~` first, then whole segments elided from the middle if it is still too long, keeping the *tail*, because a path answers "where am I" and the answer is in the last segment. Whole segments and never half a name — half a directory name is a name that does not exist, and a reader cannot tell it from a directory really called that. A single segment too long to fit comes back intact rather than cut. The full path is always in the item's `title`.

`home` rides the task snapshot as the per-server constant it is. `/api/directories` returns one too, but that is a per-path query and the wrong shape for chrome that is always on screen. Absent is not empty: an older daemon does not send it, and writing `""` over a home already held would un-abbreviate every path on screen — and an empty prefix that matched everything would turn every path into `~`-something, which `tildePath` refuses.

Also fixed while here: `StatusBar`'s items had no `min-w-0`, so a flex child's default `min-width: auto` meant one long value pushed the ones after it off the bar rather than losing its own characters.

One render test failed once during this work and passed on three consecutive re-runs with no change in between; the output had scrolled by the time I looked. Noting it rather than chasing it — if it recurs it is worth a ticket.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
TaskHeader is gone, along with AppShell's breadcrumb prop, ShellBreadcrumb and TabArea's header: it drew only the task title — already in the selected sidebar row and the document title — and drew it once per group, so splitting a pane repeated it. Every pane gains 28px.

What it was for moved to the StatusBar, which is drawn once per shell and survives the sidebar being closed. The branch, and the working directory — but the directory only when it is not the generated worktree path, because `~/.codetoaster/worktrees/<project>/<uuid>` says nothing the branch beside it does not say better. The rule is `cwd === worktreePath`, so it also puts the path back when an agent cd's out of its own checkout, which is the case §5.4 exists to notice. `cwd`, `worktreePath` and the daemon's `home` now travel on the socket snapshot rather than only on the GET response, and `utils/path-label.ts` abbreviates for display with the real path on hover.

Verified in the browser across all three shapes; 928 unit + 123 render tests pass, tsc clean.
<!-- SECTION:FINAL_SUMMARY:END -->
