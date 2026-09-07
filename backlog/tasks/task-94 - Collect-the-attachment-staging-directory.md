---
id: TASK-94
title: Collect the attachment staging directory
status: Done
assignee:
  - '@claude'
created_date: '2026-09-06 20:02'
updated_date: '2026-09-06 20:25'
labels: []
dependencies: []
ordinal: 98000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-93 added `~/.codetoaster/uploads/<uuid>/` and nothing sweeps it, so every composer attachment and every file dropped on a terminal accumulates for good. It is also a regression for the drop-on-terminal path, which used to write to `/tmp` — swept by the OS — until TASK-93 moved it here for durability.

Cleanup is not simply "delete it with the task". The path lives inside `initial_prompt`, so it has to outlive the first turn: a resumed conversation can re-read the image. And the terminal-drop path types its paths into the *PTY*, so nothing in the database ever names them at all.

So a third harvester tier, on the same timer as the other two. A staging directory is collected when it is **older than the window and named by no task's prompt**. The reference check is what keeps a composer attachment alive for as long as its conversation can be resumed; the age is what covers the rest — a terminal drop, or an upload whose `POST /api/tasks` then failed — and is also the race guard, since a directory written a moment ago is referenced by nothing yet because its create is still in flight.

A terminal drop older than the window whose agent wants to re-read it is the accepted loss, and the same bargain the evict tier already strikes with checkouts. `--uploads-after` turns it off for anyone who would rather keep the disk.

The boot reap sketched alongside this is deliberately not built: with the tier keyed on "unreferenced and old", a sweep at boot finds exactly what the first tick finds thirty seconds later.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A staging directory older than the window and named by no task's initial_prompt is removed on a harvester tick
- [x] #2 A directory a prompt still names is kept, however old — a resumed conversation can re-read it
- [x] #3 A directory younger than the window is kept even though nothing names it yet, so an upload whose create is still in flight survives
- [x] #4 Only uuid-named directories directly under the uploads root are ever removed
- [x] #5 The tier reads no task rows on a tick that finds nothing old enough to consider
- [x] #6 --uploads-after <dur> / CODETOASTER_UPLOADS_AFTER configures it, 0 turns it off, and it survives the daemon respawn like the other two tiers
- [x] #7 Turning the other two tiers off does not start the worktree-status refresh they used to gate
- [x] #8 Tests cover the collector's four outcomes, the tier's wiring, and the new daemon arg
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Move the staging directory out of the route: new src/lib/uploads.ts owns uploadsDir/saveUploads and gains collectUploads; src/api/uploads.ts keeps the route and readUploadedFiles.
2. collectUploads(root, olderThanMs, now, prompts): readdir, keep uuid-named directories, stat for mtime, and only if any are old enough call prompts() and drop those no prompt names. Best-effort per directory.
3. Harvester: uploadsAfterMs (default 7d, 0 off), sweepUploads as a third tier after evict, tick's early-return widened to it, and sweepWorktreeStatus given the guard it used to borrow from tick.
4. TaskManager.allTasks() for the prompt scan (store.list() unfiltered — archived rows name attachments too).
5. Thread the window through: ServerOptions -> Harvester, DaemonOptions -> daemonArgs, --uploads-after in index.ts, help text and the new-daemon-flags notice in commands.ts.
6. Tests: lib/uploads.test.ts for the collector, harvester.test.ts for the tier and the worktree-status guard, duration.test.ts for the arg. docs §5.5.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built as planned, with two corrections found along the way.

- **The tier's root had to become an option.** `collectUploads` *deletes*, and its default root is the developer's own `~/.codetoaster/uploads`. A harvester test whose in-memory database holds none of those tasks' prompts would read every real attachment as unreferenced and take it. So `HarvesterOptions.uploadsRoot` exists purely so a test cannot do that by forgetting, and `newManager()` in the harvester tests also switches the tier off outright.
- **`sweepWorktreeStatus` needed a guard of its own.** It used to lean on `tick`'s early return for its 'harvesting off means no git' promise. `tick` now also runs for the uploads tier alone, so without the explicit guard a user who turned harvesting and eviction off and left attachment collection on would have started paying a git call per checkout — a tier they switched off returning through the door of one they did not.

A first draft justified the tier's position in the sweep by saying eviction hard-deletes rows; it does not — `evictTask` takes the checkout and leaves the task. The comments now say plainly that this tier's ordering is not load-bearing, since no tier here removes a row and a prompt going away is what makes an attachment collectable.

The boot reap sketched in the description was deliberately not built: with the policy keyed on 'unreferenced and old', a sweep at boot finds exactly what the first tick finds thirty seconds later.

Validation: `bun run test` — 1374 unit (+10) + 304 render, 0 fail; `tsc --noEmit` clean. Verified at runtime on a foreground daemon started with `--uploads-after 1m --harvest-after 0 --evict-after 0`: the startup line read them back, two staging directories were uploaded and backdated past the window, one of them named by a task's prompt — the tick took the orphan and kept the named one, and hard-deleting that task released its directory on the next tick. `--help` lists the new flag. docs §5.5 documents the tier.

**Code review found a defect in this task's own protection, and it was the serious one.** The tier defaults to a seven-day window against the real `~/.codetoaster/uploads`, and the `uploadsRoot` option added here only protects a caller that passes it. Three test sites build a bare `new Harvester(manager)` deliberately — two in `harvester.test.ts` asserting the shipped defaults, one in `worktree.test.ts` — and their in-memory databases name none of the developer's real prompts, so a plain `bun test` collected the user's actual attachments. Reproduced with a stale canary directory.

Fixed by pinning the root instead of the option: `uploadsDir()` honours `CODETOASTER_UPLOADS_DIR`, and `test/uploads.ts` (`useTestUploadsDir`) points it at a temp directory from both runners' entry points and a `beforeEach` — the same shape as `useFakeAgentBin`/`useTestShell`, so protection is by construction rather than per call site. `uploads.test.ts` carries the guard-on-the-guard, as `agent-bin.test.ts` does, because bunfig's `[test] preload` is the setting CLAUDE.md records as going silent under `bun run`. Verified: an aged canary in the real staging directory survives a full harvester + worktree run.

Two more from the same review, both against TASK-93's surface and both fixed:

- `/api/tasks/:id/upload` typed its paths into the PTY space-separated and unquoted, so `Screenshot 2026-09-06 at 14.22.13.png` — the exact file this feature exists for — reached the agent as five fragments. `ptyPathList` quotes only a path holding something a word split would act on, so the ordinary path stays bare and readable.
- Two files of one name in one call overwrote each other: the prompt listed one path twice while the composer showed two chips, losing an attachment with nothing saying so. They now number (`image.png`, `image-2.png`), before the extension so the name still says what kind of file it is.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A third harvester tier collects `~/.codetoaster/uploads/<uuid>/`, which TASK-93 created and nothing swept. A staging directory goes when it is older than `uploads_after` (default 7d, `--uploads-after`, 0 off) *and* no task's initial_prompt names it: the reference is what couples an attachment's lifetime to its task's, so a suspended or archived conversation keeps its files and a hard-deleted one releases them, while the age covers what no row will ever name — a file dropped on a terminal, or an upload whose create then failed — and guards the race against a create still in flight. Only uuid directories directly under the root are removed, and the prompts are read lazily so an ordinary tick costs one readdir. `sweepWorktreeStatus` gained the guard it used to borrow from `tick`. Verified by bun run test (1374 + 304, 0 fail), tsc, and a live daemon on a one-minute window.
<!-- SECTION:FINAL_SUMMARY:END -->
