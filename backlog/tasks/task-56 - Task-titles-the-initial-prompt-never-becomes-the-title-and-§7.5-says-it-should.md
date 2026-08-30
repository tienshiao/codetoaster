---
id: TASK-56
title: >-
  Task titles: the initial prompt never becomes the title, and §7.5 says it
  should
status: To Do
assignee: []
created_date: '2026-08-30 22:11'
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
- [ ] #1 createTask derives the title from the first line of the initial prompt (truncated) when a prompt is given and no explicit title is
- [ ] #2 A prompt-derived title does not record title_source: manual, so it does not outrank a live OSC terminal title the way a rename does
- [ ] #3 An explicit title (rename, or POST /api/tasks with title) still wins over both, and a task created with no prompt still falls back to the derived <dir> · <branch> label
- [ ] #4 The task card shows the OSC-projected label as a subtitle, or §7.5 is amended to drop it — whichever is decided, doc and code agree afterwards
- [ ] #5 Tests cover: prompt-derived title, empty/whitespace prompt falling back to the derived label, and a prompt-derived title still yielding to a live OSC title
<!-- AC:END -->
