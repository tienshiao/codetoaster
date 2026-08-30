---
id: TASK-54
title: Path autocomplete and directory browsing in the v2 project dialog
status: To Do
assignee: []
created_date: '2026-08-30 07:29'
labels:
  - frontend
milestone: m-3
dependencies: []
ordinal: 54000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The v2 'New project' dialog (TaskSidebar's NewProjectButton) takes the repository path as a plain text field. v1's ProjectDialog had two affordances this dropped: InitialPathAutocomplete (debounced suggestions from /api/directories, with keyboard navigation) and DirectoryPickerDialog (a browsable tree). TASK-25 left them out because reusing them would have pulled ui/input, ui/dialog and ui/button into the v2 surface, which CLAUDE.md forbids. Typing a path blind is worse than what v1 offered, so they are being rebuilt on v2 primitives.

Design constraint that shapes it: v2/Dialog registers its Escape handler on document and renders fixed z-50, so a second Dialog stacked on it would have one Escape close both, with undefined z-order between them. The directory browser is therefore a *mode inside the same dialog* rather than a second modal — Browse swaps the body from the fields to a tree, choosing a directory fills the field and returns to the form.

The v1 components are deliberately left untouched as the reference implementation and die with v1 at TASK-28. The duplication is accepted for that span rather than contorting one component to serve two incompatible dialog systems.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Typing a partial path suggests directories, debounced, from the existing use-directories hook
- [ ] #2 Arrow keys move the suggestion selection and Enter accepts it
- [ ] #3 Escape closes the suggestion list without closing the dialog
- [ ] #4 A browse mode shows an expandable directory tree and selecting a directory fills the path field
- [ ] #5 No second modal is opened over the project dialog
- [ ] #6 Every control is reachable by keyboard
<!-- AC:END -->
