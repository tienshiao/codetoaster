---
id: TASK-125
title: Relative image sources in the markdown preview load from the repository
status: Done
assignee:
  - '@tma'
created_date: '2026-10-03 01:08'
updated_date: '2026-10-03 02:07'
labels:
  - frontend
dependencies:
  - TASK-122
ordinal: 127000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up to TASK-122. An image like ![arch](diagrams/arch.png) in a previewed file resolves against the app URL and shows broken. Resolve the src the same way links are (markdown-links.ts) and point it at the working-tree image endpoint (rootApi(root)/image?file=). External and data: sources stay as they are.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A relative or /-prefixed image in the preview loads from the repository
- [x] #2 External and data: image sources are unchanged
- [x] #3 A rendering test covers the rewritten src
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. MarkdownPreview: an img component; external and data: sources pass through; anything else asks a resolveImage callback from the same context as links and renders once it answers. 2. FilePane: resolveImage fetches the file list (fetchTaskFiles), resolves the src with resolveMarkdownLink so images follow the same bundle and relative rules as links, and returns the working-tree image endpoint URL; stable via useCallback so images do not re-resolve on every pane render. 3. Rendering test: relative src rewritten through the callback, external and data: untouched, no callback leaves no broken request.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Images resolve through resolveMarkdownLink with the same bundle and relative rules as links, against the file list fetched on demand (filePathSet caches the Set per response), and load from rootApi/image?file=. Nothing is requested until the resolver answers; no resolver or no target leaves the alt text. data: sources never reach the component (react-markdown's URL policy). Validation: rendering tests in MarkdownPreview and FilePane; the wiki's /img/bundle-root.svg loads in Chrome via the endpoint.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Repository images in the markdown preview load: a relative or /-prefixed src resolves like a link and points at the working-tree image endpoint; external images are untouched. Covered by rendering tests and checked in Chrome.
<!-- SECTION:FINAL_SUMMARY:END -->
