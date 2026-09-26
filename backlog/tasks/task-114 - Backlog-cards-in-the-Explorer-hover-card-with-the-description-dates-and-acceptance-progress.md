---
id: TASK-114
title: >-
  Backlog cards in the Explorer: hover card with the description, dates and
  acceptance progress
status: Done
assignee:
  - '@claude'
created_date: '2026-09-26 02:57'
updated_date: '2026-09-26 04:09'
labels:
  - frontend
  - ui
  - backlog
dependencies: []
references:
  - src/frontend/components/BacklogSection.tsx
  - src/frontend/components/v2/HoverCardParts.tsx
  - src/frontend/components/git/CommitHoverCard.tsx
  - src/frontend/components/v2/TaskHoverCard.tsx
  - src/lib/backlog/read.ts
  - src/types/backlog.ts
ordinal: 116000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The Explorer's Backlog section (src/frontend/components/BacklogSection.tsx, TASK-85) draws each task as an id, a truncated title and priority/label chips, and at the rail's 272px width the title is cut off for most tasks while the assignee, the dates, the description and how far along the acceptance criteria are never appear at all. Scanning the list for a specific task means opening files one by one. The commit rows in the refs/commits explorer got a hover card for exactly this (TASK-102), and the task sidebar rows before them (TASK-97); the Backlog cards should get the same. Hovering a card opens a hover card beside the rail with what the row could not fit: the untruncated title, the task's description (the body under '## Description', wrapped and clamped in height like the commit body so a long one does not cover the list), and a fact block: status, priority, assignee, labels, created and updated dates, acceptance criteria progress as done/total, and the parent and dependency ids when present. Build it from HoverCardShell and Fact in src/frontend/components/v2/HoverCardParts.tsx so it inherits the delays, the pointer test, the portal and the display-only pointer-events-none panel; do not write a second Radix arrangement. Every card gets a hover card, by the same rule and for the same reason as the commit rows: the row drops the assignee, dates and description for every task, so the card always has something the row does not, and a rule that measured truncation would flicker as the panel resizes. Drop the button's native title attribute, which would otherwise double the card with a browser tooltip. The route (GET /api/tasks/:id/backlog, src/lib/backlog/read.ts) returns only frontmatter today; it already reads every file on each poll, so extend parseTaskFile and BacklogTask (src/types/backlog.ts) with the description, created_date, updated_date, dependencies, parent_task_id, and the acceptance-criteria counts parsed from the '- [x] #n' items under '## Acceptance Criteria'. A file with none of those must still parse as it does now, and a half-written file still skips a card rather than failing the list. Keep the card's click behaviour (open the .md in a preview file tab) and the grouping untouched.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Hovering a Backlog card for a moment opens a card to the right of the rail showing the untruncated title and the task's description, clamped in height when long
- [x] #2 The card shows status, priority, assignee, labels, created and updated dates, and acceptance criteria progress as done/total; parent and dependencies appear when the task has them, and a fact the task lacks is omitted rather than shown empty
- [x] #3 The card follows the v2 hover-card conventions through HoverCardShell: delayed open, portalled, display-only, never steals focus or blocks clicking the card underneath, and is skipped on a device that cannot hover
- [x] #4 Every Backlog card gets a hover card, and the rule is stated in a comment beside the row as it is for commit rows; the native title tooltip on the card is removed
- [x] #5 GET /api/tasks/:id/backlog carries the new fields; parser tests in src/lib/backlog/read.test.ts cover a file with a description and checked criteria, one with none of the new fields, and one with an unchecked-only list
- [x] #6 A rendering test for the new hover card covers its content from a task's fields with controlled open, and the existing BacklogSection tests still pass with the click intact
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Server: BacklogTask (src/types/backlog.ts) gains description (the '## Description' section body, marker comments stripped, trimmed, capped at 500 chars with an ellipsis since it ships per task on every 3s poll), createdDate and updatedDate (the frontmatter strings verbatim; they carry no timezone so they are shown, not parsed), dependencies (string[]), parent (parent_task_id or null), acceptance {done, total} counted from '- [x]'/'- [ ]' items inside the '## Acceptance Criteria' section only. parseTaskFile in src/lib/backlog/read.ts fills them; a file without them parses as before. Parser tests: description plus checked criteria, none of the new fields, unchecked-only list, a checklist outside the AC section not counted. 2. Frontend: new components/BacklogHoverCard.tsx over HoverCardShell and Fact from components/v2 (no second Radix arrangement): title in font-medium, description in a max-h-48 pre-wrap clamped paragraph like the commit body, then a text-micro fact block with Status, Priority, Assignee, Labels, Parent, Deps, Criteria (done/total), Created, Updated, each line omitted when the task lacks it. 3. BacklogSection: every BacklogCard button is wrapped in the hover card, with the always-on rule in a comment (the row drops assignee, dates and description for every task; a truncation-measured rule would flicker on resize); drop the native title attribute, keep aria-label and onClick. 4. Tests: BacklogHoverCard.render.tsx with controlled open following CommitHoverCard.render.tsx, including the click reaching the row; update BacklogTask fixtures in existing tests; both runners green, tsc clean. 5. Verify in a browser from an isolated server per the verify skill, then code review.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Server: BacklogTask gains description (capped 500 with ellipsis), createdDate, updatedDate, dependencies, parent, acceptance; parsed by small pure helpers parseDescription/parseAcceptance in read.ts over the body past the frontmatter (CRLF folded). Route test and parser tests extended. Frontend: BacklogHoverCard.tsx over HoverCardShell/Fact; BacklogSection wraps every BacklogCard with the always-on rule comment and drops the native title. Fixtures in TabPane.render.tsx and backlog-links.test.ts updated.

Verified: test:unit 1711 pass, test:render 393 pass, tsc clean. Browser check on an isolated server (port 4599, scratch db): hovering TASK-114 opens the card (flipped to the left of the rail since the Explorer sits at the right edge) with title, clamped description, Status/Assignee/Labels/Criteria 3/6 done/Created/Updated; widest label Assignee measures 46.5px in the 52px column so no label was shortened; clicking the card still opens the .md preview.

Review pass (code-review high) fixed four findings: FrontmatterBlock now carries body so read.ts no longer re-splits the file and trusts lineCount by convention (api/files.ts unaffected); section() skips fenced code so a quoted '## ' heading neither ends the description nor opens a fake criteria section; the clamped body paragraph moved into HoverCardParts as HoverCardBody, used by the commit and backlog cards; BacklogCard keeps the native title only where useHoverPointer says no card mounts, so a coarse-pointer device keeps its tooltip. Two section-level rendering tests pin the trigger wrapping, the absent title with a hover pointer, and the restored title without one. Declined: rendering the description as markdown (descriptions here are prose; the rendered file is one click away) and unifying TaskHoverCard's line-clamp-6 preview, which is a deliberate different rule. After the fixes: test:unit 1713 pass, test:render 395 pass, tsc clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Backlog cards in the Explorer get a hover card built from the shared HoverCardShell: the full title, the description clamped, and Status, Priority, Assignee, Labels, Parent, Deps, Criteria done/total, Created and Updated, each omitted when absent. The backlog route now carries description, dates, dependencies, parent and acceptance counts, parsed from the file body by fence-aware section helpers over the body the frontmatter extractor now returns. Every card gets one; the native title survives only where no card can mount. Verified with parser, route and rendering tests, in Chrome from an isolated server, and a code review whose findings were fixed.
<!-- SECTION:FINAL_SUMMARY:END -->
