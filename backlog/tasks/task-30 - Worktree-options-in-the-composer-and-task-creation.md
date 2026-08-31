---
id: TASK-30
title: Worktree options in the composer and task creation
status: Done
assignee: []
created_date: '2026-08-29 00:03'
updated_date: '2026-08-31 04:07'
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
- [x] #1 Composer shows a worktree toggle and base ref input, pre-filled from project defaults
- [x] #2 POST /api/tasks with worktree=true creates the worktree first and spawns the agent inside it
- [x] #3 cwd, worktree_path, branch, base_ref are stored on the task row
- [x] #4 Worktree creation failure returns an error and leaves no task row or partial worktree behind
- [x] #5 Project settings expose setup_command and worktree_copy alongside worktree_default and default_base_ref
- [x] #6 createTask records setup_duration_ms on the row from the setup wrapper's stamp (readSetupOutcome), moved here from TASK-29 AC #4 when TASK-29 was scoped library-only
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Server first, then the composer, then the settings surface.

**1. Project settings reach the client.** `ProjectInfo` gains `defaultBaseRef`, `setupCommand`, `worktreeCopy`, `worktreeDefault` beside the two model/mode fields already there; `loadProjects` projects them. `updateProject` over the socket becomes a patch — name and initialPath stay required, the six settings are optional — and `db.updateProject` learns the new columns. An empty string clears a setting back to NULL, since 'unset' has to stay expressible (that is what hands the choice back to Claude Code's own default).

**2. createTask makes the worktree.** `CreateTaskOptions` gains `worktree?: boolean` and `baseRef?: string`; absent `worktree` falls back to the project's `worktree_default`, absent `baseRef` to `default_base_ref` then HEAD — resolved server-side, so the API and the CLI get the same answer the composer does.

The ordering changes, and that is the substance of this step. Today: cwd → title → row → settings → spawn. The worktree needs the task's id and title to exist before it does (the branch is named from the title), and the row's cwd needs the worktree to exist before it does. So: resolve projectId → derive title → `createWorktree` → cwd = worktreePath → row. Creating before the row is also what AC #4 asks for: a create that throws leaves no row at all, and `createWorktree` already rolls its own partial state back.

Title derivation is the one circularity. `deriveTitle(cwd)` needs a directory, and the worktree does not exist yet — so it derives against the project's checkout, which is honest (it is the '<dir> · <branch>' label, and the composer path always has a prompt to beat it anyway).

**3. The agent runs behind setup.** When and only when this create made a worktree, the argv is wrapped with `wrapWithSetup(command, project.setup_command, setupStampPath(id))`. Not for `options.command` (shell tabs, tests), and not for a task running in the project's own checkout, which is already set up.

**4. setup_duration_ms on the first hook.** A `spawnedAt` map records when each agent was spawned (`created_at` is wrong on a restore, which runs setup again). `applyHook` fires a non-blocking `recordSetupOutcome` the first time `hookSeen` flips for a task with a worktree. The wrapper only execs the agent after setup exits zero, so the first hook is proof the stamp is on disk — one read, no polling.

**5. POST /api/tasks** accepts `{ worktree, baseRef }` and validates them.

**6. Composer** gains the worktree toggle and base-ref input, seeded from the project the same way model and mode already are — in the render that moves the selection, not an effect, or ⌘⏎ in the first frame sends the previous project's choices. Both are omitted from the wire when they match doing nothing, so 'no override' stays distinct from a value.

**7. Project settings surface**, new and composed from `components/v2` — not an extension of `SettingsDialog`, which is per-device preference, v1 shadcn, and something TASK-59 wants replaced rather than grown. Six fields: setup_command, worktree_copy, worktree_default, default_base_ref, and — per TASK-55, which asks for exactly this rather than a second surface — default_model and default_permission_mode.

Closes TASK-55.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TASK-29 landed `lib/worktree/*` as a standalone library: `createWorktree`, `wrapWithSetup`/`readSetupOutcome`, `withRepoLock`, `allocateBranch`, and the path helpers. Nothing calls them yet — this task is the wiring. Two pieces to pick up:
- `createTask` calls `createWorktree` when the task wants one, then wraps the agent argv with `wrapWithSetup(command, project.setup_command, setupStampPath(id))` before spawning, and writes worktree_path / branch / base_ref / worktree_state onto the row.
- `setup_duration_ms` comes from `readSetupOutcome(setupStampPath(id), spawnedAt)`, which needs a moment after the agent starts to read it — the first hook is the natural one, since the wrapper only execs the agent after setup exits zero.

Two latent decisions in `lib/worktree` that TASK-29 left open because nothing consumes them yet, and this task is where they get answered:

- `copyProjectFiles` is passed the **repo root**, not `project.initial_path`. They differ only when a project points at a subdirectory of its repository — and then a `worktree_copy` entry of `.env` is ambiguous: relative to where the user works, or to the repo the worktree is a checkout of? Copying `<repoRoot>/.env` to `<worktree>/.env` is right for the second reading and puts the file in the wrong directory for the first.
- `worktree_copy` entries are contained with `safePath` on the entry path, but `fsp.cp` preserves symlinks, so a symlinked entry inside the project could still resolve outside it. Only reachable by someone editing their own project settings, so it is a tidiness question rather than a boundary one — but worth deciding when the field gets a UI.

Server side done: `ProjectInfo` carries the six settings, `updateProject` takes them as a patch (blank normalizes to NULL so 'unset' stays expressible), `createTask` makes the worktree *before* the row and wraps the agent with `wrapWithSetup` only for a checkout it just made, and `setup_duration_ms` is read on the task's first hook. `POST /api/tasks` takes `{ worktree, baseRef }` — `worktree` tri-state, since reading a missing field as false would make every API and CLI create ignore a project configured to want worktrees.

The ordering in `createTask` is the substance: project resolution moved above cwd (the worktree path is keyed on the project id), and the worktree is made between the title and the row — the branch is named from the title, and the row's cwd is the worktree. Titles still derive against the project's checkout, since the worktree does not exist when the label is computed.

One trap found while wiring: `spawnAgent` clears `hookSeen`, so every resume presents a fresh first-hook edge. Left alone, a resumed task would re-read the create's stamp against the new spawn time and overwrite a real duration with zero. `spawnedAt` is now spent on the first read, so only the run that wrote a stamp gets to date it.

9 tests in `worktree-create.test.ts`. Remaining: the composer controls (AC #1) and the project settings surface (AC #5, which also closes TASK-55).

Code review of the server half found five issues, all fixed and verified:

- **A create that failed *after* the worktree orphaned it (high, and mine).** `createWorktree` backs its own partial state out, but the create keeps going — the settings write, the spawn — and both throw on things users hit, an agent binary no longer on PATH being the ordinary one. The row was deleted and the checkout and branch stayed, registered in `.git/worktrees` and referenced by nothing; worse, the branch is named from the title, so the next attempt at the same task would silently get a `-2`. It also contradicted `api/tasks.test.ts`, which already asserts a spawn failure leaves nothing behind. `createWorktree`'s rollback is now a shared `discard()`, exported as `removeWorktree` and called from both post-worktree catch blocks. Confirmed by neutering the rollback and watching the new test fail.
- **`normalizeSettingsPatch` used `"field" in patch`**, so a key present as `undefined` cleared the setting — contradicting the function's own doc, and diverging from `TaskStore.update` and `db.updateProject` where `undefined` means leave alone. Now keyed on `!== undefined`; `null` still clears.
- **A non-string setting threw out of the socket handler.** `settings` reaches `updateProject` straight from `JSON.parse` with no validation and no try/catch, so `{"defaultModel": 5}` was a `TypeError` that took the frame down. `text()` now takes `unknown` and answers null for anything that is not a string.
- **The base-ref fallback chain was spelled twice**, once for `createWorktree` and once for the column. Hoisted.
- **`bad-base-ref` answered 500.** A ref that names nothing is a typo in the request body, and a 5xx tells the CLI to retry something that will never work. Request-caused kinds are 400 now; git and copy failures stay 500.

`bun run test`: 781 unit and 79 render tests pass, 0 fail. `bunx tsc --noEmit` clean.

Frontend done, and verified in a browser (the `verify` skill) rather than only under Happy DOM.

**Composer** (AC #1): a worktree chip and a base-ref field in the options row, seeded from the project in the render that moves the selection — the same pattern model and mode already use, because an effect would paint one frame of the previous project's answer and ⌘⏎ in that frame would send it. Both send nothing when they agree with the project, so 'I did not touch this' and 'I chose the same thing' stay the same request and a project whose default later changes moves the tasks that never overrode it. The base-ref field only appears alongside a worktree, since it decides nothing without one. General has no directory, so the chip is disabled rather than hidden — the row should not reflow as the selection moves.

**Project settings** (AC #5, and TASK-55): a new `ProjectSettingsDialog` composed from `components/v2`, reached from a per-project button beside the existing delete. Not an extension of `SettingsDialog`, which is per-device preference in localStorage and v1 shadcn that TASK-59 wants replaced — putting server-side project state in it would put two scopes of 'setting' under one title. Six fields; Save sends the whole form, so a cleared field clears. General gets the dialog too (it still decides a model and mode) with the three worktree fields disabled and a line saying why.

Two things the primitives needed: a `Checkbox` (nothing in either layer had one, and both surfaces want it) and a `label` prop on `Textarea`, which `TextInput` already had — a form mixing the two should not have to lay one of them out by hand. The option lists moved out of `Composer.tsx` into `lib/agent-options.ts`, since the composer and the settings form choosing from two copies would drift.

Found only by looking: the first `Checkbox` drew its tick with `peer-checked:` on the icon, but the peer variant compiles to a sibling combinator and the tick is a *child* of the box — it would never have appeared. Happy DOM applies no stylesheet, so no render test could have caught it. Also caught by eye: the dialog stacked four labels and inlined two, because `Select` is itself a `<label>` and cannot nest inside the stacked one the other fields use. A local `Field` wrapper plus `aria-label` makes the form read as one thing.

End-to-end in the browser: set a project to default-on with base ref `main` and a setup command, created a task through the API with no worktree flag, and got a checkout at the id-derived path on `codetoaster/verify-the-worktree-wiring`, branched from main, with the setup command's output in the worktree and `setup_duration_ms` of 18 recorded off the first hook. The verify instance, its worktree and its branch were removed afterwards.

Second code review, after the frontend landed. Five findings, all real, all fixed:

- **Five of the new tests spawned the real `claude`.** `worktree-create.test.ts` passes neither `command:` nor `CODETOASTER_AGENT_BIN`, so `buildAgentCommand` fell through to its `claude` default — real agent sessions against throwaway repos on any machine with Claude Code installed, and an outright failure on one without. Verified both ways: with `claude` off PATH the file fails four tests with `Executable not found in $PATH: "claude"`, and passes 10/10 with the stand-in. Galling because `api/tasks.test.ts` already carries a comment about exactly this hazard; the new file simply did not inherit the habit. (The review's '~30s of the 37s unit run' did not reproduce — it is 3.5s either way, because the agent is killed almost immediately. The reason to fix it is CI and not starting real sessions, not speed.)
- **`store.create` sat outside the worktree rollback.** `undoWorktree` guarded the settings write and the spawn but not the insert between them, so a throwing insert would leave a registered checkout and a title-derived branch behind — the same leak, and the same unearned `-2`, that the rollback exists to prevent.
- **`void this.recordSetupOutcome(taskId)` had no `.catch`**, the only bare `void` call in the file. `applyHook` is synchronous and answers a live HTTP request, so a rejection had no caller left.
- **The no-directory case threw a plain `Error`**, which the route grades 500. It is the caller's mistake and only reachable from the API and the CLI, since the composer disables the toggle — so a 5xx told exactly the wrong callers to retry. Now a `WorktreeError("not-a-repo")`, which the existing 400 grading picks up.
- **The disabled chip's tooltip was unreachable.** `title` fell into `...rest` and landed on `Checkbox`'s `sr-only` input; a 1px clipped element that is also disabled takes no pointer events, so the one message that most needed reading could never be hovered. Now on the wrapping label.

Added three tests the fix pass did not: the 400 grading for a worktree with no repository, the two request-validation refusals beside it, and an assertion that the tooltip is on the label rather than the input.

`bun run test`: 784 unit and 94 render tests pass, 0 fail. `bunx tsc --noEmit` clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Wired `lib/worktree` into task creation and gave projects a settings surface.

Server: `ProjectInfo` carries the six project settings; `updateProject` takes them as a patch with blank normalizing to NULL so 'unset' stays expressible. `createTask` resolves the project first, derives the title, then makes the worktree *before* the row — which is what makes a failed create leave nothing behind — and sets cwd to the checkout. The agent is wrapped with `wrapWithSetup` only for a worktree this create just made. `POST /api/tasks` takes `{ worktree, baseRef }`, `worktree` tri-state so an absent field still honours the project's default. `setup_duration_ms` is read on the task's first hook, since the wrapper only execs the agent after setup exits zero.

Frontend: a worktree chip and base-ref field in the composer's options row, seeded from the project and sending nothing when they agree with it; a new `ProjectSettingsDialog` composed from `components/v2` reached from a per-project button. Needed two primitives — a `Checkbox`, and a `label` prop on `Textarea` to match `TextInput` — and the model/mode option lists moved to `lib/agent-options.ts` so the two surfaces cannot drift.

Closes TASK-55: the same surface carries default model and permission mode, which is what that task asked for rather than a second dialog.

Verified with `bun run test` (781 unit, 90 render, 0 fail) and in a real browser: a project set to default-on produced a checkout at the id-derived path on a branch named from the title, branched from the configured base ref, with the setup command's output in the worktree and its duration on the row.
<!-- SECTION:FINAL_SUMMARY:END -->
