---
id: TASK-119
title: 'File viewer: table view for CSV and TSV files'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-29 02:26'
updated_date: '2026-09-29 02:26'
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
- [ ] #1 A .csv file opens as a table with the first row as a sticky header
- [ ] #2 A .tsv file opens as a table split on tabs
- [ ] #3 Quoted fields with embedded delimiters, doubled quotes and newlines parse as one cell (RFC 4180); CRLF and a leading BOM are handled
- [ ] #4 The eye button toggles between the table and the raw source, per tab, like the markdown preview
- [ ] #5 Rows are virtualized so a file with tens of thousands of rows scrolls without rendering every row
- [ ] #6 Ragged rows (fewer or more cells than the header) render without breaking the grid
- [ ] #7 Parser has unit tests; the table has a rendering test
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. utils/delimited.ts: RFC 4180 parser (quotes, doubled quotes, embedded newlines, CRLF, BOM), delimiter from extension. 2. components/file/TablePreview.tsx: useVirtualizer rows, sticky header, row-number gutter, column widths from sampled content, ragged rows padded. 3. FileContent/FilePane: extend the preview toggle to CSV/TSV (reuse markdownPreview view-state flag). 4. Tests: delimited.test.ts, TablePreview.render.tsx. 5. Verify in browser on an isolated server.
<!-- SECTION:PLAN:END -->
