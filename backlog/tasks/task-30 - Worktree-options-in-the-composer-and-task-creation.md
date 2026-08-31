---
id: TASK-30
title: Worktree options in the composer and task creation
status: To Do
assignee: []
created_date: '2026-08-29 00:03'
updated_date: '2026-08-31 02:11'
labels:
  - frontend
  - server
  - api
milestone: m-4
dependencies:
  - TASK-29
  - TASK-24
documentation:
  - docs/v2-architecture.md
ordinal: 30000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Composer options row gains the new-worktree toggle and base-ref picker (§7.5), defaulting from the project's worktree_default / default_base_ref. POST /api/tasks accepts { worktree: boolean, baseRef } and, when set, creates the worktree before spawning; the task row stores cwd == worktree_path, branch, base_ref. Worktrees are what make --continue unambiguous for resume (§4.3).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Composer shows a worktree toggle and base ref input, pre-filled from project defaults
- [ ] #2 POST /api/tasks with worktree=true creates the worktree first and spawns the agent inside it
- [ ] #3 cwd, worktree_path, branch, base_ref are stored on the task row
- [ ] #4 Worktree creation failure returns an error and leaves no task row or partial worktree behind
- [ ] #5 Project settings expose setup_command and worktree_copy alongside worktree_default and default_base_ref
- [ ] #6 createTask records setup_duration_ms on the row from the setup wrapper's stamp (readSetupOutcome), moved here from TASK-29 AC #4 when TASK-29 was scoped library-only
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TASK-29 landed `lib/worktree/*` as a standalone library: `createWorktree`, `wrapWithSetup`/`readSetupOutcome`, `withRepoLock`, `allocateBranch`, and the path helpers. Nothing calls them yet — this task is the wiring. Two pieces to pick up:
- `createTask` calls `createWorktree` when the task wants one, then wraps the agent argv with `wrapWithSetup(command, project.setup_command, setupStampPath(id))` before spawning, and writes worktree_path / branch / base_ref / worktree_state onto the row.
- `setup_duration_ms` comes from `readSetupOutcome(setupStampPath(id), spawnedAt)`, which needs a moment after the agent starts to read it — the first hook is the natural one, since the wrapper only execs the agent after setup exits zero.

Two latent decisions in `lib/worktree` that TASK-29 left open because nothing consumes them yet, and this task is where they get answered:

- `copyProjectFiles` is passed the **repo root**, not `project.initial_path`. They differ only when a project points at a subdirectory of its repository — and then a `worktree_copy` entry of `.env` is ambiguous: relative to where the user works, or to the repo the worktree is a checkout of? Copying `<repoRoot>/.env` to `<worktree>/.env` is right for the second reading and puts the file in the wrong directory for the first.
- `worktree_copy` entries are contained with `safePath` on the entry path, but `fsp.cp` preserves symlinks, so a symlinked entry inside the project could still resolve outside it. Only reachable by someone editing their own project settings, so it is a tidiness question rather than a boundary one — but worth deciding when the field gets a UI.
<!-- SECTION:NOTES:END -->
