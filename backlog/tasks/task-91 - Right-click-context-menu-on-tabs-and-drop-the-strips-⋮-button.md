---
id: TASK-91
title: 'Right-click context menu on tabs, and drop the strip''s ⋮ button'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-06 07:55'
updated_date: '2026-09-06 08:17'
labels:
  - frontend
dependencies: []
ordinal: 95000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A right-click on a tab opens a menu of the tab actions VS Code users expect: close variants, split, move to the other group, pin. The strip's trailing ⋮ ("Tab actions") button is removed along with its unwired onTabActions prop chain through TabStrip, TabArea and AppShell: everything it would hold is already on the strip (split, new shell), in the keymap, in the palette, or in this menu.

The v2 design system's DropdownMenu spec (Claude Design project 06f63995-570a-486c-af82-d70b8fa5976b, components/overlays/DropdownMenu.prompt.md) covers context and overflow menus and names the tab strip as a use; no v2 DropdownMenu component exists yet in components/v2/, so this task builds it (over Radix, whose dropdown-menu and context-menu packages are already installed) as the first consumer. Keep to the spec: destructive items last after a separator, under about eight items.

Every action maps onto layout-store.ts, which already owns close (with the agent tab's unclosable rule), splitTab with canSplit, moveTab, pinTab and mergeGroups. Close Others, Close to the Right and Close All are new compositions in the store, unit-tested there, so the menu is a third entrance to one table alongside TASK-34's chords and TASK-35's palette rather than new behaviour. Key hints on items come from chordCaps so the chord spelling stays in one place.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Right-clicking a tab opens a menu anchored at the pointer with: Close, Close Others, Close to the Right, Close All, a separator, Split, Move to Other Group (or Move to New Group when there is one group), and Pin when the tab is a preview
- [x] #2 The agent tab cannot be closed by any item, and Close Others / Close All leave it in place; Split is disabled on terminal tabs with the existing reason
- [x] #3 Items that have a leader chord show it via chordCaps, matching the palette's spelling on each platform
- [x] #4 Close Others, Close to the Right and Close All are layout-store operations with unit tests, including the agent-tab and last-tab-in-group cases
- [x] #5 A v2 DropdownMenu component exists in components/v2/, follows the design spec, and is the only menu primitive the strip uses
- [x] #6 The ⋮ button and the onTabActions prop are gone from TabStrip, TabArea and AppShell
- [x] #7 Verified in Chrome: the menu opens on right-click over a tab in either group, actions take effect, and Escape or a click outside dismisses it
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. layout-store.ts: closeOthers(layout, tabId), closeToRight(layout, tabId), closeAll(layout, groupId) over one shared close-many helper (agent always survives; a group emptied by the close is removed unless it is the last group; focus falls to the kept tab / the neighbour, as closeTab does), plus moveTabToNewGroup(layout, tabId) (a moved tab, not a copy, so terminals may go too; no-op for the lone tab of a lone group). Predicates canCloseOthers / canCloseToRight / canCloseAll so the menu greys out rather than offering a no-op. Unit tests beside the existing closeTab/moveTab ones.
2. components/v2/DropdownMenu.tsx: the design spec's item model (label, icon: LucideIcon, keys, disabled, destructive, separator, section) rendered over Radix — ContextMenu when trigger="context" (anchored at the pointer, right-click and long-press), DropdownMenu otherwise (anchored on the child). Same item renderer for both. Exported from v2/index.ts.
3. Tab (v2/TabStrip.tsx) takes menu?: DropdownMenuItem[] and wraps itself in the context-menu trigger (asChild, so the tab div stays the drag target). The ⋮ button and onTabActions leave TabStrip, TabArea and AppShell.
4. TabArea builds each tab's items from the store: Close, Close Others, Close to the Right, Close All · Split, Move to Other Group / Move to Left|Right Group / Move to New Group · Pin (preview only). Keys via chordCaps. Closes fire onCloseTab for every tab that left the layout, so shell PTYs die as they do from the X.
5. Render test: right-click a tab opens the menu with the expected rows; Close Others removes the rest and reports each closed shell tab. Chrome pass with a split.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built as planned. DropdownMenu (components/v2) is the design spec's item model over Radix: ContextMenu for trigger="context" (right-click, ⌃-click, long-press, anchored at the pointer), DropdownMenu otherwise; one row renderer for both, asChild so the trigger keeps its own box. Tab takes menu?: DropdownMenuItem[] and TabArea builds it per tab from the store: Close / Close Others / Close to the Right / Close All · Split · Move to Other Group (two groups) or Move to Left|Right Group (more) or Move to New Group (one) · Pin (preview tabs). Group rows withheld under singleGroup. Chords named only on the active tab of the focused group, as the strip's hints are. Bulk closes report every departed tab through onCloseTab so shell PTYs die as from the X.

layout-store: closeOthers / closeToRight / closeAll over one closeWhere helper (agent exempt, emptied group collapses unless last, focus as closeTab), canClose* predicates over the same selection, moveTabToNewGroup (a move, so terminals may go) + canMoveTabToNewGroup. 17 store tests, 4 render tests.

The ⋮ button and onTabActions are gone from TabStrip, TabArea and AppShell. README's tabs section names the right-click menu. The design project's DropdownMenu.prompt.md still lists 'the tab strip's ⋮' as a use — a one-line edit for the next design sync.

Verified in Chrome on :4599 with a shell task: menu on right-click over the preview tab (Pin row, chords on the active tab, Close to the Right greyed at the end of the strip); Move to New Group made a second group with the preview intact; Escape and a click outside both dismiss; Move to Other Group across the split; the agent tab's Close and Split greyed while Move is offered; Close Others and Close All each took the rest and left the group in the expected state. 1350 unit + 288 render tests green, tsc clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A right-click (⌃-click, long-press) menu on every tab — Close, Close Others, Close to the Right, Close All, Split, Move to Other/Left/Right/New Group, Pin — built on a new v2 DropdownMenu over Radix and driven entirely by layout-store operations, with three new bulk closes and a move-to-new-group added there under tests. The strip's dead ⋮ button and its onTabActions chain are gone. Verified in Chrome on a split layout and by 1350 unit + 288 render tests.
<!-- SECTION:FINAL_SUMMARY:END -->
