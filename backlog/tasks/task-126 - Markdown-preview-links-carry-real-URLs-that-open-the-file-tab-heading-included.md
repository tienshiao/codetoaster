---
id: TASK-126
title: >-
  Markdown preview links carry real URLs that open the file tab, heading
  included
status: Done
assignee:
  - '@tma'
created_date: '2026-10-03 02:19'
updated_date: '2026-10-03 02:47'
labels:
  - frontend
dependencies:
  - TASK-124
ordinal: 128000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Right-click Open in new tab, Copy link address, cmd-click and middle-click act on a link's href without any page JavaScript, and the preview's links keep the raw markdown href, which resolves against the app URL and 404s. The task route already ensures a tab from ?tab=<key>; give each repository link in a task's preview an href of /t/<slug>?tab=file:<path>, extended with line and anchor so a #L12 or #heading link opens at that place, and let modified and middle clicks follow it natively. Plain left-click keeps resolving on click. Project roots (the composer's Explorer) have no such route and keep today's behaviour.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A repository link in a task's preview has an href that opens that file tab at /t/<slug>?tab=file:<path>
- [x] #2 A heading or #L link's href carries anchor or line, and opening it lands on that heading or line
- [x] #3 Cmd/ctrl/shift-click and middle-click open the link's URL in a new browser tab; a plain click still opens the tab in place
- [x] #4 The URL round-trips through the router's search parsing, including anchors that look like numbers
- [x] #5 Unit test for the URL builder and parser; rendering tests for href and click handling
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. utils/tab-link.ts: fileTabHref(base, {path, line, anchor}) via the router's defaultStringifySearch, and parseTabSearch for the route's validateSearch (tab, line, anchor), round-trip tested with defaultParseSearch. 2. Route passes line and anchor beside pendingTab; TaskShell's ensure merges them into a file descriptor with anchorAt, token covering all three. 3. TaskShell hands TabPane a fileLinkBase (/t/<buildTaskSlug>) for a task root; FilePane builds hrefFor from the cached file list (disabled useTaskFiles observer, one prefetch when a task preview opens) and resolveMarkdownLink; fragments get this file's URL. 4. MarkdownLink renders the real href when there is one; modified and middle clicks fall through to the browser, plain clicks keep the async path. 5. Tests.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
utils/tab-link.ts builds /t/<slug>?tab=file:<path>[&line|&anchor] with the router's defaultStringifySearch and parses it for validateSearch, so number-looking anchors round-trip. TaskShell hands TabPane the titled task URL; TaskShell's ?tab= ensure merges line and anchor (stamped anchorAt). FilePane's hrefFor reads the cached listing through a disabled useTaskFiles observer and prefetches once when a task's markdown preview opens; plain clicks still resolve on click. Review fixes: #L12 into markdown lands on the preview block holding the line (blocks carry data-source-line, frontmatter offset applied), same-file #L is a line; a / link missing everywhere falls back to the repo root unless the bundle is a real wiki (index.md + log.md); the heading pin also releases when the scroller moves off where it put it; [top](#) scrolls to the top; unprefixed ids are not anchors; CSV heading requests are spent; rootImageUrl shared. Declined: moving the one-shot request out of the persisted descriptor (needs a new layout reducer; current layers are tested), and memoizing hrefs per listing (the set is cached per response). Validation: bun run test 1950 unit and 485 render green, tsc clean; Chrome: a ?tab URL opened the file at its heading, a link's URL in a fresh tab and a real cmd-click both landed on testing.md at the heading, a markdown #L4 link flashed the log's first entry.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Repository and fragment links in a task's markdown preview carry /t/<slug>?tab=file:<path> URLs with line or anchor, which the task route opens and lands, so open-in-new-tab, copy link, cmd-click and middle-click work; plain clicks open in place as before. #L links land in the rendered preview too. Covered by URL round-trip unit tests, FilePane/TaskShell/MarkdownPreview rendering tests, and checked in Chrome.
<!-- SECTION:FINAL_SUMMARY:END -->
