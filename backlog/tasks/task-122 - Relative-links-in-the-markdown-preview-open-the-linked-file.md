---
id: TASK-122
title: Relative links in the markdown preview open the linked file
status: Done
assignee:
  - '@tma'
created_date: '2026-10-03 00:28'
updated_date: '2026-10-03 01:08'
labels:
  - frontend
dependencies: []
ordinal: 124000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Repos carrying a markdown wiki (Karpathy-style knowledge base, Bitbucket wiki export) link page to page. The preview renders those as plain anchors, so a click navigates the CodeToaster URL itself and 404s. A link should open the target in a file tab instead. Forms seen in real wikis: relative paths (services/archive.md), root-absolute paths that mean the wiki root rather than the repo root (/services/archive.md from wiki/index.md), extensionless page names with escaped spaces (LED%20API%203 for LED API 3.md), and fragments (#markdown-header-x).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A relative link in the preview opens the linked file, resolved against the current file's directory, in a file tab
- [x] #2 Percent-escapes are decoded and an extensionless link falls back to the .md page when the exact path is not a file
- [x] #3 External links open in a new browser tab; fragment-only links do not change the app URL
- [x] #4 Resolution has unit tests; link activation has a rendering test
- [x] #5 A root-absolute link resolves against the enclosing bundle (nearest ancestor with an index.md) before the repository root, and against the repository root when the file is in no bundle, so a wiki's /page.md links work
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. utils/markdown-links.ts (DOM-free): isExternalHref, resolveMarkdownLink(href, fromFile, files) returning a repo-relative path (plus line for #L12) or null. Relative hrefs resolve against the file's dir; /-prefixed ones try every ancestor from the repo root inward. Per base: exact, then .md, then README.md/index.md inside; first in the file set wins, else the first base's plain path. Paths escaping the root are null. 2. MarkdownPreview: an a component (module-level, stable identity) reading the click handler from a context fed by a latest-ref, so the memoized body does not re-render on a new callback. External gets target _blank; fragment-only is preventDefault; others preventDefault and call onOpenLink(href). 3. FileContent passes onOpenLink through; FilePane resolves it against useTaskFiles via indexFiles and calls onOpenFile. 4. Unit tests for the resolver, render test for activation.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Review pass 1 (code-review high) fixed: wiki root before repo root for / links (atlas's /index.md vs a root README); fragment links scroll in-preview so GFM footnotes work; file list fetched on click via ensureTaskFiles (no observer, no load race); ./, ../, / and trailing-slash links open README.md/index.md. Deferred: cross-page heading fragments (headings have no ids) and relative image sources. Declined: colons in page names are treated as schemes. Validation: bun run test green, tsc clean; in Chrome on an isolated server every link form in wiki/modules/markdown-preview.md opened the right tab, the footnote scrolled, the app URL never changed.

Review pass 3: a / link now uses its bundle (nearest ancestor with index.md) then the repo root, replacing outermost-ancestor-first, which picked outer docs pages and monorepo package READMEs; outside a bundle it means the repo root as on GitHub. Clicks use fetchQuery so an invalidated file list is refetched first. . and .. are directory links. normalize is shared with path-links (returns empty string for the root). An unresolvable link toasts instead of doing nothing. Follow-ups: TASK-124 heading ids and cross-page fragments, TASK-125 relative images. Not fixed: right-click open-in-new-tab still gets the app-relative href (no app URL opens a file tab); colons in page names read as a scheme. Final validation: bun run test 1931 unit and 445 render green, tsc clean, Chrome on an isolated server with a cold file list opened every link form correctly.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Links in the markdown preview open the files they name instead of navigating the app. Relative links resolve against the file's directory; / links against the enclosing wiki bundle (nearest index.md) then the repo root; extensionless pages find their .md; directory links open README/index; #L12 opens at a line. External links open a new browser tab; fragments scroll inside the preview (footnotes). The file list is fetched on click. Covered by resolver unit tests, a MarkdownPreview rendering test, wiki-links.test.ts over the real wiki, and checked in Chrome.
<!-- SECTION:FINAL_SUMMARY:END -->
