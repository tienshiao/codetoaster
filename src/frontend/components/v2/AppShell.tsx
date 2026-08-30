import { useState, type ChangeEvent, type ReactNode } from "react";
import { ListFilter, PanelLeft, Plus, Settings } from "lucide-react";
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
  tasks?: (TaskRowProps & { id: string })[];
}

export type ShellTab = TabProps & { id: string };

/** @see TaskHeader — the band under the tabs. */
export type ShellBreadcrumb = TaskHeaderProps;

export interface AppShellProps {
  // ── left rail ──
  groups?: ShellTaskGroup[];
  taskFilter?: string;
  onTaskFilterChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  onToggleGrouping?: () => void;
  onNewTask?: () => void;
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

  defaultSidebarOpen?: boolean;
  defaultExplorerOpen?: boolean;
  className?: string;
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
  groups = [],
  taskFilter,
  onTaskFilterChange,
  onToggleGrouping,
  onNewTask,
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
  defaultSidebarOpen = true,
  defaultExplorerOpen = true,
  className,
}: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(defaultSidebarOpen);
  const [explorerOpen, setExplorerOpen] = useState(defaultExplorerOpen);
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
              <IconButton icon={ListFilter} label="Group by project" size="sm" onClick={onToggleGrouping} />
              <IconButton icon={Plus} label="New task" size="sm" onClick={onNewTask} />
            </span>
          </div>

          <div className="flex-none px-2 pt-2 pb-1.5">
            <FilterInput placeholder="Filter tasks" value={taskFilter} onChange={onTaskFilterChange} />
          </div>

          <div className="flex flex-1 flex-col gap-px overflow-y-auto px-1 pb-1">
            {groups.map((group) => (
              <ProjectGroup
                key={group.id}
                name={group.name}
                open={group.open}
                count={group.count}
                attention={group.attention}
                onToggle={group.onToggle}
              >
                {group.tasks?.map(({ id, ...task }) => <TaskRow key={id} {...task} />)}
              </ProjectGroup>
            ))}
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
          <div className="flex flex-1 flex-col gap-px overflow-y-auto px-1 py-1.5">{explorer}</div>
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
