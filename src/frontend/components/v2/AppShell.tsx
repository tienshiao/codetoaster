import { useState, type ChangeEvent, type ReactNode } from "react";
import { Archive, ListFilter, PanelLeft, Plus, Settings } from "lucide-react";
import { useIsMobile } from "@/frontend/hooks/use-mobile";
import { Badge } from "./Badge";
import { ExplorerRail, type ExplorerRailItem } from "./ExplorerRail";
import { FilterInput } from "./FilterInput";
import { IconButton } from "./IconButton";
import { ProjectGroup } from "./ProjectGroup";
import { StatusBar, type StatusBarProps } from "./StatusBar";
import { TabStrip, type TabProps } from "./TabStrip";
import { TaskHeader, type TaskHeaderProps } from "./TaskHeader";
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

export type ShellTab = TabProps & { id: string };

/** @see TaskHeader — the band under the tabs. */
export type ShellBreadcrumb = TaskHeaderProps;

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
  onNewTask?: () => void;
  /** Extra controls at the leading edge of the header's button cluster, for
   * affordances the shell has no opinion about — creating a project, say,
   * which brings its own dialog with it. */
  headerActions?: ReactNode;
  onOpenSettings?: () => void;
  /** The daemon's address, trailing the sidebar footer. */
  endpoint?: string;

  // ── main area ──
  /**
   * The whole tabbed region — every strip, header and pane — when the task has
   * a layout to draw. `TabArea` supplies it; `tabs`, `breadcrumb` and
   * `children` are then unused, because with two groups on screen there is no
   * single strip or header for the shell to place.
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
  breadcrumb?: ShellBreadcrumb;
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
  headerActions,
  onOpenSettings,
  endpoint,
  tabArea,
  tabs = [],
  onSplit,
  onTabActions,
  breadcrumb,
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
      onClick={() => setSidebarOpen((open) => !open)}
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
          className={cn(
            "flex w-sidebar min-w-0 flex-none flex-col border-r border-sidebar-border bg-sidebar",
            overlay && "absolute inset-y-0 left-0 z-20 shadow-overlay",
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

          <div className="flex h-titlebar flex-none items-center gap-2 border-t border-sidebar-border pr-2 pl-2.5 text-xs text-muted-foreground">
            <IconButton icon={Settings} label="Settings" size="sm" onClick={onOpenSettings} />
            <span>Settings</span>
            {endpoint && (
              <span className="ml-auto font-mono text-micro tracking-mono text-subtle-foreground">{endpoint}</span>
            )}
          </div>
        </aside>
      )}

      <main className="flex min-w-0 flex-1 flex-col bg-pane">
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
            {breadcrumb && <TaskHeader {...breadcrumb} />}
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</div>
          </>
        )}

        {status && <StatusBar {...status} />}
      </main>

      {showExplorer && (
        <aside
          className={cn(
            "flex w-sidebar-right min-w-0 flex-none flex-col border-l border-sidebar-border bg-sidebar",
            // On a phone the panel floats left of the rail, which stays put —
            // it is the only way back to the other sections.
            overlay && "absolute inset-y-0 right-9 z-20 shadow-overlay",
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
