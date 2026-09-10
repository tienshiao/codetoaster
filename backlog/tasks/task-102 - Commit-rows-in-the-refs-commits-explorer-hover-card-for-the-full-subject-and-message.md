---
id: TASK-102
title: >-
  Commit rows in the refs/commits explorer: hover card for the full subject and
  message
status: Done
assignee:
  - '@claude'
created_date: '2026-09-10 07:44'
updated_date: '2026-09-10 08:06'
labels:
  - frontend
dependencies: []
ordinal: 106000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
In the history view (src/frontend/components/git/CommitList.tsx) the subject is a truncated span next to the graph, refs, author and date, and at the explorer's width it is cut off for nearly every commit. Only the date has a title attribute today. Add a hover/mouseover that shows the full subject line and the rest of the commit message (body), plus SHA and author/date. Compose from components/v2; TaskHoverCard in components/v2 should set the pattern for placement, delay and dismissal. The body is not in the log row payload today (check the /log route in src/api and use-git-log); either include it in the log rows or fetch it lazily on hover via the existing commit-detail endpoint. Keep the row itself unchanged and keyboard navigation intact.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Hovering a truncated commit row shows a card with the untruncated subject
- [x] #2 The card also shows the commit body when there is one, and the SHA, author and date
- [x] #3 Whether the card shows for every row or only truncated/bodied rows is a deliberate rule, documented in a comment
- [x] #4 Card opens after a short delay, follows the v2 hover-card conventions, and never steals focus or blocks clicking the row
- [x] #5 The Local Changes pseudo-row gets no card unless it has something extra to show
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Server: append %x1f%b to LOG_FORMAT in src/api/git.ts; parseLogOutput reads the eighth field as body (trailing whitespace trimmed, empty when absent so a 7-field record still parses). GitLogCommit gains body: string. Parser tests. 2. Frontend: move useHoverPointer and the open/close delay constants out of TaskHoverCard.tsx into hooks/use-hover-pointer.ts so both cards share one rule. New components/git/CommitHoverCard.tsx on radix HoverCard with the same delays and pointer-events-none content: full subject, body when non-empty (pre-wrap, clamped height), then a fact block with sha, author, absolute date. 3. CommitList.tsx: CommitRow's button becomes the card trigger. Rule, in a comment: every commit row gets a card, always, because the compact rail hides author and sha for every row so the card always has something the row does not, and a rule that measured truncation would flicker as the panel resizes. The Local Changes row gets none. 4. Tests: CommitHoverCard.render.tsx with controlled open, following TaskHoverCard.render.tsx.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
The log row now carries the message body, and every commit row gets a hover card built from the task card's parts.

Server: LOG_FORMAT gained %x1f%b and parseLogOutput reads the body as everything after the seventh field (fields.slice(7).join("\x1f")), trailing whitespace trimmed — so a separator pasted into a message rejoins rather than truncating it, and a seven-field record from the older format still parses with body "". GitLogCommit gained body: string on both sides (src/api/git.ts, src/frontend/types/git.ts); the two GitLogCommit fixtures in palette-items.test.ts were updated. Four new parser tests cover a multi-line body, a subject-only commit (git's own trailing newline must not read as 'there is a body'), a seven-field record, and an embedded separator.

Frontend: useHoverPointer and the open/close delays moved out of TaskHoverCard into src/frontend/hooks/use-hover-pointer.ts (HOVER_OPEN_DELAY/HOVER_CLOSE_DELAY), and the card panel class plus the dt/dd Fact moved into components/v2/HoverCardParts.tsx, so the two cards cannot drift apart in delay or chrome. CommitHoverCard (components/git) is the same Radix arrangement — asChild trigger, portal, pointer-events-none content, side=right align=start, controlled open for tests — showing the full subject, the body in whitespace-pre-wrap clamped to max-h-48, then SHA (first 8, mono), Author and Date. CommitList wraps every CommitRow button in it, with a comment stating the rule: always, because the compact rail drops author and sha from every row and a truncation-measured rule would flicker as the panel resizes. The Local Changes pseudo-row is deliberately left bare, with a comment saying why. memo is untouched — commit is stable per commits array — and the row keeps its own onClick, asserted in the test.

Tests: bun test src/api src/frontend → 722 pass / 0 fail; bun run test:render → 30 files, 334 pass (7 of them the new CommitHoverCard.render.tsx). bunx tsc --noEmit is clean for these files (the one error reported is in src/lib/tasks/watcher.test.ts, another agent's in-flight work). Deviation: the body block uses text-xs text-subtle-foreground rather than text-micro, matching the task card's preview paragraph; the fact block is text-micro as specified. Hover timing and placement were not re-verified in a browser — both are inherited unchanged from the verified task card.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Commit rows in the history rail and tab get a hover card with the full subject, the body, sha, author and absolute date. The log format now carries %b and the parser keeps a 7-field record working with an empty body. The card is built from the same pieces as the task card: useHoverPointer and the delays moved to hooks/use-hover-pointer.ts, the panel class and Fact to components/v2/HoverCardParts.tsx. Every commit row gets a card, by rule and comment; the Local Changes row gets none. Verified with parser tests in git.test.ts and CommitHoverCard.render.tsx under vitest.
<!-- SECTION:FINAL_SUMMARY:END -->
