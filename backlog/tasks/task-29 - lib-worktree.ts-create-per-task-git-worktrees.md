---
id: TASK-29
title: >-
  lib/worktree: create per-task git worktrees (id-derived path, per-repo lock,
  setup hooks)
status: To Do
assignee: []
created_date: '2026-08-29 00:03'
updated_date: '2026-08-29 00:17'
labels:
  - server
  - git
milestone: m-4
dependencies:
  - TASK-7
documentation:
  - docs/v2-architecture.md
ordinal: 29000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
§5.6: `git worktree add <path> -b <branch> <base_ref>` at ~/.codetoaster/worktrees/<project-id>/<task-id> — outside the repo, and derived from ids, NOT slugs: Claude Code keys transcripts on the escaped cwd, so a path that moved on rename would break --resume lookup and the --continue fallback; evict/restore must reuse the same path for the same reason. Branch naming codetoaster/<task-slug> with collision suffixing. Serialize all worktree-list-mutating git per repo_root (worktree add takes repo locks; parallel creates race on the suffix). After creation run the project's setup_command and copy worktree_copy files, with output rendered in the agent tab via `sh -c '<setup> && exec "$@"' sh claude …` so the prompt still travels through argv. Record setup_duration_ms on the row. Go through gitSpawn in api/utils.ts, never Bun.$.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 create(project, task, baseRef) returns { worktreePath, branch }; the directory is a valid checkout of baseRef at ~/.codetoaster/worktrees/<project-id>/<task-id>
- [ ] #2 Renaming a task does not change its worktree path
- [ ] #3 A branch-name collision yields a suffixed branch rather than an error, and concurrent creates in one repo serialize (test with N parallel creates)
- [ ] #4 setup_command runs after creation with its output visible in the agent tab; worktree_copy files are copied; setup_duration_ms is stored
- [ ] #5 Failures (bad base ref, occupied path, setup non-zero exit) surface as typed errors with stderr
- [ ] #6 Tests run against a temporary repository
<!-- AC:END -->
