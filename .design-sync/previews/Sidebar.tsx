// NOTE ON SIZING: ds-bundle's Tailwind CSS is compiled by package-build, which
// subagents may not run, so a utility this repo does not already use (w-64,
// h-[440px] …) has no rule and silently does nothing. Every non-standard
// dimension below is an inline style; class names stay inside the semantic-
// token vocabulary the app already ships. `w-(--sidebar-width)` on Sidebar
// itself IS shipped, so the 16rem column comes out right.
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarSeparator,
  StatusDot,
  Button,
} from "codetoaster";
import {
  ChevronDown,
  CircleHelp,
  EllipsisVertical,
  FileDiff,
  Files,
  FolderPlus,
  GitBranch,
  Plus,
  Settings,
  Terminal,
} from "lucide-react";

type Row = {
  label: string;
  active?: boolean;
  running?: boolean;
  exited?: boolean;
  suspended?: boolean;
  resuming?: boolean;
  unread?: boolean;
};

const projects: Array<{ name: string; sessions: Row[] }> = [
  {
    name: "codetoaster",
    sessions: [
      { label: "codetoaster · v2", active: true, running: true },
      { label: "codetoaster · main", unread: true },
      { label: "harvester · task-15", suspended: true },
    ],
  },
  {
    name: "api-gateway",
    sessions: [
      { label: "api-gateway · main" },
      { label: "api-gateway · deploy", exited: true },
    ],
  },
  {
    name: "General",
    sessions: [{ label: "notes · scratch", suspended: true, resuming: true }],
  },
];

const SessionRow = ({ s }: { s: Row }) => (
  <SidebarMenuItem>
    <SidebarMenuButton isActive={s.active} className="rounded-md pl-4">
      <StatusDot
        isConnected={!s.suspended && !s.exited}
        isExited={!!s.exited}
        isActive={!!s.running}
        isSuspended={!!s.suspended}
        isResuming={!!s.resuming}
        hasNotification={!!s.unread}
      />
      <span className={`flex-1 truncate${s.suspended ? " text-muted-foreground" : ""}`}>
        {s.label}
      </span>
      {s.resuming && <span className="text-[10px] text-muted-foreground">Resuming…</span>}
    </SidebarMenuButton>
    <SidebarMenuAction className="text-muted-foreground">
      <EllipsisVertical />
    </SidebarMenuAction>
  </SidebarMenuItem>
);

const SidebarBody = () => (
  <>
    <SidebarHeader className="h-10 flex-row items-center justify-between border-b border-sidebar-border px-3 py-0 text-xs font-semibold tracking-wide uppercase text-muted-foreground">
      CodeToaster
      <div className="flex gap-1">
        <Button variant="ghost" size="icon" className="size-5 text-muted-foreground">
          <FolderPlus className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" className="size-5 text-muted-foreground">
          <Plus className="size-4" />
        </Button>
      </div>
    </SidebarHeader>
    <SidebarContent className="gap-3 pt-3">
      {projects.map((p) => (
        <SidebarGroup key={p.name} className="p-0">
          <div className="flex h-7 items-center gap-1 px-2 text-[11px] font-semibold tracking-wide text-muted-foreground">
            <ChevronDown className="size-3.5 shrink-0" />
            <span className="flex-1 truncate">{p.name}</span>
            <EllipsisVertical className="size-4 shrink-0 opacity-60" />
          </div>
          <SidebarMenu className="gap-0.5 px-2">
            {p.sessions.map((s) => (
              <SessionRow key={s.label} s={s} />
            ))}
          </SidebarMenu>
        </SidebarGroup>
      ))}
    </SidebarContent>
    <SidebarFooter className="border-t border-sidebar-border p-2">
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" className="size-7 text-muted-foreground">
          <Settings className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" className="size-7 text-muted-foreground">
          <CircleHelp className="size-4" />
        </Button>
      </div>
    </SidebarFooter>
  </>
);

const TabLabel = ({ children, active }: { children: React.ReactNode; active?: boolean }) => (
  <span className={`flex items-center gap-1${active ? "" : " opacity-60"}`}>{children}</span>
);

