---
id: TASK-127
title: >-
  A commit's File Tree views files the way a file tab does: preview, links,
  symbols
status: In Progress
assignee: []
created_date: '2026-10-03 19:06'
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
- [ ] #1 A markdown file selected in a commit's File Tree has a Preview toggle and renders as it does in a file tab, frontmatter header and mermaid included
- [ ] #2 A CSV or TSV file selected there renders as a table under the same toggle
- [ ] #3 A repository link in that preview selects the linked file in the same commit's tree, at its line or heading, resolved against the commit's file list; a link to a file the commit does not have says so and selects nothing
- [ ] #4 A repository image in that preview loads the blob from the commit, not the working tree
- [ ] #5 ⌘/Ctrl-click on a symbol lists definitions and references found in the commit's files, and choosing one selects that file in the tree at that line; a symbol that only exists in the working tree is not listed
- [ ] #6 Scroll position per file and per mode survives switching files, tabs and a reload, as in a file tab
- [ ] #7 The file tab itself behaves as before
- [ ] #8 Tests cover the commit symbol index and the tree's viewer; the wiki says how a commit's files are viewed
<!-- AC:END -->
