import { useCallback, useState, type ChangeEvent, type ReactNode } from "react";
import { Archive, FilePen, GitBranch, ListFilter, PanelLeft, Plus, Settings } from "lucide-react";
import { useIsMobile } from "@/frontend/hooks/use-mobile";
import { usePaneWidth } from "@/frontend/hooks/use-pane-width";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { ExplorerRail, type ExplorerRailItem } from "./ExplorerRail";
import { FilterInput } from "./FilterInput";
import { IconButton } from "./IconButton";
import { ProjectGroup } from "./ProjectGroup";
import { ResizeHandle } from "./ResizeHandle";
import { StatusBar, type StatusBarProps } from "./StatusBar";
import { TabStrip, type TabProps } from "./TabStrip";
import { TaskRow, type TaskRowProps } from "./TaskRow";
import { cn } from "@/frontend/lib/utils";

/**
 * One row in the task list.
 *
 * `actions` is a sibling of the row, not a child of it: `TaskRow` renders a
 * `<button role="option">`, and a close or rename control nested inside it
 * would be a button in a button — invalid, and the inner click would never
 * survive the outer one. The shell positions whatever it is given over the
 * row's trailing edge and reveals it on hover *and* on keyboard focus, so the
 * actions are never hover-only.
 */
export type ShellTask = TaskRowProps & { id: string; actions?: ReactNode };

/** A project header plus the task rows under it. `open` and `onToggle` are the
 * caller's: the shell draws the list, it does not own which groups are open. */
export interface ShellTaskGroup {
  id: string;
  name: string;
  open?: boolean;
  /** Shown at the trailing edge when the group is collapsed. */
  count?: number;
  attention?: boolean;
  onToggle?: () => void;
  tasks?: ShellTask[];
  /** Header-level controls, placed the same way a row's are. */
  actions?: ReactNode;
}

/**
 * A checkout on disk that no task accounts for (§5.6).
 *
 * Deliberately not a `ShellTask`: it has no id, no state and nothing to open —
 * its path is what identifies it and deleting it is the only thing that can be
 * done with one. `actions` carries that control, for the same reason a task
 * row's does: what the button asks before it fires is the caller's business,
 * and it brings a dialog with it.
 */
export interface ShellUnclaimedWorktree {
  path: string;
  /** Null for a detached head — a real answer, not a missing one. */
  branch: string | null;
  /** Files git reports as uncommitted, or null when it could not be asked at
   * all. That null is *why* the checkout was left standing, so the row says so
   * rather than drawing a zero nobody established. */
  dirty: number | null;
  actions?: ReactNode;
}

export type ShellTab = TabProps & { id: string };

export interface AppShellProps {
  // ── left rail ──
  /** The flat, recency-ordered list (§7.5) — the default view. Rows are drawn
   * unindented, since with no group headers there is no chevron to line up
   * under. */
  tasks?: ShellTask[];
  /** The same rows under project headers, drawn instead of `tasks` when
   * `grouped` is on. */
  groups?: ShellTaskGroup[];
  /** Which of the two the sidebar shows. Defaults to grouped only for a caller
   * that passes no flat list at all, so the grouped-only call site keeps
   * working. */
  grouped?: boolean;
  taskFilter?: string;
  onTaskFilterChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  onToggleGrouping?: () => void;
  showArchived?: boolean;
  onToggleArchived?: () => void;
  /** The header's `+`. It opens the composer rather than creating anything —
   * the project, model, mode and worktree a task is decided by all live there
   * (§7.5). */
  onNewTask?: () => void;
  /** Checkouts the boot sweep found and would not delete (§5.6). A band at the
   * foot of the list rather than rows in it, because these are not tasks and
   * must not be scanned as though they were — and nothing at all when there are
   * none, which is nearly always. */
  unclaimed?: ShellUnclaimedWorktree[];
  /** Extra controls at the leading edge of the header's button cluster, for
   * affordances the shell has no opinion about — creating a project, say,
   * which brings its own dialog with it. */
  headerActions?: ReactNode;
  onOpenSettings?: () => void;
  /** The daemon's address, trailing the sidebar footer. */
  endpoint?: string;

