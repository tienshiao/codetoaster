# design-sync notes — CodeToaster

## Repo shape

- **CodeToaster is an application, not a component library.** There is no `dist/`
  entry exposing components (`dist/` is the built app — never point `cfg.entry` at
  it). The component surface is `.design-sync/ds-entry.ts`, a committed file that
  `export *`s the 17 shadcn primitives plus the 13 app components. Add a component
  by adding it there *and* to `cfg.componentSrcMap`.
- `package.json` is still named `bun-react-template`; `cfg.pkg` is set to
  `codetoaster` so the global is `window.CodeToaster` (124 exports).
- Cards are one per component *family* (`DropdownMenu`, not its 15 parts). Every
  part is still exported and importable — only the card count is curated.

## CSS / Tailwind

- Styling is **Tailwind 4 source**, not a compiled stylesheet: `src/frontend/index.css`
  is `@import "tailwindcss"`. `cfg.buildCmd` (`node .design-sync/build-css.mjs`)
  compiles it to `.design-sync/.cache/tailwind.css`, which `cfg.cssEntry` points at.
  **Run it before `package-build.mjs` on every sync.**
- That script also **repoints `@font-face` url()s**. The converter resolves font
  urls relative to the stylesheet's own directory, so index.css's `./fonts/...`
  would resolve into `.cache/` and all 10 Nerd Font faces would ship dangling.
  Don't "simplify" the rewrite away — verify `ds-bundle/fonts/*.woff2` after a build.
- The compiled CSS is **scanned from this repo's own source**, so it contains only
  the utility classes CodeToaster actually uses. Classes the design agent invents
  outside that set have no CSS. This is why `conventions.md` enumerates the real
  token vocabulary instead of implying all of Tailwind is available.
- The Tailwind CLI installed into `.ds-sync/` resolves its own tailwindcss
  (**4.3.3**) while the repo pins **4.2.0**. Compiled output has matched so far;
  a future major could drift.

## Fonts

