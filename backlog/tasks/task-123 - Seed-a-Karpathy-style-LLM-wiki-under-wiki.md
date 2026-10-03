---
id: TASK-123
title: Seed a Karpathy-style LLM wiki under /wiki
status: Done
assignee:
  - '@tma'
created_date: '2026-10-03 00:43'
updated_date: '2026-10-03 01:08'
labels:
  - docs
dependencies:
  - TASK-122
ordinal: 125000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Give the repo its own LLM-maintained knowledge base in the OKF v0.2 shape the atlas repo uses: index.md, log.md, typed pages under conventions/, decisions/, gotchas/, modules/ and runbooks/, with frontmatter, footnote citations and bundle-relative links. Compiled from CLAUDE.md, backlog tasks and the code. Doubles as live test data for the markdown preview's link handling (TASK-122).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 wiki/index.md lists every page by type, and wiki/log.md records the initial compile
- [x] #2 wiki/conventions/wiki-maintenance.md states the page schema and the ingest, query and lint procedures
- [x] #3 Pages carry type, title, description, status: draft, generated and sources frontmatter, with footnote citations
- [x] #4 Links between pages are bundle-relative and every one resolves to a page that exists
- [x] #5 CLAUDE.md points agents at the wiki and says when to update it
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Pages are compiled from CLAUDE.md, backlog tasks and the code, and checked against the code (GraphState wording corrected against commitGraph.ts; uncited claims removed). wiki/modules/markdown-preview.md carries a section with every link form as test data, plus footnotes and a mermaid diagram; mermaid rejects href as a node id and # in edge labels, which is why the diagram uses link and fragment. wiki-links.test.ts runs every link through resolveMarkdownLink against the real tree and was shown to fail on a planted broken link.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Seeded wiki/ as an OKF v0.2 LLM wiki: index, log, the wiki-maintenance schema, and 13 pages across modules, conventions, decisions, gotchas and runbooks, all status draft. CLAUDE.md gains a Knowledge wiki section. wiki-links.test.ts lints every link with the preview's resolver, so the wiki doubles as live test data for TASK-122.
<!-- SECTION:FINAL_SUMMARY:END -->