  // ── main area ──
  /**
   * The whole tabbed region — every strip and pane — when the task has a
   * layout to draw. `TabArea` supplies it; `tabs` and `children` are then
   * unused, because with two groups on screen there is no single strip for the
   * shell to place.
   *
   * A function, not a node, because the sidebar toggle rides the first strip
   * and the shell owns whether the sidebar is open. Handing the toggle down is
   * what lets the tab area stay ignorant of the sidebar and the shell stay
   * ignorant of groups.
   */
  tabArea?: (chrome: { leading: ReactNode }) => ReactNode;
  tabs?: ShellTab[];
  onSplit?: () => void;
  onTabActions?: () => void;
  status?: StatusBarProps;
  /** The active tab's content. The shell gives it a bounded, non-scrolling box
   * — a terminal or a diff pane scrolls inside itself, never the page. The
   * composer at `/` (§7.5) is the case with no tabs at all. */
  children?: ReactNode;

  // ── explorer ──
  /** The rail's sections, in order. The rail is the Explorer's tab bar and its
   * only toggle, so this is also what can be opened. */
  explorerSections?: ExplorerRailItem[];
  explorerTab?: string;
  onExplorerTabChange?: (label: string) => void;
  explorer?: ReactNode;
  explorerFooter?: ReactNode;
  /** Controlled open state, for a caller that persists it. Falls back to
   * internal state (`defaultExplorerOpen`) when omitted — the panel's
   * collapsed state is a per-device concern, and where it is stored is not
   * the shell's business. */
  explorerOpen?: boolean;
  onExplorerOpenChange?: (open: boolean) => void;

  defaultSidebarOpen?: boolean;
  defaultExplorerOpen?: boolean;
  className?: string;
}

/**
 * A row's hover/focus actions, floated over its trailing edge.
 *
 * `opacity`, not `hidden`: a `display: none` control is not focusable, so
 * nothing could ever tab into it and `focus-within` would never fire — the
 * actions would be hover-only, which is exactly what they must not be.
 *
 * The background is the sidebar's own and not the row's, so the cluster reads
 * as a chip floating over the trailing `meta` column in every row state —
 * hovered, focused or selected — instead of having to guess which wash is
 * currently painted underneath it.
 *
 * Anything mounted in here that must outlive the hover — a dialog, a menu —
 * has to render through a portal, and `v2/Dialog` does. Opacity paints the whole
 * subtree whatever a descendant's `position` says, so a modal left in place
 * fades out the instant the pointer leaves the row while its full-screen scrim
 * goes on swallowing clicks.
 */
function RowActions({ children }: { children: ReactNode }) {
  return (
    <span
      className={cn(
        "absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5 rounded-md bg-sidebar",
        "opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100",
      )}
    >
      {children}
    </span>
  );
}

function TaskRows({ tasks }: { tasks: ShellTask[] }) {
  return tasks.map(({ id, actions, ...task }) =>
    actions ? (
      <div key={id} className="group/row relative">
        <TaskRow {...task} />
        <RowActions>{actions}</RowActions>
      </div>
    ) : (
      <TaskRow key={id} {...task} />
    ),
  );
}

/**
 * The unclaimed band: everything the sweep found on disk and could not account
 * for.
 *
 * A `div` and not a `TaskRow`, because none of a row's affordances apply — it
 * cannot be selected, opened or renamed, and giving it `role="option"` would
 * put it in the same listbox as the tasks, where an arrow key would land on
 * something that does nothing.
 *
 * Its delete sits in the row rather than in the hover cluster the task rows
 * use. Nothing here is a button, so there is no nesting to avoid, and a
 * destructive control on a card that appears once a month should not also have
 * to be discovered.
 */
