---
id: TASK-119
title: 'File viewer: table view for CSV and TSV files'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-29 02:26'
updated_date: '2026-09-29 02:46'
labels:
  - frontend
dependencies: []
ordinal: 121000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A .csv or .tsv file opened in a file tab (from the Explorer or a terminal link, both land in FilePane) renders as a table by default, with the same eye toggle markdown uses to switch back to raw source. Large files stay responsive: rows are virtualized.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A .csv file opens as a table with the first row as a sticky header
- [x] #2 A .tsv file opens as a table split on tabs
- [x] #3 Quoted fields with embedded delimiters, doubled quotes and newlines parse as one cell (RFC 4180); CRLF and a leading BOM are handled
- [x] #4 The eye button toggles between the table and the raw source, per tab, like the markdown preview
- [x] #5 Rows are virtualized so a file with tens of thousands of rows scrolls without rendering every row
- [x] #6 Ragged rows (fewer or more cells than the header) render without breaking the grid
- [x] #7 Parser has unit tests; the table has a rendering test
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. utils/delimited.ts: RFC 4180 parser (quotes, doubled quotes, embedded newlines, CRLF, BOM), delimiter from extension. 2. components/file/TablePreview.tsx: useVirtualizer rows, sticky header, row-number gutter, column widths from sampled content, ragged rows padded. 3. FileContent/FilePane: extend the preview toggle to CSV/TSV (reuse markdownPreview view-state flag). 4. Tests: delimited.test.ts, TablePreview.render.tsx. 5. Verify in browser on an isolated server.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Decisions: detection by extension only (csv, tsv, tab), not content sniffing. TSV takes CSV quoting rules since spreadsheet exports quote. The preview flag stays named markdownPreview because it is persisted view state. TablePreview owns its scroll container: a parent ref attaches after the child layout effects, so the virtualizer found no scroll element and drew an empty body. Code review found that a file.csv:N link lost its line jump (table rows had no data-line); rows now carry rowLines and the table scrolls to and flashes the row holding N. Browser check also showed widths sampled from the first 200 rows truncated later values; widths now scan every row. Validation: bun run test green (1887 unit, 440 render), tsc clean, verified in Chrome on an isolated server (30k-row CSV: 92 DOM rows, sticky header, wrap, eye toggle, TSV, file.csv:20000 link).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
CSV/TSV files open in a virtualized table view (sticky header and row gutter, numeric right-align, ragged rows padded, wrap-aware) toggled to source by the markdown eye button. RFC 4180 parser with line mapping so file.csv:N links reveal the right row. Verified by unit and rendering tests and in the browser.
<!-- SECTION:FINAL_SUMMARY:END -->
