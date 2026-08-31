---
id: TASK-56
title: >-
  Task titles: the initial prompt never becomes the title, and §7.5 says it
  should
status: Done
assignee:
  - '@claude'
created_date: '2026-08-30 22:11'
updated_date: '2026-08-31 00:30'
labels:
  - server
  - frontend
  - tasks
milestone: m-3
dependencies: []
documentation:
  - docs/v2-architecture.md
ordinal: 56000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
docs/v2-architecture.md §7.5 says: "The initial prompt becomes the title (first line, truncated); the live OSC terminal title becomes the *subtitle* on the task card." The implementation does neither. `TaskManager.createTask` (src/lib/tasks/manager.ts:297) titles a task with `options.title || uniqueName(await deriveTitle(cwd), ...)`, and `deriveTitle` (src/lib/tasks/derive.ts:51) returns the "<dir> · <branch>" label. A task created from the composer with a real prompt comes out named "codetoaster · v2" — the prompt is stored in `initial_prompt` and never read for display.

This predates the composer (TASK-24), which surfaced it: every task the composer makes is indistinguishable from every other task in the same checkout until the agent sets an OSC title.

It is not a one-line fix, which is why this is a task and not a cleanup. Passing a title into `createTask` sets `title_source: "manual"` (manager.ts:318), and a manual title permanently outranks the live terminal title in `sessionDisplayNames` — so naively routing the prompt through `options.title` would freeze every task's label at its opening prompt and kill the OSC projection the §7.5 subtitle depends on. A derived-from-prompt title needs its own provenance, or the projection needs to rank prompt-derived below OSC.

Decide the behaviour, then make the doc and the code agree — including deciding whether the card grows the OSC subtitle §7.5 describes, or whether that idea is dropped.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 createTask derives the title from the first line of the initial prompt (truncated) when a prompt is given and no explicit title is
- [x] #2 A prompt-derived title does not record title_source: manual, so it does not outrank a live OSC terminal title the way a rename does
- [x] #3 An explicit title (rename, or POST /api/tasks with title) still wins over both, and a task created with no prompt still falls back to the derived <dir> · <branch> label
- [x] #4 The task card shows the OSC-projected label as a subtitle, or §7.5 is amended to drop it — whichever is decided, doc and code agree afterwards
- [x] #5 Tests cover: prompt-derived title, empty/whitespace prompt falling back to the derived label, and a prompt-derived title still yielding to a live OSC title
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. `titleFromPrompt` in `lib/tasks/derive.ts`, beside `deriveTitle`: first non-blank line, whitespace collapsed, cut to 60 at a word boundary. Pure, so it is a unit test rather than a fixture.
2. `createTask` ranks three sources — explicit title, then the prompt, then `<dir> · <branch>` — with only the first recorded as `manual`.
3. No new `TitleSource`. `derived` already means exactly what a prompt-derived title needs to mean: a guess the live OSC title may display over. A third value would have to be taught to `sessionDisplayNames`, and would be teaching it a distinction it does not need.
4. AC #4: check what the card's second line actually shows before writing anything.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**No schema change, and that is the finding.** AC #2 wanted a prompt-derived title not to outrank the terminal title the way a rename does — which is precisely what `derived` already means to `sessionDisplayNames`. So the ranking needed one line in `createTask`, not a new source value and a migration.

**AC #4 turned out to be a doc bug, not a missing feature.** §7.5 says the OSC title becomes the card's subtitle. `previewOf` in `TaskSidebar` already does something better and had already reasoned it out in a comment: `last_message` takes the line, because a list of thirty answers 'which of these want me?' with the last thing the agent *said* and not with a title reading 'Editing manager.ts'; the terminal title takes it only when there is no `last_message` and it is not already serving as the label. §7.5 is amended to describe that, with the reason. Nothing in the code changed for this AC beyond a comment that had gone stale — it still said an ambiguous label falls back to `<dir> · <branch>`, which is now 'the stored title, which is the prompt or the directory'.

Verified in the browser, and the whole ranking is legible in a single row: a task created with a prompt shows its opening line; once its agent sets an OSC title the row shows *that*; renamed, the row shows the chosen name and the OSC title drops to the second line — which is §7.5's original subtitle idea appearing exactly where it earns its place. Three tasks in one checkout now read as three different things instead of `codetoaster · v2`, `… 2`, `… 3`.

Tests: seven in `derive.test.ts` for the string work (blank lines, whitespace runs, word-boundary cut, an overlong single word, exact fit, nothing-to-say), six in `manager.test.ts` for the ranking and both projection directions. The three that matter were confirmed to fail against the old `deriveTitle`-only line.

Post-review, two defects in this commit, both mine and both found by reading rather than by a test:

**The explicit-title path lost its short-circuit.** Hoisting the derived label to `const derived = titleFromPrompt(...) || (await deriveTitle(cwd))` made that `await` unconditional, so `POST /api/tasks {"title":"Chosen"}` — the CLI's shape — blocked on `git rev-parse` (two calls on a detached HEAD, up to the full 2s timeout on a contended index.lock) to compute a label thrown away on the next line. Folded back into one expression so each `||` short-circuits.

**A whitespace-only prompt disagreed with itself.** `titleFromPrompt` calls `"   \n\t\n "` nothing to say and falls back to the directory — which this task's own tests assert — but `initial_prompt` stored it verbatim and `buildAgentCommand` judges that on truthiness, so the agent was started with `-- "   \n "` and a blank turn already submitted, instead of the plain interactive session the title fallback had just decided this task was. Two truthiness judgements on one value, disagreeing. `initial_prompt` is trimmed now, with a test asserting both halves agree.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A task is now called what it was asked to do: `titleFromPrompt` takes the opening line of the prompt, and `createTask` ranks explicit title > prompt > `<dir> · <branch>`. Only an explicit title is recorded as `manual`, so a prompt-derived one still yields to the agent's live terminal title exactly as the directory label did — no new `TitleSource`, no migration.

§7.5's other claim, that the OSC title becomes the card's subtitle, is amended rather than implemented: `last_message` already holds that line and is the better answer to 'which of these want me?', with the terminal title taking it only when there is no last message and it is not already the label.
<!-- SECTION:FINAL_SUMMARY:END -->