function UnclaimedSection({ items }: { items: ShellUnclaimedWorktree[] }) {
  return (
    <div className="flex max-h-[35%] flex-none flex-col border-t border-sidebar-border px-1 pb-1">
      <SectionLabel className="pt-1">Unclaimed worktrees</SectionLabel>
      <div className="flex min-h-0 flex-col gap-px overflow-y-auto">
        {items.map((item) => (
          <div key={item.path} className="flex items-start gap-[9px] rounded-md px-2 py-[5px]">
            <GitBranch size={11} className="mt-[3px] flex-none text-subtle-foreground" />
            <span className="flex min-w-0 flex-1 flex-col gap-px">
              <span className="flex items-baseline gap-1.5">
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-xs",
                    // A detached head is a fact about the checkout, not a
                    // missing value, so it is stated in words — and in the muted
                    // tone, so it does not read as a branch called "detached".
                    item.branch ? "text-sidebar-foreground" : "text-muted-foreground",
                  )}
                >
                  {item.branch ?? "detached"}
                </span>
                {item.dirty == null ? (
                  <span
                    className="flex-none text-micro text-subtle-foreground"
                    title="git could not read this checkout, which is why the sweep left it alone"
                  >
                    changes unreadable
                  </span>
                ) : (
                  <span
                    className="flex flex-none items-center gap-px font-mono text-micro tracking-mono text-subtle-foreground"
                    title={`${item.dirty} uncommitted file${item.dirty === 1 ? "" : "s"}`}
                  >
                    <FilePen size={10} aria-hidden="true" />
                    {item.dirty} uncommitted
                  </span>
                )}
              </span>
              {/* The full path in the tooltip: what is on screen is a tail of a
                  path ending in two ids, and the part that identifies it to a
                  human is the part that gets truncated away. */}
              <span
                className="truncate font-mono text-micro tracking-mono text-subtle-foreground"
                title={item.path}
              >
                {item.path}
              </span>
            </span>
            {item.actions ? <span className="flex flex-none items-center">{item.actions}</span> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The 11px uppercase section label — the one piece of tracked-out type in the
 * system. Used for path headers inside the Explorer body. */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex h-[22px] flex-none items-center px-2 text-micro font-semibold uppercase",
        "tracking-label text-subtle-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * The v2 three-column shell (§7.1): task list left, tabbed main area centre,
 * Explorer right. Chrome heights come from the token layer rather than from
 * literals precisely so the three columns line up without measuring each
 * other.
 *
 * It is layout only. Every list, tab and status value arrives as a prop, so
 * the wiring tasks that follow supply data instead of restructuring markup.
 */
export function AppShell({
  tasks,
  groups = [],
  grouped = tasks === undefined,
  taskFilter,
  onTaskFilterChange,
  onToggleGrouping,
  showArchived = false,
  onToggleArchived,
  onNewTask,
  unclaimed = [],
  headerActions,
  onOpenSettings,
  endpoint,
  tabArea,
  tabs = [],
  onSplit,
  onTabActions,
  status,
  children,
  explorerSections = [],
  explorerTab,
  onExplorerTabChange,
  explorer,
  explorerFooter,
  explorerOpen: explorerOpenProp,
  onExplorerOpenChange,
  defaultSidebarOpen = true,
  defaultExplorerOpen = true,
  className,
}: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(defaultSidebarOpen);
  const [uncontrolledExplorerOpen, setUncontrolledExplorerOpen] = useState(defaultExplorerOpen);
  const explorerOpen = explorerOpenProp ?? uncontrolledExplorerOpen;
  const setExplorerOpen = (next: boolean) => {
    if (explorerOpenProp === undefined) setUncontrolledExplorerOpen(next);
    onExplorerOpenChange?.(next);
  };
  const isMobile = useIsMobile();

  const sidebarWidth = usePaneWidth("sidebar", "left");
  const explorerWidth = usePaneWidth("explorer", "right");
  // Both sidebars take their space from the main area, so it is the sibling
  // both hooks measure against, and it carries one set of flex rules for the
  // two of them — they are the same rules, and `restProps.style` does not vary.
  const mainRef = useCallback(
    (el: HTMLElement | null) => {
      sidebarWidth.restProps.ref(el);
      explorerWidth.restProps.ref(el);
    },
    [sidebarWidth.restProps.ref, explorerWidth.restProps.ref],
  );

  // A rail click on the section already showing closes the panel; any other
  // click opens it on that section. The toggle is the rail, so there is no
  // separate collapse control to confuse with Split.
  const selectSection = (label: string) => {
    if (explorerOpen && label === explorerTab) {
      setExplorerOpen(false);
      return;
    }
    setExplorerOpen(true);
    if (label !== explorerTab) onExplorerTabChange?.(label);
  };
  const activeSection = explorerSections.find((s) => s.label === explorerTab);

  const sidebarToggle = (
    <IconButton
      icon={PanelLeft}
      label={sidebarOpen ? "Hide tasks" : "Show tasks"}
      size="sm"
      active={sidebarOpen}
      onClick={() => {
        const next = !sidebarOpen;
        // In overlay mode the Explorer being open suppresses the sidebar
        // (`showSidebar` below), so a toggle that only set its own flag was a
        // dead control on a phone whenever the Explorer was showing — which,
        // since the stored Explorer state defaults to open, is the state the
        // shell boots into. Opening one panel closes the other instead, which
        // is what "one at a time is enough" was already trying to say. Read off
        // `sidebarOpen` rather than from inside an updater, so the second
        // setter is not a side effect in a function React may call twice.
        if (next && overlay) setExplorerOpen(false);
        setSidebarOpen(next);
      }}
    />
  );

  // Below the breakpoint there is no room for three columns, so an open
  // sidebar floats over the main area instead of squeezing it to nothing.
  // Both can be open at once on desktop; on a phone one at a time is enough,
  // and the scrim makes dismissing it obvious.
  const overlay = isMobile;
  const showSidebar = sidebarOpen && !(overlay && explorerOpen);
  const showExplorer = explorerOpen;

  return (
    <div
      className={cn(
        "relative flex h-full w-full overflow-hidden bg-background text-foreground",
        "font-sans text-sm leading-ui tracking-ui",
        className,
      )}
    >
      {showSidebar && (
        <aside
          ref={sidebarWidth.paneProps.ref}
          style={overlay ? undefined : sidebarWidth.paneProps.style}
          className={cn(
            "flex min-w-0 flex-col border-r border-sidebar-border bg-sidebar",
            overlay && "w-sidebar flex-none absolute inset-y-0 left-0 z-20 shadow-overlay",
          )}
        >
          <div className="flex h-titlebar flex-none items-center gap-2 border-b border-sidebar-border pr-2 pl-2.5">
            {/* No logo exists, and none was invented: the wordmark is the mark. */}
            <span className="font-semibold">CodeToaster</span>
            <Badge>v2</Badge>
            <span className="ml-auto flex gap-0.5">
              {headerActions}
              <IconButton
                icon={ListFilter}
                label="Group by project"
                size="sm"
                active={grouped}
                onClick={onToggleGrouping}
              />
              <IconButton icon={Plus} label="New task" size="sm" onClick={onNewTask} />
            </span>
          </div>

          {/* The archived toggle sits with the filter and not in the header
              because it is the same kind of control: both change which rows
              the list is showing, and neither creates anything. */}
          <div className="flex flex-none items-center gap-1 px-2 pt-2 pb-1.5">
            <FilterInput
              placeholder="Filter tasks"
              value={taskFilter}
              onChange={onTaskFilterChange}
              // No key hint while nothing binds one. The v1 command palette
              // owned ⌘K and went with the session routes (TASK-21); TASK-35
              // builds it back over tasks and tabs, and can turn the hint on
              // when there is something behind it. A label promising a
              // shortcut that does nothing is worse than no label.
              shortcut={null}
              className="min-w-0 flex-1"
            />
            {onToggleArchived && (
              <IconButton
                icon={Archive}
                label={showArchived ? "Hide archived" : "Show archived"}
                size="sm"
                active={showArchived}
                onClick={onToggleArchived}
              />
            )}
          </div>

          <div className="flex flex-1 flex-col gap-px overflow-y-auto px-1 pb-1">
            {grouped ? (
              groups.map((group) => (
                // Its own group name, not `row`: the task rows inside declare
                // `group/row` too, and sharing the name would surface the
                // project's controls every time a row under it was hovered.
                <div key={group.id} className="group/project relative flex flex-col gap-px">
                  <ProjectGroup
                    name={group.name}
                    open={group.open}
                    count={group.count}
                    attention={group.attention}
                    onToggle={group.onToggle}
                  >
                    <TaskRows tasks={group.tasks ?? []} />
                  </ProjectGroup>
                  {group.actions && (
                    // Pinned to the header row rather than centred on the
                    // group, whose height is however many tasks are in it.
                    <span
                      className={cn(
                        "absolute top-0 right-1 flex h-group items-center gap-0.5 rounded-md bg-sidebar",
                        "opacity-0 group-hover/project:opacity-100 group-focus-within/project:opacity-100",
                      )}
                    >
                      {group.actions}
                    </span>
                  )}
                </div>
              ))
            ) : (
              <TaskRows tasks={tasks ?? []} />
            )}
          </div>

          {unclaimed.length > 0 && <UnclaimedSection items={unclaimed} />}

          <div className="flex h-titlebar flex-none items-center gap-2 border-t border-sidebar-border pr-2 pl-1 text-xs text-muted-foreground">
            {/* One control, not a gear with a caption beside it. The word reads
                as the button's label either way, so leaving it outside made the
                whole affordance a 13px glyph — the smallest target in the shell,
                for the only way into settings — and put a click target where
                there was no focus ring and no keyboard.
                `Button` rather than `IconButton`, which is square by
                construction and has nowhere to put a label; ghost/sm is what
                the footer was already drawing by hand. */}
            <Button variant="ghost" size="sm" icon={Settings} onClick={onOpenSettings}>
              Settings
            </Button>
            {endpoint && (
              <span className="ml-auto font-mono text-micro tracking-mono text-subtle-foreground">{endpoint}</span>
            )}
          </div>
        </aside>
      )}

      {/* Nothing to drag while a panel is floating: an overlay sits *over* the
          main area rather than taking width from it, so there is no boundary
          between the two for a divider to move. */}
      {showSidebar && !overlay && (
        <ResizeHandle
          label="Resize task list"
          onResizeStart={sidebarWidth.onResizeStart}
          onResize={sidebarWidth.onResize}
          onResizeEnd={sidebarWidth.onResizeEnd}
          onNudge={sidebarWidth.onNudge}
        />
      )}

      <main
        ref={mainRef}
        style={overlay ? undefined : sidebarWidth.restProps.style}
        className={cn("flex min-w-0 flex-col bg-pane", overlay && "flex-1")}
      >
        {/* The sidebar toggles ride the tab strip, at the outer edges of the
            chrome they open — so each one sits against the sidebar it controls
            and stays put whether that sidebar is open or shut. */}
        {tabArea ? (
          tabArea({ leading: sidebarToggle })
        ) : (
          <>
            <TabStrip
              tabs={tabs}
              onSplit={onSplit}
              onTabActions={onTabActions}
              leading={sidebarToggle}
            />
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</div>
          </>
        )}

        {status && <StatusBar {...status} />}
      </main>

      {showExplorer && !overlay && (
        <ResizeHandle
          label="Resize Explorer"
          onResizeStart={explorerWidth.onResizeStart}
          onResize={explorerWidth.onResize}
          onResizeEnd={explorerWidth.onResizeEnd}
          onNudge={explorerWidth.onNudge}
        />
      )}

      {showExplorer && (
        <aside
          ref={explorerWidth.paneProps.ref}
          style={overlay ? undefined : explorerWidth.paneProps.style}
          className={cn(
            "flex min-w-0 flex-col border-l border-sidebar-border bg-sidebar",
            // On a phone the panel floats left of the rail, which stays put —
            // it is the only way back to the other sections.
            overlay && "w-sidebar-right flex-none absolute inset-y-0 right-9 z-20 shadow-overlay",
          )}
        >
          <div className="flex h-titlebar flex-none items-center gap-2 border-b border-sidebar-border px-3">
            <span className="truncate text-micro font-semibold uppercase tracking-label text-muted-foreground">
              {explorerTab}
            </span>
            {activeSection?.count != null && (
              <span className="font-mono text-micro tracking-mono text-subtle-foreground">
                {activeSection.count}
              </span>
            )}
          </div>
          {/* Bounded, not scrolling. The sections bring their own filter
              headers and scrollers, and the commit list virtualizes against
              its own scroll element — an outer `overflow-y-auto` would hand it
              an unbounded viewport and it would render every row. */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{explorer}</div>
          {explorerFooter && (
            <div className="flex flex-none gap-1.5 border-t border-sidebar-border p-2">{explorerFooter}</div>
          )}
        </aside>
      )}

      <ExplorerRail
        items={explorerSections}
        value={explorerOpen ? explorerTab : null}
        onSelect={selectSection}
        className={overlay ? "z-20" : undefined}
      />

      {overlay && (showSidebar || showExplorer) && (
        <button
          type="button"
          aria-label="Close panel"
          className="absolute inset-0 z-10 bg-[oklch(0_0_0/0.45)]"
          onClick={() => {
            setSidebarOpen(false);
            setExplorerOpen(false);
          }}
        />
      )}
    </div>
  );
}
