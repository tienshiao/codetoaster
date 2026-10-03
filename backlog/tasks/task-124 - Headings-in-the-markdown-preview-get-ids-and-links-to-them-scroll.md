---
id: TASK-124
title: 'Headings in the markdown preview get ids, and links to them scroll'
status: In Progress
assignee:
  - '@tma'
created_date: '2026-10-03 01:08'
updated_date: '2026-10-03 01:20'
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. markdown-links.ts: headingSlug (GitHub style, deduped by the caller) and anchorKey (loose: drop markdown-header-, lowercase, non-alphanumeric runs to -), so GitHub and Bitbucket fragments meet one key; resolveMarkdownLink returns anchor for a non-line fragment. 2. MarkdownPreview: a rehype plugin gives h1-h6 ids user-content-<slug> with -1/-2 dedupe; findAnchor tries the exact id (prefixed, then raw for footnotes), then the loose key over headings; an in-page link scrolls through it. A jump prop {anchor, seq} scrolls once per seq. 3. file descriptor gains anchor (validated on restore, not in the key); TabPane passes it; FilePane turns anchor changes into jumps, and a link to its own file jumps locally so a repeat click scrolls again. FileContent forwards the jump and skips scroll restore when it carries one. 4. Unit tests for slug and key; rendering tests for in-page scroll, jump on mount, Bitbucket alias, dedupe.
<!-- SECTION:PLAN:END -->
