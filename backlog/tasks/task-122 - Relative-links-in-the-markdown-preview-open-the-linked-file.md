---
id: TASK-122
title: Relative links in the markdown preview open the linked file
status: In Progress
assignee:
  - '@tma'
created_date: '2026-10-03 00:28'
updated_date: '2026-10-03 00:53'
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
- [ ] #1 A relative link in the preview opens the linked file, resolved against the current file's directory, in a file tab
- [ ] #2 A root-absolute link resolves to the first existing file under the repo root or one of the current file's ancestor directories, so a wiki's /page.md links work
- [ ] #3 Percent-escapes are decoded and an extensionless link falls back to the .md page when the exact path is not a file
- [ ] #4 External links open in a new browser tab; fragment-only links do not change the app URL
- [ ] #5 Resolution has unit tests; link activation has a rendering test
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. utils/markdown-links.ts (DOM-free): isExternalHref, resolveMarkdownLink(href, fromFile, files) returning a repo-relative path (plus line for #L12) or null. Relative hrefs resolve against the file's dir; /-prefixed ones try every ancestor from the repo root inward. Per base: exact, then .md, then README.md/index.md inside; first in the file set wins, else the first base's plain path. Paths escaping the root are null. 2. MarkdownPreview: an a component (module-level, stable identity) reading the click handler from a context fed by a latest-ref, so the memoized body does not re-render on a new callback. External gets target _blank; fragment-only is preventDefault; others preventDefault and call onOpenLink(href). 3. FileContent passes onOpenLink through; FilePane resolves it against useTaskFiles via indexFiles and calls onOpenFile. 4. Unit tests for the resolver, render test for activation.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Review pass 1 (code-review high) fixed: wiki root before repo root for / links (atlas's /index.md vs a root README); fragment links scroll in-preview so GFM footnotes work; file list fetched on click via ensureTaskFiles (no observer, no load race); ./, ../, / and trailing-slash links open README.md/index.md. Deferred: cross-page heading fragments (headings have no ids) and relative image sources. Declined: colons in page names are treated as schemes. Validation: bun run test green, tsc clean; in Chrome on an isolated server every link form in wiki/modules/markdown-preview.md opened the right tab, the footnote scrolled, the app URL never changed.
<!-- SECTION:NOTES:END -->
