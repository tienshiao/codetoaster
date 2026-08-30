---
id: TASK-46
title: 'v2 design system: token layer, shell components, and AppShell'
status: Done
assignee: []
created_date: '2026-08-29 23:04'
updated_date: '2026-08-30 00:16'
labels:
  - frontend
  - design
dependencies: []
documentation:
  - docs/v2-architecture.md
ordinal: 46000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Import the Claude Design project 'CodeToaster v2 Design System' (06f63995-570a-486c-af82-d70b8fa5976b) into the repo as the real presentation layer, and implement its templates/app-shell/AppShell.dc.html.

Three parts:

1. Token layer. Replace the shadcn zinc tokens and @theme inline block in src/frontend/index.css with the v2 layer: palette (--ct-slate-* at oklch hue 258, --ct-blue-*, signal hues), semantic aliases (--pane, --chrome, --hover, --selected, --state-*, --diff-*), space/chrome heights (--h-titlebar 36, --h-tabstrip 36, --h-tab 30, --h-row 28, --h-group 26, --h-statusbar 24, --w-sidebar 240, --w-sidebar-right 272), typography (Public Sans + JetBrains Mono, 11/12/13/14 scale), motion, and the syntax colours. Light and dark are peers; dark is a .dark class on <html>. The Tailwind 4 bridge comes from the project's integration/tailwind-theme.css so bg-pane, text-state-busy, h-row, text-micro etc. resolve.

2. Shell components. Port the design system's components to TSX under src/frontend/components/v2/, using lucide-react and Tailwind token utilities in place of the design project's Lucide-UMD Icon wrapper and inline styles: StatusDot, Badge, IconButton, KeyHint, FilterInput, TaskRow, ProjectGroup, TabStrip (with Tab), ExplorerTabs, StatusBar, DiffStat, FileRow. Contracts follow the design project's .d.ts exactly. TerminalFrame is NOT ported: production uses the real Terminal.

3. AppShell. Build src/frontend/components/v2/AppShell.tsx as the three-column shell from the template — 240px task list left, fluid tab area centre, 272px Explorer right, both sidebars collapsible — composed from those components and driven entirely by props, so the later wiring tasks (TASK-18/19/20/24/25/26) supply data rather than restructure markup. Mount it on a preview route; v1 stays running until TASK-28.