- **Accepted substitution (user's explicit OK, 2026-08-29):** the UI stack is
  `Inter, system-ui, Avenir, ...` but the repo ships no Inter and it is not
  installed locally, so the real app already renders in `system-ui`. We ship no
  sans font on purpose — designs then match the running app. `[FONT_MISSING]` for
  **Inter / Avenir is expected and resolved**; do not "fix" it by shipping Inter.
- The 10 Nerd Font Mono faces (JetBrainsMono, FiraCode, Hack, Meslo, Caskaydia)
  DO ship as real woff2 files.

## Grouping

- Groups come from `category:` frontmatter in `.design-sync/docs/<Name>.md`
  (`cfg.docsDir`), because path-derived grouping put all 30 in `general`.
  Eight groups: Actions, Forms, Overlays, Navigation, Feedback, Layout,
  Application, Terminal. A new component needs a doc file or it lands in `general`.
- Those docs are real prose; the converter appends synthesized Props and Examples
  to each, so they are the design agent's usage reference — keep them accurate.

## Components needing context

- `CommandPalette`, `ProjectDialog`, `TabSwitcher`, `SymbolPopover` read session /
  router / query context. `TerminalPreview` and `TerminalSearchBar` take
  imperative deps (xterm `SearchAddon`, fetch callbacks) as props instead.

## Preview authoring — what four parallel waves learned

### The compiled CSS is frozen between full builds (hit by every wave)

`tailwind-entry.css` declares `@source "./previews"`, but that is only re-scanned by
`build-css.mjs`, which runs inside `package-build.mjs`. `preview-rebuild.mjs` rebuilds
JS/HTML only. **So any Tailwind utility a preview newly introduces has no CSS rule
until the next full build, and silently does nothing.** Classes that were absent and
had to be dropped mid-wave: `w-[520px]`, `w-[560px]`, `gap-6`, `pb-3`, `pl-3`, `mb-3`,
`gap-0`, `size-3`, `items-end`, and *any* arbitrary `h-[...]`.

Convention adopted: **layout scaffolding geometry goes in inline `style={{}}`**
(it needs no Tailwind pass and is preview chrome, not component styling); colour and
type stay token classes. If a future wave needs fresh utilities mid-loop, the only fix
is re-running `build-css.mjs` + `package-build.mjs` between waves.

### Provider identity: the bundle's instance is the only one that counts

Three waves independently hit this. A component that reads React context cannot be
satisfied by a provider the preview imports from `node_modules` — that is a SECOND
module instance with its own context object, so the consumer still throws. Symptoms:
`No QueryClient set`, `useTerminalTheme must be used within TerminalThemeProvider`,
`Invariant failed: Could not find a nearest match!` (router).

Fixed centrally with **`cfg.extraEntries: ["@tanstack/react-query", "@tanstack/react-router"]`**.
`storyImportPlugins` builds its shim regex from `[PKG, ...extraEntries]`, so a preview's
bare `import ... from "@tanstack/react-query"` redirects to `window.CodeToaster` — the
bundle's own instance. Repo-owned providers (`TerminalThemeProvider`, `SessionProvider`)
plus `PreviewQuery`/`PreviewRouter` helpers are exported through
`.design-sync/preview-context.tsx`, which `ds-entry.tsx` re-exports.
**Any future context-reading component needs its provider on one of those two paths.**

### Editing config mid-wave stalls every agent

Changing `config.json` without re-running `package-build.mjs` trips `[CONFIG_STALE]`, and
`preview-rebuild.mjs` then refuses to run — silently blocking every parallel agent. Batch
config edits, or rebuild immediately after making them.

### Overlays (Radix)

- Pass controlled `open` + a no-op `onOpenChange`, and **leave the portal alone**: under
  `?story=` the story owns the page, so portalled fixed content photographs like a real
  modal. No non-portal path was needed anywhere.
- **Never `modal={false}` on Dialog/AlertDialog/Sheet** — Radix only renders `Overlay`
  when `modal` is true, so it silently deletes the scrim. It IS right for
  Popover/DropdownMenu so several can coexist.
- `TooltipProvider` must be *per story* — each export mounts as its own React root.
- `.ds-cell`'s `translateZ(0)` does NOT contain these: the portal target is
  `document.body`, outside the transformed element. Hence `cardMode: single`.
- `Select` open stories need top padding AND the first item selected; Radix's
  item-aligned positioning otherwise floats the menu off the top of the viewport.

### Grade-key subtlety — batch overrides BEFORE grading

**Any `overrides.<Name>` entry changes that component's `cfgSlice`, which is part of
`sourceKey` — so adding one clears that component's verdicts even when the `.tsx` and
the rendered pixels are identical.** (An earlier note here claimed only `ov.viewport`
counted and that `cardMode`/`primaryStory` were free; that is wrong, and it cost a full
re-grade of all 29 authored components.) Capture *geometry* only moves with `viewport`,
but the grade contract is wider than the geometry.

Practical rule: decide every override first, apply them in one batch, and grade after.
Overrides discovered late (e.g. from `[GRID_OVERFLOW]`) mean a re-grade — budget for it.

### Component-specific traps

- **Sidebar** renders in a card only with `<Sidebar collapsible="none">`; the default
  `offcanvas` is `fixed inset-y-0 h-svh` and escapes any bounded box. Override the
  provider's `min-h-svh` with `min-h-0`. **Never card it below 768px** — its paths are
  `hidden md:block` and `useIsMobile()` swaps in a closed `Sheet`, i.e. a blank card.
  Avoid `SidebarMenuSkeleton`: it picks bar widths with `Math.random()`, so captures
  are non-deterministic.
- **Toaster** portals fixed to the page's bottom-right, outside the story box, and
  `import { toast } from "sonner"` in a preview bundles a second sonner (two stores,
  nothing renders). The card draws the toast surface from `sonner.tsx`'s own
  `toastOptions.classNames` recipe at sonner's geometry, with a live `<Toaster />`
  mounted alongside.
- **DirectoryPickerDialog** browses `GET /api/directories`, which does not exist in a
  static capture. Its preview stubs that ONE endpoint (component untouched); the stub
  must strip the trailing slash the component appends and return `home` from the root
  fetch, or the `~`-relative paths never appear.
- **HelpButton / SettingsButton** take no props and own their dialogs. The open card is
  produced by clicking the REAL trigger on mount (`ref.querySelector("button").click()`
  in a `useEffect`), which lands inside the capture's `networkidle` window.
- **TerminalSearchBar** keeps its query in a ref on an uncontrolled input, so a static
  render always shows the empty bar. The preview dispatches a genuine `input` event and
  reports counts through the addon's own `onDidChangeResults` channel. Going straight
  from no query to a non-matching one leaves `resultIndex`/`resultCount` at their initial
  `-1`/`0`, so React bails out of the re-render and "No results" never paints — type a
  MATCHING query first, then the non-matching one, one commit apart (which is what a user
  does anyway).
- **TerminalPreview CAN render its hover panel.** (An earlier note here said it could not
  — that was wrong.) Radix opens a tooltip on **focus** as well as hover, so the story
  focuses a row on mount and the component's real portal renders: the scrollback
  thumbnail, fed serialize-addon-shaped HTML matching `/api/tasks/:id/preview` at the 7px
  scale the component's own scoped CSS imposes.
- **SymbolPopover** has no reachable `isLoading` card: `useSymbolLookup` supplies its own
  `queryFn`, so a `QueryClient` default cannot hold the query pending and the only route
  left is patching global `fetch`. The cell that used to claim "Loading" was really the
  empty state, and is now honestly named `NoResults` with a seeded empty result.
- **Never construct fixtures at preview module scope.** A throw there empties
  `window.__dsCells` and the component becomes permanently ungradable (no cells, no
  sheet). Build fixtures inside render (`useState(() => ...)`).

## Known render warns (triaged — do NOT re-chase)

- **Black band at the bottom of tall `cardMode: column` card screenshots.** Affects the
  7 cards taller than the ~800px capture viewport (Input, Textarea, Skeleton, Sidebar,
  Tabs, Command, TerminalSearchBar). It is a **full-page-screenshot compositing artifact**:
  `.ds-cell{transform:translateZ(0)}` makes each cell its own layer, and layers past the
  capture viewport composite to black. Verified NOT a product defect — re-rendering the
  same `.html` at a 1200x1500 viewport gives `bodyBg: rgb(255,255,255)` and a fully white
  card. The shipped HTML is correct; only the screenshot lies. Do not "fix" it with a
  taller `viewport` override — that would clear grades for a screenshot-only artifact.
- **StatusDot `Active` vs `Connected`** look identical in a still frame: `isActive` drives
  a debounced animation, not a different colour.

## Components that cannot render statically (floor cards, by design)

- **CommandPalette** — needs session + sidebar + router + query context AND opens only
  via a `Cmd/Ctrl+Shift+P` keydown; with no server the session list is empty anyway.
  Dispatching the real shortcut still left the root empty, so the authored preview was
  removed in favour of the honest floor card.
- **TabSwitcher** — `useSession()` throws outside `SessionProvider`, `useNavigate()`
  needs a router, `useTerminalPreview()` needs a live server, and even with all three it
  returns `null`: the overlay is gated on internal state set only by a ``Ctrl+` `` keydown,
  with no `open` prop. Giving it an optional `open`/`defaultOpen` prop would make it
  cardable.

Both ship fully importable with real `.d.ts` and `.prompt.md`; only the picture is missing.

## Findings about the app itself (not sync problems)

- `InitialPathAutocomplete`'s suggestion dropdown is hard-coded dark — `bg-zinc-900`,
  `border-zinc-700`, `bg-zinc-700 text-white`, `hover:bg-zinc-800` — instead of
  `bg-popover` / `border-border` / `text-popover-foreground` / `bg-accent`. It renders as
  a black slab on a light ground and will look wrong in the app's light theme too.
  `ProjectDialog` shares the smell (`text-zinc-500`).
- **`--muted` and `--accent` are byte-identical tokens** in both themes
  (`oklch(0.967 0.001 286.375)` light, `oklch(0.274 0.006 286.033)` dark). `Skeleton`
  fills with `bg-accent`, so **any Skeleton placed on a `bg-muted` surface is
  invisible** — which is exactly what a diff/file header is. Found because the
  Skeleton DiffLoading card captured as an empty grey band with its bars missing.
  A token-collision smell in the system, not a preview problem.
- `sm:max-w-2xl` on `AlertDialogContent` is a no-op: the component's own
  `data-[size=default]:sm:max-w-lg` outranks it. `DiffView.tsx` passes `max-w-2xl` and it
  is silently doing nothing.

## Re-sync risks

- **`.design-sync/.cache/tailwind.css` is generated**, not committed. `cfg.buildCmd` must
  run before `package-build.mjs` or `cssEntry` points at a stale or missing file.
- **The Tailwind CLI in `.ds-sync/` resolves its own tailwindcss (4.3.3) while the repo
  pins 4.2.0.** Output has matched so far; a major bump could drift.
- **Previews depend on app internals** that are not public API: query keys
  (`["directories", path]`, `["sessions", id, "symbols", name]`), the
  `GET /api/directories` response shape, sonner's class recipe, and `SearchAddon`'s
  `onDidChangeResults` contract. If a card goes blank after an app change, suspect these
  first.
- **The fonts fix is load-bearing** — see the CSS section. Verify `ds-bundle/fonts/*.woff2`
  after every build.
- **CommandPalette/TabSwitcher stay floor cards** until they expose an `open` prop.
- The `src/` tree had uncommitted work in progress during this sync (task-suspension
  lifecycle), so the bundle reflects the working tree, not a committed state.
