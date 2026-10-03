---
id: TASK-123
title: Seed a Karpathy-style LLM wiki under /wiki
status: To Do
assignee: []
created_date: '2026-10-03 00:43'
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
- [ ] #1 wiki/index.md lists every page by type, and wiki/log.md records the initial compile
- [ ] #2 wiki/conventions/wiki-maintenance.md states the page schema and the ingest, query and lint procedures
- [ ] #3 Pages carry type, title, description, status: draft, generated and sources frontmatter, with footnote citations
- [ ] #4 Links between pages are bundle-relative and every one resolves to a page that exists
- [ ] #5 CLAUDE.md points agents at the wiki and says when to update it
<!-- AC:END -->
