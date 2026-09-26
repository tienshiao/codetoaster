import { useMemo, type ReactNode } from "react";
import { ArrowDownUp } from "lucide-react";
import { rootId, type RepoRoot } from "@/frontend/repo-root";
import {
  Badge,
  ExplorerTabs,
  FilterInput,
  SectionLabel,
  Select,
} from "@/frontend/components/v2";
import {
  ExplorerError,
  ExplorerLoading,
  ExplorerNote,
} from "@/frontend/components/explorer-notes";
import { BACKLOG_TABS, type BacklogTab } from "@/frontend/explorer-store";
import { useBacklog } from "@/frontend/hooks/use-backlog";
import { useHoverPointer } from "@/frontend/hooks/use-hover-pointer";
import { useViewState } from "@/frontend/hooks/use-view-state";
import { viewRef } from "@/frontend/view-state-store";
import {
  BACKLOG_SORTS,
  BACKLOG_SORT_LABELS,
  defaultBacklogSort,
  groupBacklog,
  isBacklogSort,
  resolveBacklogSort,
  type BacklogSort,
} from "./backlog-list";
import { BacklogHoverCard } from "./BacklogHoverCard";
import { cn } from "@/frontend/lib/utils";
import type { TabDescriptor } from "@/frontend/layout-store";
import type { BacklogTask } from "@/types/backlog";

/**
 * The Explorer's Backlog section (TASK-85): the repository's Backlog.md tasks,
 * split into Open and Closed, each card opening the task's own `.md`. A filter
 * and a per-tab sort sit under the tabs (TASK-118); what they do to the list is
 * `backlog-list.ts`, which this only wires to the view-state store.
 *
 * The rail only offers this section when the route reported `detected`, so the
 * undetected branch below is the one narrow case where a *stored* section names
 * Backlog for a repository that is not one — the shell falls back to Changes,
 * and this is what shows in the frame before it does.
 */

export interface BacklogSectionProps {
  root: RepoRoot;
  backlogTab: BacklogTab;
  onBacklogTabChange: (tab: BacklogTab) => void;
  open: (descriptor: TabDescriptor) => void;
  handlers: { onClick: () => void; onDoubleClick: () => void };
}

/** Polled rather than pushed: a task the agent files or moves has to appear
 * without a reload, and the Explorer unmounts the sections it is not showing —
 * so the interval, which react-query keeps per observer, stops the moment the
 * section is hidden without anything having to tell it. */
const POLL_MS = 3000;

const SORT_OPTIONS = BACKLOG_SORTS.map((value) => ({ value, label: BACKLOG_SORT_LABELS[value] }));

