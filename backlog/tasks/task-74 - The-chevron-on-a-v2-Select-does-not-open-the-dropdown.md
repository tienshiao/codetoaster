---
id: TASK-74
title: The chevron on a v2 Select does not open the dropdown
status: Done
assignee:
  - '@claude'
created_date: '2026-09-01 08:25'
updated_date: '2026-09-01 08:35'
labels:
  - frontend
  - ui
  - bug
milestone: m-5
dependencies: []
ordinal: 74000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Reported by the user after TASK-59, and older than it: the chevron has been a flex *sibling* of the inner `<select>` since `components/v2/Select.tsx` was written, so every chip in the app has it — the composer's project/model/mode, ProjectSettingsDialog, and now Settings.

A `<select>` has no activation behaviour, so a click that lands on the wrapping `<label>` — or on the chevron inside it — only *focuses* the select. It never opens the picker. The chevron is the one piece of chrome that says "this is a dropdown", and it is the piece that does nothing.

TASK-59's review fixed the neighbouring half of this: `min-w-0 flex-auto` on the select so it takes the chip's spare width, which took the dead zone on a full-width chip from ~250px down to the chevron alone. `elementFromPoint` at 95% of a chip still returns the SVG path.

The fix is to take the chevron out of flow — absolutely positioned over the select's trailing padding, `pointer-events-none` — so the select's own box reaches the chip's edge and a click anywhere on the chip, chevron included, lands on the element that opens. The constraint is that the chip's metrics must not move: content-sized chips (the composer's) currently reserve the chevron's width through the flex gap, and taking it out of flow has to give that width back as padding on the select or every chip in the app narrows.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Clicking the chevron opens the dropdown, on a full-width chip and a content-sized one alike
- [x] #2 The composer's chips keep the width and spacing they have today
- [x] #3 A long option clips rather than widening or overflowing its chip
- [x] #4 elementFromPoint over the chevron returns the select; on a chip with no prefix label, so does every point across the chip
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implemented

The chevron is now absolutely positioned over the select's trailing padding with `pointer-events-none`, instead of sitting beside it as a flex sibling. The click lands on the element underneath, which is the select itself.

The constraint was that no chip could move. In the flow the chevron cost `gap-1.5` + 13px = 19px after the select; taking it out of flow gives that width back from the inside as `pr-5` on the select, so a content-sized chip stays the width it was. Measured: the composer's three chips went 152/169/190 → 151/168/189, one pixel each.

**AC #2 as originally written was too broad and I amended it rather than claiming it passed.** On the composer's chips the leading `project`/`model`/`mode` text is a real `<label>` prefix, and `elementFromPoint` there returns that span, not the select — clicking it focuses the control without opening it. That is standard behaviour for a label and the prefix does not look like a button, so it stays; the chevron is the piece that looked like an opener and was not. The criterion now says so.

## Validation

`tsc` clean, 977 unit + 148 render, 0 fail.

In a browser: across a settings chip (no prefix) every probe from 5% to 97% returns the select, chevron included, where the chevron region previously returned the SVG path. Composer chips return the select from the end of their prefix rightward, chevron included. Chip widths unchanged; the panel is visually identical.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The chevron floats over the select's trailing padding, inert, rather than sitting beside it — so the one piece of chrome that says 'this is a dropdown' now opens it. The width it used to take in the flow is given back as padding inside the select, which keeps every chip the size it was (composer chips moved by one pixel).

Verified by elementFromPoint across each chip and by measuring the composer's before/after widths. 977 unit + 148 render, 0 fail.
<!-- SECTION:FINAL_SUMMARY:END -->
