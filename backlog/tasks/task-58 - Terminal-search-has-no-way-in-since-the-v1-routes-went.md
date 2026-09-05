---
id: TASK-58
title: Terminal search has no way in since the v1 routes went
status: Done
assignee:
  - '@claude'
created_date: '2026-08-30 23:10'
updated_date: '2026-09-05 02:56'
labels:
  - frontend
milestone: m-5
dependencies: []
ordinal: 58000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`components/TerminalSearchBar.tsx` works and has no consumer. `AgentPane` and `ShellPane` both accept an `onSearchOpen` prop and neither is ever given one — `TabPane` renders `<AgentPane taskId visible />` (src/frontend/components/tabs/panes/TabPane.tsx:58) — and `Terminal.tsx` still raises the gesture. So the search UI, the plumbing and the xterm search addon are all present and unreachable.

Orphaned by TASK-21, which deleted the v1 session routes that rendered the bar; TASK-28 kept the component rather than deleting it, because losing a working feature is not the same as deleting v1 scaffolding.

What is missing is the decision TASK-28 had no business making: where search lives in the v2 shell. Options are a per-pane overlay (v1's shape, and what `onSearchOpen` already implies), or a strip affordance beside the split control. It also wants ⌘F, which is TASK-34's territory — worth doing together or in a deliberate order.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 ⌘F in a focused terminal tab opens search against that tab's terminal, and only that one
- [x] #2 Search is reachable without the keyboard
- [x] #3 Closing search returns focus to the terminal, and a split's two panes search independently
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Decision: search is a per-pane overlay owned by AgentPane/ShellPane (the shape onSearchOpen already implies), not strip state. Three doors converge on it: ⌘F from the focused terminal (Terminal.tsx custom key handler, as today), a Search icon in the strip's action cluster (mouse), and a 'Find in terminal' palette row. The strip and palette reach the pane through a searchRequest pulse addressed by tab id, mirroring focusRequest.
2. hooks/use-focus-request.ts: extract the rising-edge rule into usePulse(request, onRise); useFocusRequest becomes a caller. Add hooks/use-terminal-search.ts: open/close state, opens on a rising searchRequest, close() returns focus to the terminal handle, an activation counter so a second ⌘F re-focuses the input.
3. keymap.ts: isSearchOpenChord (⌘F / Ctrl+F) beside isSearchChord, and searchHint(mac) for the tooltip/palette caps. Terminal.tsx uses the predicate instead of its inline check.
4. Move components/TerminalSearchBar.tsx to components/tabs/panes/TerminalSearchBar.tsx; restyle with v2 tokens and IconButton (no zinc literals); bind ⌘G/⇧⌘G on the pane's root element rather than document so a split's two bars step independently; add activation prop.
5. AgentPane/ShellPane: take searchRequest; render the bar inside a relative wrapper; pass onSearchOpen to XTerminal. TabPane threads searchRequest to the terminal kinds only.
6. TabStrip: onSearch/searchDisabled → Search IconButton before Split, hint from searchHint on the focused strip. TabArea: onSearchTab(tab) prop, enabled only when the group's active tab is a terminal. TaskShell: searchPulse state, requestSearch(tabId), passes searchRequest to TabPane and onSearchTab to TabArea.
7. palette-items: 'Find in terminal' row (action search-terminal) when the active tab is a terminal; CommandPaletteHost dispatches it to onSearchTab.
8. Tests: keymap.test (chord predicate), palette-items.test (row present/absent), TabPane.render (rising searchRequest opens the bar; close refocuses the grid; a standing request on mount does not open), TabArea.render (button disabled on a non-terminal tab, calls onSearchTab with the active tab). Then browser verification of ⌘F, split independence, and focus return.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Decision: search is a per-pane overlay owned by AgentPane/ShellPane. ⌘F reaches it through the terminal's own key handler (Terminal.tsx → onSearchOpen), the strip's magnifier and the palette's 'Find in terminal' row reach it through a searchRequest pulse addressed by tab id, the same shape as focusRequest. ⌘F is deliberately not a SHELL_COMMANDS row: it is not a leader chord and belongs to whichever terminal has the caret; keymap.ts exposes isSearchOpenChord/searchHint/searchCaps so the terminal, the strip tooltip and the palette caps share one spelling. The ⌘G/⇧⌘G listener moved from document to the pane root so a split's two bars step independently. The bar moved to components/tabs/panes/ and was restyled onto v2 tokens + IconButton. usePulse was extracted from useFocusRequest so the mount-baseline rule lives once.

Validation: bunx tsc --noEmit clean; bun run test:unit 1186 pass; bun run test:render 247 pass (new: keymap chord tests, palette row present/absent, TabPane search pulse open/close/baseline, TabArea magnifier enabled/disabled/absent). Verified in Chrome against a foreground server: ⌘F opens the bar in the focused terminal with matches highlighted; ⌘G steps; Escape and the X both return focus to the xterm textarea; the magnifier greys out in front of a file tab and opens the bar when a terminal is in front; with the agent and a shell in a split, each bar keeps its own query/count and ⌘G steps only the pane holding the caret; the palette row opens (or re-activates) the active group's bar with the input focused. No console errors.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Terminal search is reachable again in the v2 shell. Each terminal pane owns its search bar; ⌘F in a focused terminal, the strip's magnifier and the palette's 'Find in terminal' row all open it, Escape/X close it and hand the caret back to the terminal, and a split's two panes search independently (⌘G scoped to the pane). Verified by typecheck, both test suites, and a browser run-through of every door.
<!-- SECTION:FINAL_SUMMARY:END -->
