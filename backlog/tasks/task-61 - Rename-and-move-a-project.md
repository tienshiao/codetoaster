---
id: TASK-61
title: Rename and move a project
status: Done
assignee: []
created_date: '2026-08-31 03:34'
updated_date: '2026-08-31 03:40'
labels:
  - frontend
milestone: m-5
dependencies:
  - TASK-30
ordinal: 61000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`updateProject` has always taken name and initialPath, and nothing has ever sent a changed one: v1's edit affordance did not survive the v2 shell, and TASK-30's `ProjectSettingsDialog` passes both through unchanged because it was built for what a project *decides*, not what it is. So a project's name and repository path are fixed at creation, and the only way to correct a typo is to delete the project — which moves every task in it to General — and make it again.

The surface already exists and is the right one: the same dialog, two fields above the defaults. The path needs the browse flow, which `NewProjectButton` already solves with the two-views-one-dialog swap (`Dialog` binds Escape to the document and renders fixed, so stacking two would dismiss both).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A project's name and repository path can be changed from the project settings dialog, and both persist
- [x] #2 The path field offers the same directory browser as the new-project dialog, in the same one-dialog-two-views arrangement
- [x] #3 Saving name, path and the defaults is one updateProject message, so a partial write cannot leave the two disagreeing
- [x] #4 A blank name is refused; the dialog cannot save one
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Name and Repository path go at the top of `ProjectSettingsDialog`, above the defaults, and Save sends all three through the one `updateProject` message that already took them.

Browsing swaps the dialog's body rather than opening a second one — the arrangement `NewProjectButton` established, and for the reason its comment gives: `Dialog` binds Escape to the document and renders `fixed z-50`, so two would dismiss together and stack by declaration order. Cancel and Escape while browsing mean 'back to the form', not 'abandon the edit'.

`hasRepo` now reads the path *field* rather than the project row, so pointing a project at a repository makes the three worktree settings usable in the same breath instead of needing a save and a reopen for the form to agree with itself.

Verified in a browser: renamed a project from 'Typo Nmae' to 'CodeToaster', went into the folder browser and back out with Cancel, saved, and watched the sidebar header change and the row persist with its path intact.

Two things found on the way:
- The dialog's render tests needed a `QueryClientProvider`. `PathField`'s autocomplete is a react-query hook, so the dialog no longer mounts without a client — even in the tests that never touch that field.
- **Worth knowing for TASK-31.** Moving a project to a different repository leaves its existing worktrees as checkouts of the *old* one, registered in the old repo's `.git/worktrees`. Their tasks keep working, since a task's cwd is its worktree. But `removeWorktree` resolves the repository from the project's *current* path, so archiving one of those would run `git -C <new repo> worktree remove <old path>` and fail. The fix is for archive to resolve the repository from the worktree itself rather than from the project — noted on TASK-31 rather than pre-empted here.

`bun run test`: 781 unit and 94 render tests pass, 0 fail. `bunx tsc --noEmit` clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added Name and Repository path to the project settings dialog, with the same directory browser the new-project dialog uses, swapped into the same dialog rather than stacked on top of it. Saving is one `updateProject` message carrying the name, the path and the defaults together, so a partial write cannot leave the row disagreeing with itself; a blank name disables Save. The worktree fields now key off the path field rather than the stored row, so a project gains them the moment a path is typed. Verified with `bun run test` (781 unit, 94 render, 0 fail) and by renaming and re-pathing a project in a browser.
<!-- SECTION:FINAL_SUMMARY:END -->
