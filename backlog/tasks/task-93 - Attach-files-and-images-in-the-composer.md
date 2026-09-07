---
id: TASK-93
title: Attach files and images in the composer
status: Done
assignee:
  - '@claude'
created_date: '2026-09-06 19:42'
updated_date: '2026-09-06 20:26'
labels: []
dependencies: []
ordinal: 97000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The composer can only start a task from text. A screenshot of a broken screen, a log file, a design mock — all of it has to be saved somewhere by hand and its path typed in, or the task has to be started blind and the file dropped on the terminal afterwards (which is what `/api/tasks/:id/upload` already does for a live task).

So: attach files to a task *before* it exists. The composer takes files by button, by drag-and-drop and by paste (a clipboard screenshot is the case this is really for), shows them as removable chips, and on submit uploads them and appends their absolute paths to the prompt — which is how Claude Code is told to look at an image.

The upload cannot be task-scoped, because there is no task id yet. A staging endpoint writes the files under `~/.codetoaster/uploads/<uuid>/` and answers with the paths; the existing task-scoped route is refactored onto the same helper rather than keeping a second copy of the multipart-to-disk logic (including its basename guard against a client sending `../../.zshrc`).

Upload happens on submit, not on attach: nothing is written for a composer the user walks away from, and there is no orphan-cleanup story to own.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 POST /api/uploads takes a multipart body of files and answers { paths } with absolute paths under ~/.codetoaster/uploads
- [x] #2 A filename from the multipart body is basenamed, so a traversing name cannot write outside the staging directory
- [x] #3 /api/tasks/:id/upload uses the same helper and the same staging directory instead of its own /tmp copy
- [x] #4 The composer attaches files by a button, by dropping them on the composer, and by pasting them into the prompt
- [x] #5 Attachments render as chips — a thumbnail for an image, name and size otherwise — each removable, with object URLs revoked
- [x] #6 Submit uploads the attachments first, then sends a prompt with their paths appended; a failed upload leaves the prompt and the attachments untouched and reports inline
- [x] #7 Attachments alone are enough to submit, with no prompt text
- [x] #8 Tests cover the prompt composition, the route (including the traversal guard), and the composer's attach/remove/submit/failure paths
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. src/api/uploads.ts: `saveUploads(files)` writes each file to ~/.codetoaster/uploads/<uuid>/<basename> and returns absolute paths; `uploadRoutes` mounts POST /api/uploads on it. Spread into guardApiRoutes in server.ts.
2. Refactor /api/tasks/:id/upload onto saveUploads, dropping its /tmp copy.
3. src/frontend/lib/attachments.ts: pure promptWithAttachments(text, paths) + formatBytes, unit-tested.
4. use-upload-mutation.ts: add uploadStaged(files) => paths, throwing on a non-ok response (the existing helper swallows it).
5. Composer: attachment state (File[] + object URLs), a Paperclip button over a hidden file input, drop overlay on the pane, onPaste on the textarea, removable chips with image thumbnails. Submit uploads first, appends paths, keeps everything on failure. canSubmit allows attachments with no text.
6. Tests: attachments.test.ts, an uploads route test (including the traversal guard), and Composer.render.tsx cases for attach/remove/paste/submit-payload/upload-failure.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built as planned. Two decisions worth keeping:

- **The paths go *under* the user's text, never over it.** `titleFromPrompt` takes the first non-empty line, so a prompt led by a staging path titles the task with a uuid directory. Verified end to end: a submit with two attachments stored `initial_prompt` as the ask plus a blank line plus the two paths, and the row's title came out "what is wrong with this header".
- **Upload at submit, not at attach.** Nothing is written for a composer the user walks away from, so there is no orphan sweep to own; the cost is that a large paste uploads at ⌘⏎. A failure there returns before `createTask`, because a task whose prompt names files that were never written is worse than one that never started.

The task-scoped `/api/tasks/:id/upload` moved off its own `/tmp` copy onto the same `saveUploads`, so the traversal guard exists once. It also stops writing to `/tmp`, which macOS sweeps out from under a path the agent may not read for a while.

Validation: `bun run test` — 1364 unit + 304 render, 0 fail; `tsc --noEmit` clean. Verified at runtime on a foreground daemon (verify skill): POST /api/uploads answers with paths under ~/.codetoaster/uploads/<uuid>/, a `../escape.txt` part lands inside that directory and not beside it, a body with no file parts is a 400 and a cross-origin post is a 403. In the browser: the Attach chip, a pasted PNG rendering its thumbnail, a dropped file and the "Drop files to attach" overlay, a chip removed by its ×, and a shell-profile task created from the lot. docs/v2-architecture.md §7.5 updated.

Two defects on this surface were found by a later code review (during TASK-94) and fixed there:

- `/api/tasks/:id/upload` wrote its paths into the PTY space-separated and unquoted, so `Screenshot 2026-09-06 at 14.22.13.png` — the exact file this feature exists for — reached the agent as five fragments. `ptyPathList` in `lib/uploads.ts` now quotes a path only when it holds something a word split would act on, so the ordinary path stays bare and readable.
- `saveUploads` let two files of one name in a single call overwrite each other: the prompt listed one path twice while the composer showed two chips, losing an attachment with nothing saying so. They now number — `image.png`, `image-2.png` — before the extension, so the name still says what kind of file it is, and `.zshrc` numbers as `.zshrc-2` since a leading dot is the whole name rather than a separator.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The composer takes files by button, drop and paste, holds them as removable chips (thumbnail for an image), and on submit uploads them to POST /api/uploads — a new staging route writing under ~/.codetoaster/uploads/<uuid>/ — then appends the paths below the prompt, which is how the agent is told to look at them. Attachments alone are a valid submit; a failed upload starts nothing and leaves the prompt and the chips intact. /api/tasks/:id/upload was refactored onto the same helper, retiring its /tmp copy of the multipart-to-disk logic and its duplicate traversal guard. Verified by bun run test (1364 unit + 304 render, 0 fail), tsc, curl against a live daemon, and driving the UI in Chrome.
<!-- SECTION:FINAL_SUMMARY:END -->
