---
id: TASK-75
title: 'A Radix-based v2 Select, decided with the mobile pass'
status: To Do
assignee: []
created_date: '2026-09-01 08:44'
updated_date: '2026-09-01 08:44'
labels:
  - frontend
  - ui
  - design-system
milestone: m-5
dependencies:
  - TASK-33
ordinal: 75000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The v2 `Select` is a native `<select>` wearing the design system's paint — its own doc comment says so, and says why: typeahead, arrow keys, the platform's picker on a phone and the whole accessibility tree come with the element and would not have survived being reimplemented. The design system itself specifies a button over a DropdownMenu.

That departure has held up, and TASK-74 fixed the one thing genuinely wrong with it (the chevron did not open the picker). What it cannot do is style the popup at all, and one place that now hurts:

**Terminal Theme is 157 options.** It renders as a bare OS menu with no filter and no preview, so choosing a theme means scrolling an alphabetical list of names and picking blind — the swatch row underneath only shows the theme *after* it is applied. A styled popup could filter, and could draw each theme's palette beside its name.

Radix costs no new dependency: `radix-ui` ^1.4.3 is already here for `ui/alert-dialog`, `popover`, `collapsible` and `button`, and a Radix-based Select would live in `components/v2/`, so this does not regrow `components/ui/`. Radix also keeps typeahead, arrow keys and correct ARIA — it is not a naive reimplementation.

**Why this is deliberately not scheduled on its own.** The thing the native element buys that Radix cannot is the platform picker on touch — an iOS wheel instead of a scrolling popup. TASK-33 is the mobile pass and has not happened, so the cost of giving that up is exactly the thing nobody has measured yet. Deciding this before that work is backwards. Settle it with TASK-33, against a real device.

Consumers if it goes ahead: the composer's project/model/mode chips, `ProjectSettingsDialog`, and `SettingsDialog`'s five.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A decision is recorded either way, with the mobile trade-off actually tested on a device rather than reasoned about
- [ ] #2 If Radix: typeahead, arrow keys and the accessibility tree are no worse than the native element's, verified not assumed
- [ ] #3 If Radix: the Terminal Theme list is filterable and previews each theme's palette
- [ ] #4 If native is kept: the 157-item Terminal Theme list gets a filter by some other means
<!-- AC:END -->
