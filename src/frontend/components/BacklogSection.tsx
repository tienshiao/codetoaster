import { useMemo, type ReactNode } from "react";
import { Badge, ExplorerTabs, SectionLabel } from "@/frontend/components/v2";
import {
  ExplorerError,
  ExplorerLoading,
  ExplorerNote,
} from "@/frontend/components/explorer-notes";
import { BACKLOG_TABS, type BacklogTab } from "@/frontend/explorer-store";
import { useBacklog } from "@/frontend/hooks/use-backlog";
import { cn } from "@/frontend/lib/utils";
import type { TabDescriptor } from "@/frontend/layout-store";
import type { BacklogTask } from "@/types/backlog";

/**
 * The Explorer's Backlog section (TASK-85): the repository's Backlog.md tasks,
 * split into Open and Closed, each card opening the task's own `.md`.
 *
 * The rail only offers this section when the route reported `detected`, so the
 * undetected branch below is the one narrow case where a *stored* section names
 * Backlog for a repository that is not one — the shell falls back to Changes,
 * and this is what shows in the frame before it does.
 */

export interface BacklogSectionProps {
  taskId: string;
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

export function BacklogSection({
  taskId,
  backlogTab,
  onBacklogTabChange,
  open,
  handlers,
}: BacklogSectionProps): ReactNode {
  const { data, error, refetch } = useBacklog(taskId, { refetchInterval: POLL_MS });

  const grouped = useMemo(() => groupBacklog(data?.detected ? data : null), [data]);

  // "Nothing has answered yet", rather than `isLoading`: React Query's
  // `isLoading` is `isPending && isFetching`, so a first load the browser has
  // *paused* — offline, the laptop the comment below is about before its wifi is
  // back — is pending with nothing in flight, and the cascade below would fall
  // through to claim the repository has no backlog at all.
  if (!data && !error) return <ExplorerLoading>Loading tasks…</ExplorerLoading>;

  // Only when there is nothing to show instead. This polls every three seconds,
  // so a single failed poll — a server restart, a laptop waking up — would
  // otherwise replace a perfectly good list with an error box until the next one
  // succeeds. React Query keeps the last data through a failed refetch; the
  // list it holds is what the user was reading.
  if (error && !data) {
    return (
      <ExplorerError onRetry={() => refetch()}>
        {error instanceof Error ? error.message : String(error)}
      </ExplorerError>
    );
  }

  if (!data?.detected) return <ExplorerNote>Not a Backlog.md repository.</ExplorerNote>;

  const showing = backlogTab === "Closed" ? grouped.closed : grouped.open;

  return (
    <div className="flex h-full min-h-0 flex-col" {...handlers}>
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
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {showing.length === 0 ? (
          <ExplorerNote>No tasks.</ExplorerNote>
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

// ── grouping ────────────────────────────────────────────────────────────────

interface StatusGroup {
  status: string;
  header: boolean;
  tasks: BacklogTask[];
}

interface Grouped {
  open: StatusGroup[];
  closed: StatusGroup[];
  openCount: number;
  closedCount: number;
}

const EMPTY: Grouped = { open: [], closed: [], openCount: 0, closedCount: 0 };

/**
 * The response's tasks, split at the terminal status and grouped for display.
 *
 * The order within a status is the response's own — Backlog.md's board order —
 * so nothing here sorts. What it does decide is the order of the *headers*:
 * the configured statuses reversed with the terminal one dropped, which puts In
 * Progress above To Do for the default configuration and does the equivalent
 * for a longer one without naming a status.
 *
 * A status the configuration does not list still gets a header, at the end: a
 * hand-edited file with a typo'd status would otherwise take its task off both
 * tabs, and a task list that silently loses a row is worse than an odd header.
 */
function groupBacklog(data: { statuses: string[]; tasks: BacklogTask[] } | null): Grouped {
  if (!data) return EMPTY;
  const terminal = data.statuses[data.statuses.length - 1];

  const byStatus = new Map<string, BacklogTask[]>();
  for (const task of data.tasks) {
    const bucket = byStatus.get(task.status);
    if (bucket) bucket.push(task);
    else byStatus.set(task.status, [task]);
  }

  const openGroups: StatusGroup[] = [];
  for (const status of [...data.statuses].reverse()) {
    if (status === terminal) continue;
    const tasks = byStatus.get(status);
    if (tasks?.length) openGroups.push({ status, header: true, tasks });
  }
  for (const [status, tasks] of byStatus) {
    if (status === terminal || data.statuses.includes(status)) continue;
    openGroups.push({ status, header: true, tasks });
  }

  const closedTasks = terminal ? (byStatus.get(terminal) ?? []) : [];
  const closed: StatusGroup[] =
    closedTasks.length === 0 ? [] : [{ status: terminal!, header: false, tasks: closedTasks }];

  return {
    open: openGroups,
    closed,
    openCount: openGroups.reduce((n, g) => n + g.tasks.length, 0),
    closedCount: closedTasks.length,
  };
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
  return (
    <button
      type="button"
      onClick={onOpen}
      // The full title in `title`, because at 272px a readable title is what
      // gets truncated.
      title={task.title}
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
  );
}