/**
 * The whole app frame: `SidebarProvider` wrapping the session sidebar and the
 * `SidebarInset` that holds the top bar and the terminal.
 *
 * `collapsible="none"` keeps the sidebar in normal flow — the default
 * `offcanvas` container is `fixed inset-y-0 h-svh` and escapes any bounded box.
 */
export const AppShell = () => (
  <SidebarProvider
    className="min-h-0 overflow-hidden rounded-lg border border-border"
    style={{ height: 440, width: 800 }}
  >
    <Sidebar collapsible="none" className="border-r border-sidebar-border">
      <SidebarBody />
    </Sidebar>
    <SidebarInset>
      <div className="flex min-h-10 items-center gap-2 border-b border-sidebar-border bg-sidebar px-3 text-xs text-muted-foreground">
        <StatusDot isConnected isExited={false} isActive />
        <span className="truncate">codetoaster · v2</span>
        <div className="ml-auto flex items-center gap-3">
          <TabLabel active>
            <Terminal className="h-3 w-3" /> Terminal
          </TabLabel>
          <TabLabel>
            <FileDiff className="h-3 w-3" /> Diff
          </TabLabel>
          <TabLabel>
            <Files className="h-3 w-3" /> Files
          </TabLabel>
          <TabLabel>
            <GitBranch className="h-3 w-3" /> Git
          </TabLabel>
        </div>
      </div>
      <div className="flex-1 bg-background p-3 font-mono text-xs leading-5">
        <div className="text-muted-foreground">~/Projects/codetoaster (v2)</div>
        <div className="text-foreground">$ bun test src/lib/tasks</div>
        <div className="text-muted-foreground">bun test v1.2.4</div>
        <div className="text-foreground">✓ suspends only after the idle window</div>
        <div className="text-foreground">✓ restores scrollback before attaching</div>
        <div className="text-muted-foreground"> 24 pass, 0 fail — 312ms</div>
        <div className="text-foreground">$ █</div>
      </div>
    </SidebarInset>
  </SidebarProvider>
);

/**
 * The sidebar on its own — projects grouped, every session carrying its live
 * status: running, unread output, exited, suspended, resuming.
 */
export const SessionsSidebar = () => (
  <SidebarProvider
    className="min-h-0 overflow-hidden rounded-lg border border-border"
    style={{ height: 440, width: 258 }}
  >
    <Sidebar collapsible="none">
      <SidebarBody />
    </Sidebar>
  </SidebarProvider>
);

/**
 * Menu row anatomy: the active row, a hover row action, an unread count badge,
 * and a sub-menu for the views open under one session.
 */
export const MenuStates = () => (
  <SidebarProvider
    className="min-h-0 overflow-hidden rounded-lg border border-border"
    style={{ width: 258 }}
  >
    <Sidebar collapsible="none" className="h-auto">
      <SidebarGroup>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton isActive>
              <StatusDot isConnected isExited={false} isActive />
              <span>codetoaster · v2</span>
            </SidebarMenuButton>
            <SidebarMenuAction className="text-muted-foreground">
              <EllipsisVertical />
            </SidebarMenuAction>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton>
              <StatusDot isConnected isExited={false} isActive={false} hasNotification />
              <span>api-gateway · main</span>
            </SidebarMenuButton>
            <SidebarMenuBadge>3</SidebarMenuBadge>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton>
              <StatusDot isConnected={false} isExited={false} isActive={false} isSuspended />
              <span className="text-muted-foreground">harvester · task-15</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarSeparator className="my-1" />
          <SidebarMenuItem>
            <SidebarMenuButton>
              <Terminal />
              <span>docs-site · draft</span>
            </SidebarMenuButton>
            <SidebarMenuSub>
              <SidebarMenuSubItem>
                <SidebarMenuSubButton isActive>
                  <FileDiff />
                  <span>Diff</span>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
              <SidebarMenuSubItem>
                <SidebarMenuSubButton>
                  <Files />
                  <span>Files</span>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            </SidebarMenuSub>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
    </Sidebar>
  </SidebarProvider>
);
