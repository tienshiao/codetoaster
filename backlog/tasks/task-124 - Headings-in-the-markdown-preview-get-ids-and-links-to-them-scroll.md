---
id: TASK-124
title: 'Headings in the markdown preview get ids, and links to them scroll'
status: Done
assignee:
  - '@tma'
created_date: '2026-10-03 01:08'
updated_date: '2026-10-03 02:07'
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
- [x] #1 An in-page heading link scrolls the preview to that heading
- [x] #2 A link to another page's heading opens that page's preview scrolled to the heading
- [x] #3 Bitbucket markdown-header- fragments resolve to the same heading
- [x] #4 Unit tests for slugging; rendering test for scroll on open
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. markdown-links.ts: headingSlug (GitHub style, deduped by the caller) and anchorKey (loose: drop markdown-header-, lowercase, non-alphanumeric runs to -), so GitHub and Bitbucket fragments meet one key; resolveMarkdownLink returns anchor for a non-line fragment. 2. MarkdownPreview: a rehype plugin gives h1-h6 ids user-content-<slug> with -1/-2 dedupe; findAnchor tries the exact id (prefixed, then raw for footnotes), then the loose key over headings; an in-page link scrolls through it. A jump prop {anchor, seq} scrolls once per seq. 3. file descriptor gains anchor (validated on restore, not in the key); TabPane passes it; FilePane turns anchor changes into jumps, and a link to its own file jumps locally so a repeat click scrolls again. FileContent forwards the jump and skips scroll restore when it carries one. 4. Unit tests for slug and key; rendering tests for in-page scroll, jump on mount, Bitbucket alias, dedupe.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Headings get user-content-<GitHub slug> ids from a rehype plugin; createSlugger numbers repeats like github-slugger and reserves footnote ids; anchorKey lets Bitbucket markdown-header- fragments match. A cross-file anchor rides on the file descriptor with anchorAt (one request per stamp, outside the tab key); the pane records the last served stamp in persisted view state (jumpedAt) because file panes unmount when their tab is inactive. The preview pins the heading through late image/mermaid growth until the reader scrolls, clicks or types, or 3s. Review rounds fixed: replay on remount, pin cut short by the re-render and by StrictMode, duplicate and footnote-colliding ids, saved scroll lost when the heading is missing, a jump left pending in source view, a section index.md taken for the wiki root (bundle = nearest index.md with log.md, else outermost index.md). Validation: bun run test 1943 unit and 471 render green, tsc clean; Chrome on an isolated server: in-page, cross-page and Bitbucket jumps land; returning to the tab and reloading keep the reader's place; a repeat click jumps again.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Headings in the markdown preview have GitHub-style ids. In-page links scroll to them, links to another page's heading open it scrolled there (Bitbucket markdown-header- anchors included), and the heading is held in place while images and diagrams load. Each link follow is one request, so repeats work and returning to a tab keeps the reader's place. Covered by unit tests, MarkdownPreview and FilePane rendering tests, the wiki lint (anchors checked against headings), and checked in Chrome.
<!-- SECTION:FINAL_SUMMARY:END -->