Scope decision: this is presentation only. No layout-store, PtyContext, TaskContext, composer or Explorer data wiring — those stay in their own tasks. The route renders the template's fixture data.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 src/frontend/index.css carries the v2 token layer in light and dark, and the Tailwind bridge exposes the v2 names as utilities
- [x] #2 Public Sans ships self-hosted in src/frontend/fonts (no Google Fonts network dependency at boot)
- [x] #3 The 12 shell components exist under components/v2 with the design project's prop contracts and no colour literals outside the token layer
- [x] #4 AppShell renders the template's three columns at the design's chrome heights, with both sidebars collapsible
- [x] #5 A preview route renders AppShell with fixture data; the v1 app still builds and runs unchanged
- [x] #6 bun run build (or tsc) reports no type errors and the shell has no console errors
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read the design project (06f63995) — readme, tokens/*, integration/tailwind-theme.css, templates/app-shell/AppShell.dc.html, and the .jsx/.d.ts of every component the template uses.
2. Token layer: splice palette/space/typography/motion/semantic/base into src/frontend/index.css in place of the shadcn zinc block, keeping the repo's own rules (Nerd Font faces, line-flash, symbol highlight, markdown-preview, fixed-shell sizing). Self-host Public Sans as a variable woff2 per subset. Verify the compile with the Tailwind CLI, not by eye.
3. Port the 13 shell components to src/frontend/components/v2/ (delegated): lucide-react in place of the design's UMD Icon wrapper, Tailwind token utilities in place of inline styles, hovered/focused props replaced by real CSS variants, divs with roles promoted to buttons.
4. AppShell.tsx: the three columns at the design's chrome heights, both sidebars collapsible from one fixed pair of toggles in the breadcrumb row, sidebars overlaying rather than squeezing below the mobile breakpoint. Layout only — every list, tab and status value is a prop.
5. routes/shell.tsx: the template's fixture data, including a terminal stand-in that lives with the route rather than in the component library (the design system forbids shipping its TerminalFrame).
6. Verify: tailwind compile, tsc clean for the new files, and the shell rendered in a browser in both themes.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Done and verified in a browser at 1440x900, both themes.

**The one real trap, worth knowing about before the next token edit.** Every transparent wash in the design system is written `color-mix(in oklab, var(--ct-x) N%, transparent)`. Tailwind cannot statically evaluate a color-mix over a var(), so it emits an opaque fallback plus an `@supports (color: color-mix(in lab, red, red))` override *nested inside the rule* — and Bun's CSS bundler drops nested @supports blocks (65 of the 73 top-level guards survive; the 8 in :root/.dark do not). The fallback then wins and every wash renders fully opaque: a selected task row came out solid blue, an icon button solid black, and the whole diff would have been solid green and red. Utility-level color-mix (Badge tones, StatusDot's attention halo) is unaffected because its guard is top-level.

Fix: five palette steps that back a wash (`--ct-slate-1000`, `--ct-blue-400/500`, `--ct-green-500`, `--ct-red-500`) now also carry a bare `L C H` channel triplet, and every wash is `oklch(var(--ct-x-ch) / <alpha>)`. Same colour, no color-mix in the token layer at all, palette layering preserved. Adding a wash over a sixth step means giving that step a triplet first — the rule is commented at the top of the palette block.

Other decisions:
- Public Sans is self-hosted (two variable woff2 subsets, 45 KB) rather than loaded from Google Fonts; a daemon at localhost:4000 should not need the network to draw its own chrome.
- `Skeleton` was switched from `bg-accent` to `bg-muted`: under v2, `--accent` is an interaction wash, not a surface, so an accent-filled skeleton is invisible. The design project's own notes had flagged the v1 `--muted`/`--accent` collision.
- The design's `hovered`/`focused` props became real `hover:`/`focus-within:` variants; `role` divs became buttons. `Tab` is a presentational wrapper with role=tab on the label half, because a close button cannot nest inside the tab's own button.
- Icons are lucide component references, not name strings — there is no name-to-component registry without bundling all of lucide.
- `TerminalFrame` was deliberately not ported (the design system forbids it in production); the preview route carries its own terminal stand-in, which TASK-19 replaces with the real multi-instance Terminal.

Not verified: the below-768px overlay path. The Chrome window in this environment would not resize below its current size, so that branch was reviewed by reading, not by driving. TASK-33 owns the mobile pass.

Left alone as pre-existing and v1-only: hardcoded zinc/black literals in App.tsx, Terminal.tsx, InitialPathAutocomplete.tsx and ProjectDialog.tsx. TASK-28 deletes that UI.

Follow-up: the sidebar toggles moved from the breadcrumb row into the tab strip (user's call, and the better one — each toggle now sits against the sidebar it opens, and the breadcrumb is back to exactly the template's content). `TabStrip` gained optional `leading`/`trailing` slots for chrome pinned outside the tabs; `AppShell` hangs the two IconButtons there. Re-verified in Chrome: toggles still collapse both sidebars and stay anchored as tabs come and go.

Also from the code review pass: 469 tests pass, but `resume.test.ts` > "when nothing opens..." flakes about one run in eight. Measured with and without the review's manager.ts/snapshot.ts fixes stashed — same rate either way, so it is pre-existing. Filed as TASK-47.

Follow-up 2: the panel-right toggle is gone. It sat beside Split in the tab strip and the two glyphs read as the same control. Replaced by an ExplorerRail — a new components/v2 component: the Explorer's tab bar rotated onto the window edge, always visible, 36px wide with 28px rows and 14px glyphs so it keeps the chrome's density rather than VSCode's roomier activity bar.

Behaviour is a tab bar that can also hide the panel: clicking a section switches to it, clicking the section already showing collapses the Explorer entirely. Nothing is marked active while nothing is showing. The active item takes the system's 2px --primary bar on the edge facing the content — the same idiom the tab strip puts on top — plus the selection wash.

Two things the rail buys over a collapse button: the section a click will open is named up front, and a section's count still reads with the panel shut (Changes carries a 5 chip at 2px radius, in-system with 'chips and status squares', not a pill).

Consequences: ExplorerTabs is no longer used by the shell — a rail and a row of tabs over the same four sections is the same control twice — but stays exported, since the design system owns it. The Explorer panel gained a 36px header naming the active section with its count. AppShell's `explorerTabs` prop became `explorerSections: ExplorerRailItem[]`. On mobile the panel floats at right-9 so the rail, which is the only way back to the other sections, stays reachable above the scrim.

Verified in Chrome across all three states: Changes open, Refs open (showing its unbuilt placeholder, and the Changes count still legible on the inactive icon), and collapsed. The preview route now renders fixture content only for Changes and says so for the rest, rather than showing the diff tree under all four labels.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Imported the 'CodeToaster v2 Design System' Claude Design project as the repo's presentation layer and implemented its app-shell template.

Changed: src/frontend/index.css now carries the v2 token layer (palette, semantic, space, type, motion, base) plus the Tailwind 4 bridge in place of the shadcn zinc defaults, light and dark as peers; Public Sans ships self-hosted; 13 design components plus a tailwind-merge-aware cn() live in src/frontend/components/v2/; AppShell.tsx renders the three-column shell with both sidebars collapsible; routes/shell.tsx previews it with the template's fixture data. One v1 fix: Skeleton fills with bg-muted, since v2's --accent is a wash rather than a surface.

Verified: Tailwind compiles with every v2 utility resolving; tsc reports nothing for the new files; 92 frontend tests pass; the shell was driven in Chrome at 1440x900 in both themes with no console errors, and both sidebar toggles were exercised. Fixing the color-mix/@supports bundling trap (see notes) was the substantive find - without it every wash in the product, including the whole diff viewer, rendered opaque.
<!-- SECTION:FINAL_SUMMARY:END -->
