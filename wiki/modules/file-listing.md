---
type: Module
title: File listing and ignored files
description: One git listing feeds the Files tree, terminal links and file search; ignored entries are in it collapsed to the directory, and an ignored directory's children load one level at a time when it is opened.
tags: [files, git, gitignore, explorer, watcher]
level: project
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-10T09:10:00Z }
sources:
  - id: utils
    resource: ../../src/api/utils.ts
    title: src/api/utils.ts
  - id: routes
    resource: ../../src/api/files.ts
    title: src/api/files.ts
  - id: walk
    resource: ../../src/frontend/utils/ignored-files.ts
    title: src/frontend/utils/ignored-files.ts
  - id: hook
    resource: ../../src/frontend/hooks/use-task-files.ts
    title: src/frontend/hooks/use-task-files.ts
  - id: watcher
    resource: ../../src/lib/tasks/watcher.ts
    title: src/lib/tasks/watcher.ts
  - id: invalidation
    resource: ../../src/frontend/change-invalidation.ts
    title: src/frontend/change-invalidation.ts
  - id: task-130
    resource: "../../backlog/tasks/task-130 - Gitignored-files-are-reachable-from-the-Files-tree-terminal-links-and-file-search.md"
    title: "TASK-130 — Gitignored files are reachable from the Files tree, terminal links and file search"
---

# Two listings

`GET …/files` is built from two git calls.[^utils][^routes]

| Call | Holds |
| --- | --- |
| `listGitFiles`: `ls-files --others --cached --exclude-standard` | tracked files, and untracked files that are not ignored |
| `listIgnoredEntries`: `ls-files --others --ignored --exclude-standard --directory` | what the repository ignores, collapsed to the directory |

An ignored entry carries `ignored: true`. An ignored directory is one entry with nothing under it. This repository has about 730 listed files and 34,500 ignored ones, nearly all under `node_modules/`, `dist/` and other tasks' worktrees, so the listing never walks into an ignored directory.[^task-130]

`--directory` has one shape that is taken back out. For a directory no rule names but which holds only ignored files, git lists the directory and the files (`out/` beside `out/a.log`, under `*.log`). That directory is an ordinary one, so an entry that is the parent of another is dropped. `--no-empty-directory` is not the fix: it also drops ignored directories that have files in them.[^utils]

# Who reads what

| Reader | Ignored files | Inside an ignored directory |
| --- | --- | --- |
| Files tree | listed, dimmed | loaded when the directory is expanded |
| [Terminal links](/modules/terminal-links.md) | links | linked on shape alone |
| Markdown preview links | resolve | not resolved |
| File search (palette, composer `@`) | match | never match |
| Symbol index, working-tree diff | not read | not read |

Search leaves the inside of ignored directories out so `node_modules` cannot outrank the user's own code.[^routes]

# Opening an ignored directory

`GET …/files/children?dir=` answers one level of a directory, read from the disk.[^routes]

- Only for a directory `git check-ignore` calls ignored. Anything else is a 400: its files are already in the listing, and answering would flag tracked files as ignored.
- git is asked about the path only as far as its first symbolic link. `check-ignore` refuses a path beyond one (exit 128), which is every directory of a package in a `node_modules` whose packages are links into a store or a workspace. The repository rules on the link, not on where it leads.
- The resolved path must stay inside the repository. A link in `node_modules` can point anywhere.
- At most 1,000 entries, by name, with `truncated` saying how many were left out. The tree draws every row it is given.

On the client, `walkIgnored` decides which directories to ask for: those that are expanded and reachable through expanded parents that have answered.[^walk] `useIgnoredTree` holds one query per such directory and stitches the answers into the listing.[^hook] A collapsed directory is not observed, so nothing under `node_modules` is fetched for a tree that never opened it.

A stale entry of the expanded set (a directory since deleted) is never asked for, because no parent names it. The tree prunes expansions that no longer exist, but keeps those under a directory whose children have not arrived. That is what lets a nested expansion survive a reload.[^walk]

# Keeping it current

The watcher's batch names ignored paths apart from `files`, in `ignored`.[^watcher] They used to be dropped, because every view then was ignore-aware and a build would have refetched all of them once a second. Those of them no longer on disk are also named in `gone`: an event says a path moved, not whether it was written or removed.

The client maps an ignored path to:[^invalidation]

- the file's own query, so an open tab on it refreshes
- the children query of its parent directory, which refetches only if that directory is open
- the listing and the search, unless the listing already covers the path

The listing covers a path under an ignored directory it holds, and an ignored file it holds that is not `gone`. That is what keeps a build quiet, and a dev server appending to an ignored log: neither changes an entry the listing shows, and every visible terminal observes the listing for its links. The diff, the symbols and the backlog are never touched by an ignored path.

Three limits:

- The size shown beside a listed ignored file is as old as the listing's last fetch.
- `node_modules`, `.git` and `.claude/worktrees` never reach a batch at all, so `node_modules` open in the tree is as old as its last fetch.
- A burst of more than 200 paths is reported as `files: null`, unfiltered, as before. Everything is refetched, open ignored directories included.

[^utils]: src/api/utils.ts
[^routes]: src/api/files.ts
[^walk]: src/frontend/utils/ignored-files.ts
[^hook]: src/frontend/hooks/use-task-files.ts
[^watcher]: src/lib/tasks/watcher.ts
[^invalidation]: src/frontend/change-invalidation.ts
[^task-130]: TASK-130 — Gitignored files are reachable from the Files tree, terminal links and file search
