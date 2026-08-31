---
id: TASK-29
title: >-
  lib/worktree: create per-task git worktrees (id-derived path, per-repo lock,
  setup hooks)
status: Done
assignee: []
created_date: '2026-08-29 00:03'
updated_date: '2026-08-31 02:11'
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
- [x] #1 create(project, task, baseRef) returns { worktreePath, branch }; the directory is a valid checkout of baseRef at ~/.codetoaster/worktrees/<project-id>/<task-id>
- [x] #2 Renaming a task does not change its worktree path
- [x] #3 A branch-name collision yields a suffixed branch rather than an error, and concurrent creates in one repo serialize (test with N parallel creates)
- [x] #4 Failures (bad base ref, occupied path, setup non-zero exit) surface as typed errors with stderr
- [x] #5 Tests run against a temporary repository
- [x] #6 setup_command runs after creation with its output visible in the agent tab, and worktree_copy files are copied (recording setup_duration_ms on the row moved to TASK-30 with the rest of the createTask wiring)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. `api/utils.ts`: give `gitSpawn` an opt-in `stderr` capture. It pipes stderr to /dev/null today, and AC #5 needs it in the typed error. Opt-in so no existing caller changes behaviour.

2. `lib/worktree/paths.ts`: `worktreePathFor(projectId, taskId)` = ~/.codetoaster/worktrees/<project-id>/<task-id>, and `setupStampPath(taskId)` under the existing `taskDir`. Ids only, never slugs — Claude Code keys transcripts on the escaped cwd, so a path that moved on rename would take --resume and the --continue fallback with it, and evict/restore must land on the same path for the same reason (AC #2).

3. `lib/worktree/branch.ts`: `codetoaster/<slugified-title>` with -2, -3 suffixing. The title, not the URL slug — the URL slug carries the uuid, which never collides and would make the suffixing in §5.6 meaningless, and the branch is the artifact that outlives the task. Truncated to a valid ref component; a title that slugifies to nothing falls back to the task id.

4. `lib/worktree/lock.ts`: `withRepoLock(repoRoot, fn)`, mirroring the per-key chaining in `tasks/snapshot.ts` but carrying a result. Covers read-refs → pick-name → `worktree add` as one critical section: `git worktree add` takes repo locks, and two creates that both read the ref list pick the same suffix and one fails (AC #3).

5. `lib/worktree/create.ts`: `createWorktree(project, task, baseRef)` → { worktreePath, branch }. Verifies the base ref, refuses an occupied path, runs `git worktree add <path> -b <branch> <base>` through `gitSpawn`, then copies `worktree_copy` entries from the project checkout (newline-separated, contained by `safePath`, missing sources skipped). Throws `WorktreeError` carrying a `kind` and git's stderr (AC #5).

6. `lib/worktree/setup.ts`: `wrapWithSetup(argv, setupCommand, stampPath)` → `sh -c '<script>' sh <setup> <stamp> <argv…>`. Setup and stamp travel as positional args so the user's command needs no escaping, and the agent argv survives `exec "$@"` intact — which is what keeps the prompt in argv (§5.6). The script records setup's exit code in the stamp file and exits non-zero on failure, so a failed setup shows in the agent tab and never execs the agent. `readSetupOutcome(stampPath, spawnedAt)` → { exitCode, durationMs } from the file's contents and mtime; ms precision is not needed because the only consumer is the eviction grace scale (§5.6), and `date +%s%N` is not portable to BSD date.

7. Tests in `lib/worktree/*.test.ts` against temporary repositories built per-test (AC #6), including N parallel creates asserting distinct suffixed branches and no failures.

Library only: `TaskManager.createTask` wiring, the composer toggle and base-ref plumbing are TASK-30.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
New `src/lib/worktree/`: `paths.ts`, `branch.ts`, `lock.ts`, `create.ts`, `setup.ts`, `errors.ts`, `index.ts`, with 29 tests across four files against temporary repositories built per test.

Decisions worth carrying forward:

**Branch names come from the title, not the URL slug.** They look alike and are not — the URL slug ends in the task's uuid, which would make every branch unique by construction and leave §5.6's collision suffixing guarding a case that cannot happen. A branch outlives its task (archive keeps it), so it is addressed to whoever reads `git branch` a month later. `codetoaster/fix-the-parser`, then `-2`, `-3`. A title that slugifies to nothing falls back to the task id: unreadable, but valid, unique, and better than refusing to make a worktree because of what someone called their task.

**The lock's critical section is read-then-write, not just the git call.** `git worktree add` would fail one of two racing creates rather than corrupt anything; the race that actually bites is the branch *list* — two creates that both list before either writes pick the same suffix. So `allocateBranch` is inside the lock with the add. The copy is inside it too, for a different reason: undoing a partial create means `git worktree remove`, which mutates the same worktree list.

**setup_duration_ms is a file mtime, not a shell clock.** There is no portable way to read a millisecond clock from POSIX sh — `date +%s%N` is a GNU extension and prints a literal `N` on the BSD date macOS ships. The wrapper writes setup's exit code to a stamp file and `readSetupOutcome` takes the duration from `mtime - spawnedAt`. Precision does not matter: the only consumer is §5.6's eviction grace scale.

**Setup runs in the agent's own shell, not a subshell.** That is what `<setup> && exec "$@"` means in §5.6, and the useful half of it is that a setup command can export environment (a virtualenv, a version manager) that the agent inherits. The price, found while testing: `exit` inside a setup line is a real exit and takes the wrapper with it before the stamp is written. That reads correctly downstream — the code reaches the tab, the agent does not start, and `readSetupOutcome` answering "nothing recorded" is true, because setup aborted rather than finished. Pinned by a test.

**`gitSpawn` grew an opt-in `captureStderr`.** It piped stderr to /dev/null, and AC #5 needs git's own account of a failure — "could not create worktree" without "fatal: invalid reference: nosuchref" is a message the user can do nothing with. Opt-in so no existing caller changes behaviour, and both pipes are drained in the same `Promise.all` as `exited`, since a child whose stderr fills the pipe buffer would otherwise hang on exactly the verbose failure the option exists to report.

AC #4's `setup_duration_ms` clause moved to TASK-30 with the rest of the createTask wiring, per the library-only scoping: the mechanism is built and tested here, but nothing writes a row because nothing calls the library yet.

Validation: `bun run test` — 767 unit tests and 79 render tests pass, 0 fail (29 of them new). `bunx tsc --noEmit` clean on the touched files.

Correction to the validation line above: `bunx tsc --noEmit` is clean across the whole project, not merely on the touched files. There are no pre-existing type errors; the ones attributed to AppShell/DiffLayout/GitView/commands.ts were transient language-server diagnostics.

Code review (`/code-review --fix`) found five real defects in this module and fixed them. All five verified by reverting each fix and confirming the new test fails:

- **`branch.ts`: `%(refname:short)` is ambiguous.** "Short" means "as short as is unambiguous", so a repository that also holds a *tag* of a branch's name gets `heads/codetoaster/x` back for the branch. Confirmed directly against git. The taken-names set then missed the very name being tested and `allocateBranch` handed back a branch that already existed. Now `%(refname)` with the prefix stripped in JS.
- **`setup.ts`: the stamp was never cleared.** It lives outside the checkout, so a resume or restore of the same task found the previous run's file already there — and a caller asking "has setup finished, did it fail?" during a long reinstall got last time's exit code, including a stale failure. The wrapper now `rm -f`s it before setup runs, which is what makes `readSetupOutcome`'s "undefined until it finishes" true.
- **`create.ts`: the lock was keyed on the wrong thing.** `--show-toplevel` names a *worktree*, not a repository, so a project whose directory is itself a linked worktree took a different lock from one pointing at the main checkout of the same repo — while sharing `.git/worktrees` and the ref store. Exactly the read-then-write interleave the lock exists to prevent. Now keyed on `--git-common-dir`, resolved against the toplevel because git answers it relatively from the main worktree and absolutely from a linked one.
- **`create.ts`: a registered path whose directory is gone was unrecoverable.** That is what §5.6 eviction and a user's `rm -rf` both leave, and plain `worktree add` refuses it — permanently, since the path is fixed by the task id. `--force` on the add relaxes that one case; `assertPathFree` still refuses a non-empty directory and `-b` still fails on an existing branch.
- **`create.ts`: the rollback was fire-and-forget.** "A create produces a set-up worktree or none" is a promise, and an unchecked `worktree remove` breaks it twice: the half-copied checkout stays, `branch -D` then fails because the branch is still checked out in it, and the name is burned so the next create for that title gets an unearned `-2`. Now checked, with `fsp.rm` + `worktree prune` as the fallback.

Four new tests pin the first four (`create.test.ts`, `setup.test.ts`). The rollback path is not pinned — forcing `worktree remove --force` to fail needs a filesystem fault the test harness cannot arrange.

Validation after the fixes: `bun run test` — 771 unit and 79 render tests pass, 0 fail. `bunx tsc --noEmit` clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added `src/lib/worktree/` — `createWorktree(project, task, baseRef)` making an id-derived checkout at ~/.codetoaster/worktrees/<project-id>/<task-id> on a `codetoaster/<title-slug>` branch with collision suffixing, all under a per-repo_root lock whose critical section covers the branch *list* as well as the add, since that read is where parallel creates actually race. Copies `worktree_copy` entries from the project checkout, contained by `safePath`, and backs the whole create out if one fails. Failures throw `WorktreeError` with a kind and git's stderr, which needed a new opt-in `captureStderr` on `gitSpawn`. `wrapWithSetup` runs the project's setup_command around the agent per §5.6 so its output lands in the agent tab, passing the setup string and the agent argv as separate positional arguments so neither needs escaping and the prompt still travels in argv through `exec "$@"`; `readSetupOutcome` reads the exit code and duration back off a stamp file, mtime-based because POSIX sh has no portable millisecond clock. Library only — createTask wiring is TASK-30, which also picked up AC #4's setup_duration_ms row write. Verified with `bun run test`: 767 + 79 pass, 0 fail, including six parallel creates in one repository each getting their own branch.
<!-- SECTION:FINAL_SUMMARY:END -->