export function BacklogSection({
  root,
  backlogTab,
  onBacklogTabChange,
  open,
  handlers,
}: BacklogSectionProps): ReactNode {
  const { data, error, refetch } = useBacklog(root, { refetchInterval: POLL_MS });

  // Per root, in the Explorer's own slot, so the filter and sorts outlive the
  // section unmounting (the Explorer mounts one section at a time) and each
  // task keeps its own.
  const view = useMemo(() => viewRef(rootId(root), "explorer"), [root]);
  const [storedFilter, setFilter] = useViewState("explorer", view, "backlogFilter");
  const [storedOpenSort, setOpenSort] = useViewState("explorer", view, "backlogOpenSort");
  const [storedClosedSort, setClosedSort] = useViewState("explorer", view, "backlogClosedSort");
  // Persisted values come back unchecked; a non-string is a corrupt entry.
  const filter = typeof storedFilter === "string" ? storedFilter : "";
  const openSort = resolveBacklogSort("Open", storedOpenSort);
  const closedSort = resolveBacklogSort("Closed", storedClosedSort);

  const grouped = useMemo(
    () => groupBacklog(data?.detected ? data : null, { filter, openSort, closedSort }),
    [data, filter, openSort, closedSort],
  );

  // "Nothing has answered yet", rather than `isLoading`: React Query's
  // `isLoading` is `isPending && isFetching`, so a first load the browser has
  // *paused* — offline, the laptop the comment below is about before its wifi is
  // back — is pending with nothing in flight, and the cascade below would fall
  // through to claim the repository has no backlog at all.
  if (!data && !error) return <ExplorerLoading>Loading tasks…</ExplorerLoading>;

  // The error *replaces* the section only when there is nothing to show instead.
  // This polls every three seconds, so swapping a perfectly good list for an
  // error box on a failed poll — a server restart, a laptop waking up — would
  // take away what the user was reading. React Query keeps the last data
  // through a failed refetch, and that list is still the best thing to show.
  //
  // With data in hand the failure is said in a line above it instead (below), so
  // a poll that has stopped working is never silent: `retry: 1` on the client
  // means `error` is already two consecutive failures rather than one blip, and
  // a list that quietly stopped refreshing looks exactly like a repository
  // where nothing is happening.
  if (error && !data) {
    return (
      <ExplorerError onRetry={() => refetch()}>
        {error instanceof Error ? error.message : String(error)}
      </ExplorerError>
    );
  }

  if (!data?.detected) return <ExplorerNote>Not a Backlog.md repository.</ExplorerNote>;

  const closedTab = backlogTab === "Closed";
  const showing = closedTab ? grouped.closed : grouped.open;
  const sort = closedTab ? closedSort : openSort;
  // The tab's default is stored as null rather than as itself, so a later build
  // that changes a default moves everyone who never chose.
  const setSort = (next: BacklogSort) => {
    const value = next === defaultBacklogSort(backlogTab) ? null : next;
    if (closedTab) setClosedSort(value);
    else setOpenSort(value);
  };

  return (
    <div className="flex h-full min-h-0 flex-col" {...handlers}>
      {/* Above the tabs rather than over them: the list underneath is stale but
          still readable, and the Retry is the only way back for a poll whose
          failures the interval is not going to fix on its own. */}
      {error ? (
        <ExplorerError onRetry={() => refetch()}>
          Could not refresh: {error instanceof Error ? error.message : String(error)}
        </ExplorerError>
      ) : null}
      <ExplorerTabs
        tabs={BACKLOG_TABS.map((label) => ({
          label,
          count: label === "Closed" ? grouped.closedCount : grouped.openCount,
        }))}
        value={backlogTab}
        onChange={(label) => {
          if (label === "Open" || label === "Closed") onBacklogTabChange(label);
        }}
      />
      {/* One filter for both tabs, so switching tabs while hunting for a task
          keeps the hunt; the sort is the showing tab's own. */}
      <div
        className="flex flex-none items-center gap-1 px-2 pt-2 pb-1"
        onKeyDown={(e) => {
          if (e.key === "Escape" && filter) {
            e.stopPropagation();
            setFilter("");
          }
        }}
      >
        <FilterInput
          className="min-w-0 flex-1"
          placeholder="Filter tasks"
          shortcut={null}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <Select
          size="sm"
          icon={ArrowDownUp}
          aria-label="Sort"
          options={SORT_OPTIONS}
          value={sort}
          onValueChange={(next) => {
            if (isBacklogSort(next)) setSort(next);
          }}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {showing.length === 0 ? (
          <ExplorerNote>{filter.trim() ? "No matching tasks." : "No tasks."}</ExplorerNote>
        ) : (
          showing.map((group) => (
            <div key={group.status}>
              {/* Closed is one status by definition, so it says nothing a header
                  would repeat. */}
              {group.header ? <SectionLabel>{group.status}</SectionLabel> : null}
              {group.tasks.map((task) => (
                <BacklogCard
                  key={task.id + task.path}
                  task={task}
                  onOpen={() => open({ kind: "file", path: task.path })}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── the card ────────────────────────────────────────────────────────────────

/** High is the only priority worth an alarm colour; the rest are notes. */
function priorityTone(priority: string): "danger" | "warning" | "neutral" {
  const value = priority.toLowerCase();
  if (value === "high") return "danger";
  if (value === "medium") return "warning";
  return "neutral";
}

function BacklogCard({ task, onOpen }: { task: BacklogTask; onOpen: () => void }) {
  const chips = task.priority || task.labels.length > 0;
  const hoverable = useHoverPointer();
  return (
    // Every card gets a hover card — always, not only the truncated ones
    // (TASK-114 AC #4), by the rule and for the reasons the commit rows gave.
    // The row drops the assignee, the dates and the description for every task,
    // so the card always carries something the row does not whatever the
    // title's length; and a rule conditioned on measured truncation would have
    // to be re-measured as the panel resizes, so cards would come and go under
    // a pointer that had not moved.
    //
    <BacklogHoverCard task={task}>
      <button
        type="button"
        onClick={onOpen}
        // The native `title` only where the shell mounts no card: with one, the
        // browser's tooltip would open on top of it and say the title a second
        // time; without one — a device with a coarse pointer attached, see
        // `useHoverPointer` — the tooltip is the only way left to read a title
        // the row truncates, and it was there before the card was.
        title={hoverable ? undefined : task.title}
        aria-label={`${task.id} ${task.title}`}
        className={cn(
          "flex w-full cursor-pointer flex-col items-stretch gap-0.5 rounded-md px-2 py-1 text-left",
          "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
          "text-foreground hover:bg-hover",
        )}
      >
        <span className="flex min-h-5 items-center gap-2">
          <span className="flex-none font-mono text-micro tracking-mono text-subtle-foreground">
            {task.id}
          </span>
          <span className="min-w-0 flex-1 truncate text-xs">{task.title}</span>
        </span>
        {/* Chips on their own line: beside the title they took its width, and a
            card whose title reads "T…" next to three labels says nothing. */}
        {chips ? (
          <span className="flex flex-wrap items-center gap-1">
            {task.priority ? (
              <Badge tone={priorityTone(task.priority)} mono={false}>
                {task.priority}
              </Badge>
            ) : null}
            {task.labels.map((label) => (
              <Badge key={label} tone="neutral" mono={false}>
                {label}
              </Badge>
            ))}
          </span>
        ) : null}
      </button>
    </BacklogHoverCard>
  );
}
