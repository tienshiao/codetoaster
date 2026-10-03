---
id: TASK-126
title: >-
  Markdown preview links carry real URLs that open the file tab, heading
  included
status: In Progress
assignee:
  - '@tma'
created_date: '2026-10-03 02:19'
updated_date: '2026-10-03 02:19'
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
- [ ] #1 A repository link in a task's preview has an href that opens that file tab at /t/<slug>?tab=file:<path>
- [ ] #2 A heading or #L link's href carries anchor or line, and opening it lands on that heading or line
- [ ] #3 Cmd/ctrl/shift-click and middle-click open the link's URL in a new browser tab; a plain click still opens the tab in place
- [ ] #4 The URL round-trips through the router's search parsing, including anchors that look like numbers
- [ ] #5 Unit test for the URL builder and parser; rendering tests for href and click handling
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. utils/tab-link.ts: fileTabHref(base, {path, line, anchor}) via the router's defaultStringifySearch, and parseTabSearch for the route's validateSearch (tab, line, anchor), round-trip tested with defaultParseSearch. 2. Route passes line and anchor beside pendingTab; TaskShell's ensure merges them into a file descriptor with anchorAt, token covering all three. 3. TaskShell hands TabPane a fileLinkBase (/t/<buildTaskSlug>) for a task root; FilePane builds hrefFor from the cached file list (disabled useTaskFiles observer, one prefetch when a task preview opens) and resolveMarkdownLink; fragments get this file's URL. 4. MarkdownLink renders the real href when there is one; modified and middle clicks fall through to the browser, plain clicks keep the async path. 5. Tests.
<!-- SECTION:PLAN:END -->
