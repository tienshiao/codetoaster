---
id: TASK-87
title: Render YAML frontmatter as a header in the markdown preview
status: Done
assignee:
  - '@tma'
created_date: '2026-09-04 22:24'
updated_date: '2026-09-04 22:37'
labels:
  - frontend
  - server
  - markdown
dependencies:
  - TASK-85
references:
  - src/api/files.ts
  - src/frontend/components/file/FileContent.tsx
  - src/frontend/components/file/MarkdownPreview.tsx
  - src/lib/backlog/read.ts
priority: medium
ordinal: 87000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A markdown file that opens with a YAML frontmatter block — every Backlog.md task file, and most docs written for static-site tools — currently renders that block in the preview as one run-on paragraph: 'id: TASK-33 title: Mobile pass on the new shell status: To Do assignee: [] …' with the list items falling out as bullets. The information is worth keeping (a task's status, labels, priority and dependencies are exactly what a reader wants first), so it is not to be stripped; it is to be rendered as what it is.

The parse happens on the server, not the client: there is no YAML parser in the frontend bundle and Bun.YAML is already what src/lib/backlog/read.ts uses. serializeFileContent in src/api/files.ts — shared by GET /api/tasks/:id/file and the git file route, so a commit's view of the file gets the same treatment — gains, for a markdown file whose text starts with a '---' line closed by another, a frontmatter field: the parsed object and the number of source lines the block spans (both fences included). A block that will not parse, or parses to something other than a plain object, yields no field and the preview shows the raw text as it does today. The frontmatter extraction is one function shared with the Backlog reader rather than a second copy.

In the preview, FileContent drops the block's lines from the source it hands MarkdownPreview and renders a header above the body instead: a compact key/value grid in the preview's own width and type scale, keys in the file's order in mono muted text, values by kind — a string as text, a number or boolean in mono, an array of scalars as neutral Badges from components/v2, null or an empty array as a muted dash, and anything nested (an object, an array of objects) as its YAML re-serialised in a code block. The header is part of the scrolled document, not a sticky bar, and is separated from the body by the same rule the preview draws under an h1. The source view (preview toggled off) is untouched and still shows the raw block.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A markdown file opened in preview whose text begins with a YAML frontmatter block renders a key/value header above the body, and the block's raw text no longer appears in the body
- [x] #2 String, number, boolean, list-of-scalars, empty and nested values each render as specified; keys keep the file's order
- [x] #3 A block that does not parse, or is not a mapping, leaves the response without a frontmatter field and the preview unchanged from today
- [x] #4 The git file route's response carries the same field, so a file viewed at a commit renders the same header
- [x] #5 The source view is unchanged
- [x] #6 Tests cover the serializer (parsed, unparseable, non-mapping, non-markdown) and the header's rendering of each value kind
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. src/lib/frontmatter.ts: extractFrontmatter(text) → { yaml, lineCount } | null, moved out of src/lib/backlog/read.ts and used by both.
2. serializeFileContent (src/api/files.ts): for .md/.markdown paths, parse the block with Bun.YAML; a plain-object result becomes frontmatter: { data, lineCount } on the response; anything else leaves the field off. FileContentResponse type gains the optional field.
3. FileContent: when the preview is on and frontmatter is present, hand MarkdownPreview the source minus the first lineCount lines and render FrontmatterHeader (new components/file/FrontmatterHeader.tsx) above it: key/value grid, values by kind, nested values as YAML in a code block (server pre-serialises nested values with Bun.YAML.stringify so the client needs no YAML).
4. Tests: serializer cases in src/api/files.test.ts (new) and a FrontmatterHeader.render.tsx over each value kind.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Frontmatter extraction moved to src/lib/frontmatter.ts and shared with the Backlog reader. serializeFileContent shapes each value on the server (text, scalar, list, empty, block with YAML re-serialised by Bun.YAML.stringify) so the client needs no YAML parser; both file routes get it since they share the serializer. MarkdownPreview renders FrontmatterHeader inside the markdown-preview wrapper so a nested value's code block takes the preview's pre styling. Validation: full suite green (1089 unit, 193 render), tsc clean; verified in Chrome on task-1's file: keys in file order, lists as badges, empty dependencies as a dash, ordinal in mono, rule before the body, raw block gone from the body and still present in the source view.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A markdown file's YAML frontmatter is parsed on the server with Bun.YAML and carried on the file response as shaped entries; the preview renders them as a key/value header above the body instead of a run-on paragraph, with lists as badges and nested values as YAML code. Unparseable or non-mapping blocks leave the preview as it was. Verified with serializer, extractor and rendering tests and in the browser.
<!-- SECTION:FINAL_SUMMARY:END -->
