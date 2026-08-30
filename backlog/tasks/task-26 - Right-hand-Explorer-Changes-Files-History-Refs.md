---
id: TASK-26
title: 'Right-hand Explorer: Changes, Files, History, Refs'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-29 00:03'
updated_date: '2026-08-30 05:52'
labels:
  - frontend
milestone: m-3
dependencies:
  - TASK-22
  - TASK-23
documentation:
  - docs/v2-architecture.md
ordinal: 26000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
frontend/components/Explorer.tsx (§7.1): a collapsible right sidebar hosting the trees that today occupy full tabs — the diff FileTree (Changes), the file browser tree (Files), CommitList/CommitGraph (History), and RefSidebar (Refs). Selections open tabs through the layout store: single click = preview tab, double click = pinned.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each of the four sections renders the existing tree component against the current task
- [ ] #2 Single-clicking an entry opens a preview tab of the right kind; double-click pins it
- [ ] #3 Clicking an entry whose tab is already open focuses it instead of duplicating
- [ ] #4 The Explorer collapses and remembers its collapsed state per device
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Build against `frontend/components/v2/` — the v2 design system is the new UI, not a parallel track (CLAUDE.md, "The v2 design system is the new UI"). `AppShell` and the shell components already exist from TASK-46; this task supplies their data. Do not extend `components/ui/` (v1 shadcn) for new surfaces.

Built and verified in a browser against a live daemon (see TASK-21 for why this work is batched with the route flip).

Verified holding:
- AC#2: single click opens an italic preview tab; a single click on a different file replaces it rather than adding; double-click pins it (italic -> upright in the strip).
- AC#3: re-clicking an already-open file focuses it, no duplicate tab. No extra check was needed — openTab already dedupes via findByKey(tabKey(descriptor)), and findByKey prefers the active group, so a split showing the same file twice focuses the copy you are looking at.
- Changes and Files render the real trees against the selected task; the rail's Changes count is the real changed-file count; 'Review all' opens the diffAll tab.
- The agent terminal survives every Explorer-driven tab switch (TabArea keeps terminal tabs mounted).

Commit was deliberately left out: every route in src/api/git.ts is a read-only GET, so there is no endpoint behind it and it would have been a dead control.

Found in verification and sent back for fixing: in the 271px Explorer panel the commit subject is squeezed to zero width. CommitList's author/time/sha columns are all shrink-0 (72 + 64 + 64) and the graph takes 36, leaving nothing for the only flex-1 child — so the message you scan a history for is invisible, and its overflowing ref chip paints over the author name.

Not yet verified: AC#4 (collapse state surviving a reload).
<!-- SECTION:NOTES:END -->
