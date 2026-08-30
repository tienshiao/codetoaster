---
id: TASK-22
title: 'Tab bar, tab groups, and splits'
status: Done
assignee:
  - '@claude'
created_date: '2026-08-29 00:02'
updated_date: '2026-08-30 02:44'
labels:
  - frontend
milestone: m-3
dependencies:
  - TASK-18
  - TASK-19
documentation:
  - docs/v2-architecture.md
priority: high
ordinal: 22000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
frontend/components/tabs/* (§7.1, §7.2): the VSCode-style tab area. Tab bar per group with drag-to-reorder and drag-to-another-group, split command (disabled on terminal tabs), close (disabled on the agent tab), preview tabs rendered italic with double-click to pin, group flex resizing. Groups are a flat horizontal row.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Tabs can be reordered within a group and moved between groups by drag
- [x] #2 Split creates a new group to the right with the split tab; the Split command is disabled on agent and shell tabs
- [x] #3 The agent tab shows no close affordance and cannot be closed by keyboard
- [x] #4 Preview tabs render italic; double-click pins; a second single-click open replaces the preview
- [x] #5 Closing the last tab in a non-first group removes the group
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Layout is TASK-18's pure store; this task is the chrome over it, so nothing here re-implements a rule that layout-store.ts already owns and tests.

1. components/tabs/tab-labels.ts — TabDescriptor → what the strip shows (kind, label, detail, closable, full-path title). Pure, tested.
2. components/tabs/drag.ts — the two geometry answers a drag needs: dropIndexAt(tab rects, x) and resizeFlex(flexes, widths, boundary, deltaPx, minPx). Pure, tested; the DOM layer only supplies rects.
3. components/tabs/TabArea.tsx — the flat row of groups. Per group: a TabStrip, the task header, and the active tab's content via a renderTab prop (TASK-23 owns what goes in the pane). Splitters between groups. Drag is pointer events, not HTML5 DnD: hit-testing is document.elementFromPoint over data-tab-group / data-tab-id, so no ref registry and the drop indicator is a prop on the tab it lands before.
4. components/v2/TabStrip.tsx grows the interaction props it needs to be driven — tabId (as data-tab-id), onPointerDown, onDoubleClick, dragging, dropBefore/dropAfter, splitDisabled, groupId — all optional and all presentational. The design project's TabStrip is a static strip; this is the task that makes it real.
5. The task header band moves out of AppShell into components/v2/TaskHeader.tsx and is rendered once per group (the user's call: VSCode repeats breadcrumbs per editor group).
6. AppShell gains a tabArea render prop taking { leading }, so the sidebar toggle still rides the first strip while AppShell keeps owning sidebar state. The existing tabs/children path stays for the composer at / (TASK-24), which has no tabs at all.
7. routes/shell.tsx drives a real TaskLayout for the selected task (loadLayout/saveLayout), so every AC is demonstrable: Explorer file rows open preview diff tabs, double-click pins, Split is disabled on the agent and shell tabs.

Not in scope: keyboard shortcuts (TASK-34), what a pane actually renders (TASK-23), shell PTYs (TASK-27).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Build against `frontend/components/v2/` — the v2 design system is the new UI, not a parallel track (CLAUDE.md, "The v2 design system is the new UI"). `AppShell` and the shell components already exist from TASK-46; this task supplies their data. Do not extend `components/ui/` (v1 shadcn) for new surfaces.

Built as components/tabs/: TabArea (the group row), drag.ts (dropIndexAt / moveIndexFor / resizeFlex), tab-labels.ts (descriptor → what the strip shows) and use-task-layout.ts (load/save per task id). Nothing re-implements a layout rule — TabArea calls layout-store's operations and greys out the affordance when canSplit says no.

Drag is pointer events rather than HTML5 DnD: hit-testing is document.elementFromPoint over data-tab-group / data-tab-id, so there is no registry of refs to leave stale, and the drop indicator is a prop on the tab it lands before rather than an element in the flow (one in the flow shifts every tab right of it and makes the strip twitch under the pointer). A drop into a group that already holds the tab's key withdraws the indicator, since moveTab would refuse it.

Design-system changes: v2 TabStrip grew the interaction props needed to be driven (tabId, onPointerDown, onDoubleClick, dragging, dropBefore/dropAfter, splitDisabled, groupId, ref) — all optional and all presentational. Its tabs now live in a hidden-scrollbar scroll container: verification showed a narrow group's Split button clipped off the end of the strip, which made the command unreachable exactly when a split had just created the narrow group. The task header moved out of AppShell into its own TaskHeader component and is rendered once per group (the user's call, following VSCode's per-editor-group breadcrumbs). AppShell gained a tabArea render prop taking { leading } so the sidebar toggle still rides the first strip while AppShell keeps owning sidebar state; the old tabs/children path stays for the composer at / (TASK-24).

Verified in Chrome against a real daemon on :4599: reorder within a group, drag into the other group, split (with Split disabled and labelled 'not available for terminals' on the agent tab), the agent tab carrying zero close controls and one focusable element, preview tabs replacing then pinning on double-click, the second group vanishing when its last tab closed, boundary drag resizing 443/451 and persisting, and the whole layout — groups, tabs, preview state and widths — coming back across a page reload. The drop indicator and the dimmed source tab were confirmed mid-drag.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The VSCode-style tab area over TASK-18's layout store: a flat row of groups, each with its own strip, task header and pane, with drag-to-reorder, drag-between-groups, split, close, preview tabs and a draggable boundary between groups. All the rules stay in layout-store.ts; components/tabs/ is the chrome that calls them, and its own two pure pieces (drop geometry and flex resizing) are unit-tested. Verified end to end in Chrome against a live daemon, including persistence across a reload.
<!-- SECTION:FINAL_SUMMARY:END -->
