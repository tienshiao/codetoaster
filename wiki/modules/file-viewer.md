---
type: Module
title: File viewer
description: A file tab and a commit's File Tree draw a file with the same viewer; the tab reads the working tree, the tree reads one commit, including its own symbol index.
tags: [files, commit, symbols, preview, frontend]
level: project
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-03T19:40:00Z }
sources:
  - id: viewer
    resource: ../../src/frontend/components/file/FileViewer.tsx
    title: src/frontend/components/file/FileViewer.tsx
  - id: file-pane
    resource: ../../src/frontend/components/tabs/panes/FilePane.tsx
    title: src/frontend/components/tabs/panes/FilePane.tsx
  - id: commit-tree
    resource: ../../src/frontend/components/git/CommitTree.tsx
    title: src/frontend/components/git/CommitTree.tsx
  - id: commit-source
    resource: ../../src/lib/symbols/commitSource.ts
    title: src/lib/symbols/commitSource.ts
  - id: store
    resource: ../../src/lib/symbols/store.ts
    title: src/lib/symbols/store.ts
  - id: task-127
    resource: "../../backlog/tasks/task-127 - A-commits-File-Tree-views-files-the-way-a-file-tab-does-preview-links-symbols.md"
    title: "TASK-127 — A commit's File Tree views files the way a file tab does: preview, links, symbols"
---

# One viewer, two readers

A file is read in two places: a file tab, opened from the Explorer, and the File Tree mode of a commit tab. Both draw it with `FileViewer`, so what one can do the other can:[^viewer][^task-127]

- the toolbar: Preview for markdown, CSV and TSV; Wrap
- the [markdown preview](/modules/markdown-preview.md), with its links, images and heading jumps
- ⌘/Ctrl-click on a symbol, for its definitions and references
- a scroll position remembered per file and per mode

Before TASK-127 the commit's tree drew the bare source and nothing else, because the rest lived inside the file tab's pane. The viewer holds none of the things that differ. They arrive as props:[^file-pane][^commit-tree]

| | File tab (`FilePane`) | Commit's File Tree (`CommitTree`) |
| --- | --- | --- |
| Content | working tree | the blob at the commit |
| File list for links and images | the Explorer's listing, fetched at a click | the commit's tree, already loaded |
| Images | working-tree image endpoint | `image/git` at the commit |
| Symbols | the working tree's index | an index of the commit's files |
| State | the `file:<path>` slot | the `commit:<sha>` slot; Wrap and Preview in `prefs` |
| An opened file | another tab | selected in the same tree |
| Extra buttons | Show changes, Show in Finder | none |

A file tab is one tab per file. The tree has one viewer for every file it shows, so its Wrap and Preview toggles are task-wide, and its scroll offsets are a map in the commit's slot.[^commit-tree]

# Staying inside the commit

A link or a definition followed in the tree selects the target in that tree, at its line or heading. It never opens a working-tree tab: the reader asked about this commit, and the file may be different now or gone.[^commit-tree]

- The position (line, heading, when it was asked for) is stored beside the selection as `treeTarget`. Picking a file from the tree clears it, so the file opens where it was left.
- A line is landed on once, as a heading is. The viewer remounts on every mode switch, tab switch and reload, and a line still standing would pull each of those back over the reader's place. A file tab still does this with the line on its descriptor.
- A target the commit does not have is refused with a toast. Selecting it would only have the tree clear the selection again.
- Links keep their raw `href`. A file at a commit has no URL of its own, so a modified click is kept from the browser rather than sent to a route that does not exist.

# Symbols at a commit

`GET …/symbols?name=&sha=` answers from the commit's files.[^commit-source] The store that indexes a working tree takes its files from a `ProjectSource`; a commit is another source:

- `ls-tree -r -l` lists the blobs with their sizes. Symlinks and submodules are left out.
- Blobs are read with `cat-file --batch`, about 8 MB at a time. The store asks for one file after another in listing order, so each read fetches the files that follow it too. One spawn per file would be a `git show` for every source file in the repository.
- The source is marked `immutable`. The store builds it once, never revalidates it, and keeps it in a cache of its own (three commits), so paging through history does not evict the working tree's index.[^store]
- A build that fails is dropped rather than kept, and a blob that cannot be read fails the build. Nothing revalidates an immutable index, so a file skipped once would be missing for as long as the index stayed cached, and a symbol in it would read as "no such symbol". A working tree's unreadable file is still skipped: the next revalidation picks it up.
- Both git calls are killed after a minute. An index that is still building is never evicted, so a git that hung would hold every later lookup at that commit.
- The build yields a turn of the event loop every 25 files. A batch is parsed from memory, with no file I/O between files to let terminals and other requests through.

On the client a commit's lookup is cached under its own key and never refetched.

# Not yet

- Show changes for a file in a commit's tree. The Changes mode beside it has no way to be told which file to scroll to.
- ⌘-click in a commit's Commit and Changes modes, which are diffs and still have no symbols.

[^viewer]: src/frontend/components/file/FileViewer.tsx
[^file-pane]: src/frontend/components/tabs/panes/FilePane.tsx
[^commit-tree]: src/frontend/components/git/CommitTree.tsx
[^commit-source]: src/lib/symbols/commitSource.ts
[^store]: src/lib/symbols/store.ts
[^task-127]: TASK-127 — A commit's File Tree views files the way a file tab does: preview, links, symbols
