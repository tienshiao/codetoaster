---
id: TASK-124
title: 'Headings in the markdown preview get ids, and links to them scroll'
status: To Do
assignee: []
created_date: '2026-10-03 01:08'
labels:
  - frontend
dependencies:
  - TASK-122
ordinal: 126000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up to TASK-122, raised in each of its three reviews. Headings have no ids, so an in-page [x](#setup) link has nothing to scroll to, and a fragment on a link to another page (guide.md#setup, Bitbucket's Home#markdown-header-led-api-2) is dropped, so the target opens at the top. Give headings GitHub-style slug ids (keeping react-markdown's user-content- clobber prefix in mind), match Bitbucket's markdown-header- prefix as an alias, and carry a non-line fragment through the file tab so the preview scrolls to it on open, including when the link points at the file already open.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An in-page heading link scrolls the preview to that heading
- [ ] #2 A link to another page's heading opens that page's preview scrolled to the heading
- [ ] #3 Bitbucket markdown-header- fragments resolve to the same heading
- [ ] #4 Unit tests for slugging; rendering test for scroll on open
<!-- AC:END -->
