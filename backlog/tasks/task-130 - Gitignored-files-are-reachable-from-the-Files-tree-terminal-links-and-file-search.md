---
id: TASK-130
title: >-
  Gitignored files are reachable from the Files tree, terminal links and file
  search
status: Done
assignee:
  - '@claude'
created_date: '2026-10-10 08:56'
updated_date: '2026-10-10 09:34'
labels:
  - frontend
  - server
dependencies: []
priority: medium
ordinal: 132000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Every file list in the app comes from one git listing that leaves out everything the repository ignores, so an ignored file (.env, .claude/settings.local.json, anything under dist/ or node_modules/) cannot be opened from the Explorer, is never a terminal link and never matches in the palette or the composer. The content route already serves such a file; only the lists hide it. Listing everything is not an option: this repository has 731 listed files and about 34,500 ignored ones. So ignored entries are listed collapsed to the directory, drawn dimmed, and an ignored directory loads its children one level at a time when it is expanded.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The Files tree lists ignored files and ignored directories, dimmed, and an ignored directory shows its children only once expanded, one level per expansion
- [x] #2 A directory with more children than the cap says how many are not shown instead of rendering them all
- [x] #3 The files route answers with ignored entries flagged, and a new children route answers 400 for a missing, escaping or non-ignored directory and 404 for one that is not there
- [x] #4 A terminal path naming a listed ignored file, or a file under a listed ignored directory, is a link
- [x] #5 File search (palette and composer) matches individually ignored files but not the contents of ignored directories
- [x] #6 The symbol index and the working-tree diff are unchanged: neither reads ignored files
- [x] #7 A change to an ignored file refreshes an open tab on it and an expanded ignored directory, and a change under an already listed ignored directory does not refetch the file list, the diff or the search
- [x] #8 Nested expansions under an ignored directory survive a remount and a reload
- [x] #9 Tests cover the listing, both routes, the watcher batch, the invalidation mapping, the link rule and the tree; wiki pages for terminal links and the file viewer are updated
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Server listing: listIgnoredEntries (ls-files others+ignored, collapsed by directory, containers of individually listed entries dropped) and buildFileListing taking ignored entries. 2. Routes: files returns flagged entries; new files/children lists one level of an ignored directory from disk, capped; search adds individually ignored files. 3. Watcher: a batch carries the ignored paths it used to drop, as their own field; the changed frame follows. 4. Client invalidation: an ignored path stales its file and its parent listing, and the file list only when it is not under a listed ignored directory. 5. Tree: pure merge of loaded children into the listing, a hook that queries each expanded ignored directory, dimmed rows and note rows in FileTree, pruning that keeps what it cannot see. 6. Terminal links: listed ignored files join the index; a path under a listed ignored directory links by prefix when its last segment has an extension. 7. Wiki, review, verify.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Server, watcher and client are implemented with tests; bun run test (2031 + 521) and typecheck are clean. git quirk found while probing: with the directory flag, a directory no rule names but which holds only ignored files is listed beside those files, so listIgnoredEntries drops any entry that is the parent of another; the no-empty-directory flag is not usable because it also drops non-empty ignored directories. The watcher tests asserting exact batches flake on a loaded machine (the untouched baseline failed the same way at load average 30), so the ones touched here assert where a path landed instead.

Verified on an isolated server (port 4599, scratch db) against a fixture repository and this checkout. API: files flags .env, dist, many and the ignored files under out and src, and leaves out as an ordinary directory; children answers one level for dist, dist/assets and a trailing-slash dist, caps many at 1000 with truncated 5, and refuses with 400 (no dir, climbing path, src, out, .git) and 404 (missing, a file); search finds .env and src/debug.log and nothing inside dist. Against this checkout: files 122ms with node_modules as one entry, children of node_modules 537 entries in 27ms. Browser: ignored rows are dimmed, dist and dist/assets load one request each, many shows 1000 rows and a 5 more not shown line, nested expansions survive a reload, a write under dist/assets refetches only that directory's children and the open file, a new top-level ignored file refetches only the listing, and in the terminal dist/assets/app.js:1 and .env are links while dist/assets and distribution/x.js are not.

After review: the watcher also names the ignored paths that are no longer on disk (gone), so a write to an ignored file the listing already holds (a dev server's log) stales only that file while its removal still refetches the listing; the cost is that the size shown beside such a file is as old as the listing. The tree's memo is keyed on the identity of each answer rather than when it arrived, so a refetch that found nothing new rebuilds nothing.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Ignored files are now reachable everywhere a file list is used. The files route adds what the repository ignores, flagged and collapsed to the directory (listIgnoredEntries); a new files/children route answers one level of an ignored directory from disk, capped at 1000 entries. The Files tree draws ignored entries dimmed and loads an ignored directory when it is expanded (walkIgnored, useIgnoredTree), and nested expansions survive a reload. Terminal links include listed ignored files and link a path under a listed ignored directory on its shape. File search matches individually ignored files only. The symbol index and the diff are untouched. The watcher reports ignored paths apart from files, with removals named, and the client refetches the file listing for them only when an entry may have appeared or gone, so a build or a churning log does not refetch it. Review (code-review with fixes): seven findings, all addressed. Fixed: the children route answered 500 beyond a symlink (pnpm-style node_modules); an unconfirmed link guess could outrank a listed file or light up every dotted word after cd into an ignored directory; the tree rebuilt on every directory toggle and on every no-op refetch; a churning ignored file refetched the listing each second; the containment check was duplicated between reveal and children. Verification: bun run test 2039 + 523 passing, typecheck clean; driven on an isolated server (port 4599, scratch db) against a fixture repository and this checkout, API and browser, including the cases the review changed (children beyond a link 200; append to an ignored log sends no request; deleting it refetches the listing). Limits: node_modules, .git and .claude/worktrees never reach a watcher batch, so an open node_modules refreshes only on refetch; a burst over 200 paths still invalidates everything, as before.
<!-- SECTION:FINAL_SUMMARY:END -->
