---
id: TASK-127
title: >-
  A commit's File Tree views files the way a file tab does: preview, links,
  symbols
status: Done
assignee: []
created_date: '2026-10-03 19:06'
updated_date: '2026-10-03 19:34'
labels: []
dependencies: []
ordinal: 129000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A commit tab's File Tree mode draws the source of a file and nothing else. A file tab opened from the Explorer has a Preview toggle (rendered markdown, CSV and TSV as a table), markdown links and images that resolve against the repository, heading and line jumps, a remembered scroll position, and ⌘/Ctrl-click to a symbol's definitions and references. None of that is there when the same file is read at a commit. Give the commit's tree the same viewer, with everything scoped to that commit: links and images resolve against the commit's tree, and symbols come from an index of the commit's files rather than the working tree.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A markdown file selected in a commit's File Tree has a Preview toggle and renders as it does in a file tab, frontmatter header and mermaid included
- [x] #2 A CSV or TSV file selected there renders as a table under the same toggle
- [x] #3 A repository link in that preview selects the linked file in the same commit's tree, at its line or heading, resolved against the commit's file list; a link to a file the commit does not have says so and selects nothing
- [x] #4 A repository image in that preview loads the blob from the commit, not the working tree
- [x] #5 ⌘/Ctrl-click on a symbol lists definitions and references found in the commit's files, and choosing one selects that file in the tree at that line; a symbol that only exists in the working tree is not listed
- [x] #6 Scroll position per file and per mode survives switching files, tabs and a reload, as in a file tab
- [x] #7 The file tab itself behaves as before
- [x] #8 Tests cover the commit symbol index and the tree's viewer; the wiki says how a commit's files are viewed
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Server: a symbol source over one commit (tree listing plus batched blob reads), marked immutable so the store builds it once and caches it apart from working trees; the symbols route takes sha. 2. Extract the file tab's viewer (toolbar, FileContent, link and image resolution, symbol popover) into FileViewer, with content, file list, state and open-file as props; FilePane becomes the working-tree binding. 3. CommitTree binds FileViewer to a commit: content from the blob, links and images against the commit's tree, symbols with sha, state in the commit slot, an opened file selected in the tree. 4. Tests for the commit source, the routes and the tree; wiki page.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Decisions. Preview and Wrap in the tree are task-wide prefs, since one viewer shows every file; scroll offsets and the position a link or definition asked for (treeTarget) are per commit. A link or definition target stays inside the commit and is refused with a toast when the commit lacks the file. Preview links keep the raw href there: a file at a commit has no URL of its own. Commit indexes have their own LRU of 3 so browsing history does not evict a working tree's index. The image-at-ref route moved off the Bun shell onto the raw spawn helper, because a preview requests all its images together. Left out: Show changes from the tree (the Changes mode cannot be told which file to scroll to in all-files mode) and symbols in the commit's two diff modes.

Code review (high) on the branch found ten items. Fixed: an unreadable blob now fails an immutable build instead of leaving a cached index that silently lacks files; both spawns time out; the build yields a real turn of the event loop every 25 files; the symbol popover reports a failed lookup instead of nothing found; a line the tree was sent to is spent once scrolled to; the image-at-ref route puts end-of-options before the ref and caches a full hash. Declined: reusing parsed entries across commits by blob id (a real speedup, but a different cache design), a bulk-read method on the source interface in place of read-ahead, and folding the three is-the-preview-showing checks into one.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A commit's File Tree now reads a file with the same viewer as a file tab (FileViewer, extracted from FilePane): Preview for markdown and CSV/TSV, markdown links and images resolved against the commit's tree, heading and line jumps, scroll memory, and symbol lookup from an index of the commit's own files (symbols route with sha). A followed link or definition selects the file in the same tree. Verified with both test suites, the type-check, and in a browser against an isolated server.
<!-- SECTION:FINAL_SUMMARY:END -->
