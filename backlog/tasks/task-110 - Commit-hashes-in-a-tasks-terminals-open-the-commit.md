---
id: TASK-110
title: Commit hashes in a task's terminals open the commit
status: Done
assignee:
  - '@claude'
created_date: '2026-09-17 22:39'
updated_date: '2026-09-17 23:02'
labels:
  - frontend
dependencies: []
ordinal: 112000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-86 links task ids and TASK-108/109 link file paths; a sha an agent prints is the third thing worth clicking. Unlike those two there is no local index to match against, so a hex token is verified against the repository before it becomes a link, and clicking one opens the existing commit tab at the resolved full sha.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A 7-40 char lowercase hex token that the repository resolves to a commit is a link; clicking it opens a commit tab
- [x] #2 The tab opens at the resolved full sha, so the same commit written short and long shares one tab
- [x] #3 A hex token that is not a commit is not a link, and neither is one inside a longer word or a uuid segment
- [x] #4 Verification is one request per hovered row and is cached per sha, so hovering the same row or sha again costs nothing
- [x] #5 Unit tests cover matching, boundaries and the resolver; a render test covers the open
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Add a stdin option to gitSpawn. Add a route git/objects that feeds candidate shas to cat-file batch-check over stdin, one peeled rev per line, and answers a map from each input to its resolved full sha, omitting whatever is missing or ambiguous. Add utils/commit-links.ts, where findCommitLinks matches lowercase hex of seven to forty chars with no word char or dash on either side, and createCommitLinkProvider takes a resolver so it stays DOM-free like the other two. Add hooks/use-commit-links.ts, whose resolver batches a row into one request, remembers every answer including the misses, and dedupes shas already in flight. Register it in TabPane via combineLinkProviders. Unit tests for matching, boundaries and the resolver, and a render test for the open.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
The resolver has two doors, peek and resolve, and that split is the whole of the bug this task nearly shipped with. xterm captures the hovered link on mousedown and activates it on mouseup, so a provider that answers a microtask later has nothing captured and the click is silently lost. The first version was async throughout, and in a browser the underline appeared while clicking did nothing. peek now answers any row whose hashes are already settled in the same turn, which is every hover after the first, so these links click exactly like the other two. Verified in Chrome against an isolated server on 4599, which is how the bug was found in the first place and how the fix was confirmed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Commit hashes in a task's terminals are links that open the existing commit tab.

The matcher takes lowercase hex of 7 to 40 chars with no word character or dash on either side, which excludes uuid segments, longer digests and CSS colours for free, and lets everything else through because only the repository can settle it.

A new route feeds a row's candidates to cat-file batch-check over one stdin and answers which are commits and at what full sha, so a tab is keyed on the whole hash and an abbreviation and its full form share one. The client remembers every answer including the misses, never a failure.

Verified with the full suites (1653 unit, 376 render) and tsc, and in Chrome against an isolated server: a real hash underlines and opens, 1234567 and deadbeef and a uuid do not, and the full hash focuses the tab the abbreviation opened.
<!-- SECTION:FINAL_SUMMARY:END -->
