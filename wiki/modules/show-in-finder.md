---
type: Module
title: Show in Finder
description: A file tab, a working-tree diff's file headers and the Explorer's rows can show a path in Finder on the daemon's Mac; one hook gates every surface to a desktop Mac browser at a loopback host, and the route refuses anything else.
tags: [files, diff, explorer, backlog, finder, frontend, api]
level: project
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-13T01:26:00Z }
sources:
  - id: use-reveal
    resource: ../../src/frontend/hooks/use-reveal.ts
    title: src/frontend/hooks/use-reveal.ts
  - id: point-menu
    resource: ../../src/frontend/components/v2/DropdownMenu.tsx
    title: src/frontend/components/v2/DropdownMenu.tsx
  - id: platform
    resource: ../../src/frontend/utils/platform.ts
    title: src/frontend/utils/platform.ts
  - id: files-route
    resource: ../../src/api/files.ts
    title: src/api/files.ts
  - id: diff-file
    resource: ../../src/frontend/components/diff/DiffFile.tsx
    title: src/frontend/components/diff/DiffFile.tsx
  - id: explorer
    resource: ../../src/frontend/components/Explorer.tsx
    title: src/frontend/components/Explorer.tsx
  - id: backlog-section
    resource: ../../src/frontend/components/BacklogSection.tsx
    title: src/frontend/components/BacklogSection.tsx
  - id: task-120
    resource: "../../backlog/tasks/task-120 - File-viewer-Show-in-Finder.md"
    title: "TASK-120 — File viewer: Show in Finder"
  - id: task-131
    resource: "../../backlog/tasks/task-131 - Show-in-Finder-from-diffs-and-Explorer-rows.md"
    title: "TASK-131 — Show in Finder from diffs and Explorer rows"
---

# Where it is offered

The daemon selects a path in a Finder window on its own machine. The browser cannot do that itself, so every surface asks the daemon.[^task-120][^task-131]

| Surface | How | What it shows |
| --- | --- | --- |
| File tab ([file viewer](/modules/file-viewer.md)) | toolbar button | the open file |
| Working-tree diff: a diff tab, and each file of the Changes diff | button on the file header | that file; none for a deleted one |
| Explorer, Changes | right-click a file | that file; not a deleted one, not a directory |
| Explorer, Files | right-click any entry | the file or directory, [ignored ones](/modules/file-listing.md) included |
| Explorer, Backlog | right-click a card | the task's `.md` |

A commit's diff and a commit's File Tree offer nothing. They show a file as it was at that commit, which may not be what is on disk now, or may be gone.[^diff-file]

In the Changes tree a directory is only a grouping of changed paths and may itself have been deleted, so it gets no menu.[^task-131]

# One gate

`useRevealInFinder(root)` returns a function, or `undefined` where Finder cannot be shown. Every surface treats `undefined` as "draw nothing", so the rule lives in one place.[^use-reveal]

The rule is `canRevealInFinder`: a desktop Mac browser (no touch screen, which rules out iPadOS) that reached the daemon at `localhost`, `127.x` or `[::1]`. It is a guess from the page's host, there to keep the button off screens where it could never work.[^platform]

Where the gate is off, a row has no context-menu handler at all, so a right-click opens the browser's own menu as on any other page.[^use-reveal]

A reveal that fails is reported in a toast with the server's words.[^use-reveal]

# One menu per list

`useRevealMenu(root)` gives a section a row handler and the props of a single `PointMenu`, opened at the pointer for whichever row was right-clicked. A tree can hold thousands of rows, and a Radix menu root around each would be paid for by every row for a menu at most one is showing.[^use-reveal]

The menu is mounted beside the section, not inside it. React events cross a portal, and a section's wrapper listens for clicks to drive preview and pin.[^explorer][^backlog-section]

An open menu does not outlive its rows. A section swaps its tree for a note when the list empties or a refetch fails, and the menu goes with it; `PointMenu` reports an unmount while open as a dismissal, so the section is not left holding a menu that reopens when the tree returns.[^point-menu] The sections are not remounted per root, so the hook also closes the menu when the root changes under it: the path it names belongs to the old root.[^use-reveal]

# The route

`POST /api/{tasks,projects}/:id/reveal` with `{ file }` runs `/usr/bin/open -R` and answers 204.[^files-route] It refuses, before spawning anything:

| Status | When |
| --- | --- |
| 403 | the peer is not loopback: a Finder window would open on a screen nobody is looking at |
| 400 | no path, a path that escapes the root, or a symlink that resolves outside it |
| 404 | nothing is there |
| 501 | the daemon is not on macOS |

After the spawn: 504 when `open` has not answered in ten seconds, 500 with its stderr when it failed. Directories are valid paths.[^files-route]

The absolute `/usr/bin/open` is used so a launchd `PATH` or a user's shim cannot change what runs.[^files-route]

# Not yet

- The file tree inside a Changes tab (the diff's own sidebar) has no right-click menu; its file headers have the button.
- A tab's right-click menu does not offer it.

[^use-reveal]: src/frontend/hooks/use-reveal.ts
[^point-menu]: src/frontend/components/v2/DropdownMenu.tsx
[^platform]: src/frontend/utils/platform.ts
[^files-route]: src/api/files.ts
[^diff-file]: src/frontend/components/diff/DiffFile.tsx
[^explorer]: src/frontend/components/Explorer.tsx
[^backlog-section]: src/frontend/components/BacklogSection.tsx
[^task-120]: TASK-120 — File viewer: Show in Finder
[^task-131]: TASK-131 — Show in Finder from diffs and Explorer rows
