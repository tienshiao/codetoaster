## Building with CodeToaster

CodeToaster is a browser-based terminal multiplexer: sessions in a sidebar, and per
session a terminal, a code-review diff, a file browser, and git history. Designs
should look like a developer tool — dense, monospace where it is code, quiet chrome.

### Styling idiom: Tailwind 4 utilities over semantic tokens

Style with utility classes, and take colors from the **semantic token scale**, never
raw palette values. `bg-zinc-900` is wrong here; `bg-background` is right — the
tokens are what make light and dark both work.

| Family | Names |
|---|---|
| Surfaces | `background`, `card`, `popover`, `muted`, `accent`, `sidebar` |
| Text | `foreground`, `card-foreground`, `popover-foreground`, `muted-foreground`, `accent-foreground`, `primary-foreground`, `secondary-foreground`, `destructive-foreground`, `sidebar-foreground` |
| Actions | `primary`, `secondary`, `destructive` |
| Lines & focus | `border`, `input`, `ring`, `sidebar-border`, `sidebar-ring` |
| Data | `chart-1` … `chart-5` |

Each name works across the usual prefixes: `bg-*`, `text-*`, `border-*`, `ring-*`,
`fill-*`. So a muted caption is `text-muted-foreground`, a hovered row is
`hover:bg-accent`, a danger label is `text-destructive`. Radii come from the same
scale: `rounded-sm|md|lg|xl`, all derived from one `--radius`.

**Dark mode** is a `dark` class on `<html>`, not a media query. Every token flips
automatically, so correct token use is the whole job — never hand-write a dark
variant for a color that already has a token.

### Wrapping and setup

Components are plain React and import from the bundle. Most need nothing, but four
providers matter — this is the app's real root order:

```jsx
<QueryClientProvider client={queryClient}>
  <TerminalThemeProvider>      {/* terminal colors + font; TerminalPreview needs it */}
    <SessionProvider>          {/* live sessions over WebSocket */}
      <SidebarProvider>        {/* sidebar collapse state; useSidebar() reads it */}
        <YourScreen />
      </SidebarProvider>
    </SessionProvider>
  </TerminalThemeProvider>
</QueryClientProvider>
```

Rules that bite if ignored:
- `Sidebar` and `SidebarInset` must both be inside `SidebarProvider`.
- Tooltips need a `TooltipProvider` above them.
- `Toaster` is mounted once near the root; `toast()` is then callable anywhere.
- `CommandPalette`, `TabSwitcher`, `ProjectDialog` and `SymbolPopover` read session
  or router context and take few or no props — compose them inside the providers
  rather than trying to drive them from the outside.

### Composition

Compound components are families: `Dialog` + `DialogContent`/`DialogHeader`/
`DialogTitle`/`DialogFooter`, `Select` + `SelectTrigger`/`SelectValue`/
`SelectContent`/`SelectItem`, `DropdownMenu` + its items, `Sidebar` + its
`SidebarGroup`/`SidebarMenu`/`SidebarMenuButton` parts. Every part is exported from
the bundle even when only the family root has a card — read the family's
`.prompt.md` for the full part list before composing one.

Give `Dialog`, `AlertDialog` and `Sheet` a Title; it is the accessible name. Use
`AlertDialog` (not `Dialog`) for destructive confirmations.

### Where the truth lives

- `_ds/<folder>/styles.css` and its imports — the compiled tokens, in `:root` and
  `.dark`. Read it before inventing a color.
- `components/<group>/<Name>/<Name>.prompt.md` — per-component usage and props.
- `guidelines/` — the project's own architecture notes.

### A representative screen

```jsx
<SidebarProvider>
  <Sidebar>
    <SidebarHeader className="px-3 py-2 text-sm font-medium">Sessions</SidebarHeader>
    <SidebarContent>
      <SidebarGroup>
        <SidebarGroupLabel>codetoaster</SidebarGroupLabel>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton isActive>
              <StatusDot isConnected isExited={false} isActive />
              <span className="truncate">codetoaster · v2</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
    </SidebarContent>
  </Sidebar>

  <SidebarInset>
    <header className="flex items-center gap-2 border-b border-border px-4 py-2">
      <SidebarTrigger />
      <span className="text-sm text-muted-foreground">src/lib/xtmux/pty.ts</span>
      <Button size="sm" className="ml-auto">New session</Button>
    </header>
    <main className="flex-1 bg-background p-4" />
  </SidebarInset>
</SidebarProvider>
```
