---
id: TASK-21
title: 'Routing: /, /t/$slug, and ?tab= deep links'
status: To Do
assignee: []
created_date: '2026-08-29 00:02'
labels:
  - frontend
milestone: m-3
dependencies:
  - TASK-18
  - TASK-20
documentation:
  - docs/v2-architecture.md
ordinal: 21000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Shrink five routes to three (§7.3): `/` renders the composer pane inside the app shell; `/t/$slug` renders a task with tabs from the stored layout; `/t/$slug?tab=<tabKey>` ensures that tab exists and focuses it. Delete sessions.$slug.{diff,file,git}.tsx and the TAB_ROUTES / tabNavTarget / sessionNavTarget machinery in utils/session-nav.ts. slug.ts survives with task naming ({slugified-title}-{uuid}, id in the last 36 chars).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Only /, /t/$slug, and the ?tab= variant exist in routeTree.gen.ts
- [ ] #2 A ?tab= link to a not-yet-open tab opens and focuses it; to an open tab just focuses it
- [ ] #3 utils/session-nav.ts is deleted
- [ ] #4 Task slugs derive from title and id; a rename changes only the slug prefix and old links still resolve
<!-- AC:END -->
