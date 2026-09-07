---
id: TASK-95
title: >-
  The terminal's last column is clipped: xterm's DOM renderer over-spaces every
  cell
status: Done
assignee:
  - '@claude'
created_date: '2026-09-07 22:08'
updated_date: '2026-09-07 22:21'
labels:
  - frontend
  - bug
dependencies: []
ordinal: 99000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
In every terminal pane the rightmost column is cut off by several pixels (the 'e' in 'me' at the end of a 96-column line loses its right side). xterm 6's DOM renderer sizes the row at cols × cell width, where the cell width comes from canvas measureText (the linear advance, 9.0px for JetBrains Mono at 15px), then adds a default letter-spacing equal to cell width minus a DOM measurement of 'W' taken on an element with no letter-spacing declared. In Chrome, a run without an explicit letter-spacing advances narrower (8.9375px) than the same run with one (9.0px), and the rows do have one — so the correction is applied on top of an advance that was already right, and every cell renders 0.06–0.08px too wide. Over 96 columns that is 6–8px, most of the last glyph, for every bundled font at every size.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A 96-column line of text in the agent terminal renders its last glyph fully inside the pane, for the default font at its default size
- [x] #2 The cursor drawn in the last column sits over that column's glyph, not offset from it
- [x] #3 The fix is explained in a comment at the point it is applied, including why the measurement and the rendering disagreed
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add a CSS rule in index.css giving xterm's width-cache measure container an explicit letter-spacing: 0, so the 'W' it measures advances the way the rows it corrects do. 2. Force the row container's default letter-spacing to 0 so the residual from xterm's integer offsetWidth measurement cannot accumulate. 3. Verify in Chrome against an isolated server: row scrollWidth equals the screen width, last glyph intact.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Root cause measured in Chrome on the running app: CharSizeService (canvas measureText) gives the linear advance (9.0px @15px JetBrains Mono), WidthCache (DOM offsetWidth/32 on an element with no letter-spacing) gives 8.9375, and rows — which always carry an explicit letter-spacing — advance at 9.0. Default spacing came out +0.0625px/cell → 6px overflow at 96 cols; 6–8px per 96 cols for all five bundled fonts at 12–18px. Fix: one CSS rule giving .xterm-width-cache-measure-container an explicit letter-spacing: 0. Verified on an isolated server at 15px and 20px: rows' inline letter-spacing is now 0px, row scrollWidth equals row width (756 = 84 × 9), and a line filling the last column renders its last glyph whole.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added a CSS rule in index.css so xterm's width-cache measure container declares letter-spacing: 0, putting its 'W' measurement on the same Chrome shaping path as the rows it corrects. The renderer's default letter-spacing drops from +0.0625px/cell to 0, and the last column is no longer pushed past the row's overflow: hidden. Verified in Chrome against an isolated server: no row overflow at 15px or 20px, last glyph intact.
<!-- SECTION:FINAL_SUMMARY:END -->
