import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { FileDiff, Files, GitBranch, GitCommitHorizontal } from "lucide-react";
import type { ExplorerRailItem } from "@/frontend/components/v2/ExplorerRail";
import { taskStateOf, useTasks } from "@/frontend/TaskContext";
import { sessionDisplayNames } from "@/lib/xtmux/naming";
import type { TaskInfo } from "@/lib/xtmux/types";
import {
  AppShell,
  SectionLabel,
  type ShellTaskGroup,
} from "@/frontend/components/v2/AppShell";
import { Badge } from "@/frontend/components/v2/Badge";
import { Button } from "@/frontend/components/v2/Button";
import { FileRow } from "@/frontend/components/v2/FileRow";
import { TaskHeader } from "@/frontend/components/v2/TaskHeader";
import { TabArea, useTaskLayout } from "@/frontend/components/tabs";
import { openTab, type TabState } from "@/frontend/layout-store";

export const Route = createFileRoute("/shell")({
  component: ShellPreview,
});

// The Explorer's four sections (§7.1). Glyphs match the tab kinds each section
// opens, so a rail icon and the tab it produces read as the same thing.
const EXPLORER_SECTIONS: ExplorerRailItem[] = [
  { label: "Changes", icon: FileDiff, count: 5 },
  { label: "Files", icon: Files },
  { label: "Commits", icon: GitCommitHorizontal },
  { label: "Refs", icon: GitBranch },
];

/** Coarse and mono, the way the design wants a timestamp: the list is scanned,
 * not read. */
function ago(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/**
 * The v2 app shell, at `/shell` until TASK-28 puts it at `/`.
 *
 * The left column is live: real tasks from `TaskContext`, in the design's rows.
 * The tab area is live too — a real `TaskLayout` per task, persisted, with
 * drag, split, close and preview tabs (TASK-22). What a pane *contains* is
 * still fixture: TASK-23 brings the hosts, TASK-26 the Explorer, and the agent
 * terminal arrives with the tab host that knows which PTY it is showing.
 *
 * Ordering, the filter and the archived toggle are deliberately not built here:
 * this is TaskContext's data in the shell, not TASK-25's sidebar.
 */
function ShellPreview() {
  const { tasks, projects, loaded, createTask } = useTasks();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [explorerTab, setExplorerTab] = useState("Changes");
  // Only the groups the user has closed; everything else defaults open.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  // A real layout for the selected task, persisted per task id.
  const { layout, setLayout } = useTaskLayout(selectedTaskId);

  const toggleGroup = (id: string) =>
    setOpenGroups((open) => ({ ...open, [id]: !open[id] }));

  // Live, from TaskContext. Grouped by project because that is what the socket
  // hands over today; recency ordering, the filter and the archived toggle are
  // TASK-25's, so this is the store's data in the design's rows and nothing
  // more.
  const needle = filter.trim().toLowerCase();
  // The label is projected, not stored: an explicit rename, else the live
  // terminal title when it carries real content *and is unique*, else the
  // stable name. Claude Code sits on a bare "Claude Code" until it has a task,
  // so without this every agent task in the list reads identically — which is
  // the failure the projection exists to prevent (naming.ts).
  const displayNames = useMemo(
    () =>
      sessionDisplayNames(
        tasks.map((t) => ({
          id: t.id,
          name: t.title,
          nameSource: t.titleSource,
          title: t.terminalTitle,
        })),
      ),
    [tasks],
  );
  const groups: ShellTaskGroup[] = useMemo(() => {
    // Read inside the memo, not in the render body: as a dependency it changes
    // on every render, which would rebuild the whole list on every keystroke
    // and every activity delta — the memo would never hit. Ages are coarse
    // enough that recomputing them whenever the list actually changes is the
    // resolution this display has anyway.
    const now = Date.now();
    const byId = new Map(tasks.map((t) => [t.id, t]));
    // Matched against the label on screen, not the stored title. They differ
    // whenever the projection wins — a task named by its terminal title reads
    // "Fix the parser" while its row still says "<dir> · <branch>" — so
    // filtering on the row would hide the task the user just typed the name of.
    const matches = (task: TaskInfo) =>
      !needle || (displayNames.get(task.id) ?? task.title).toLowerCase().includes(needle);
    return projects.map((project) => {
      const rows = project.taskIds
        .map((id) => byId.get(id))
        .filter((t): t is NonNullable<typeof t> => t != null)
        .filter(matches);
      return {
        id: project.id,
        name: project.name,
        open: openGroups[project.id] ?? true,
        count: rows.length,
        attention: rows.some((t) => taskStateOf(t) === "attention"),
        onToggle: () => toggleGroup(project.id),
        tasks: rows.map((task) => ({
          id: task.id,
          title: displayNames.get(task.id) ?? task.title,
          state: taskStateOf(task),
          preview: task.lastMessage ?? undefined,
          meta: ago(task.lastActiveAt, now),
          worktree: false,
          selected: task.id === selectedTaskId,
          onClick: () => setSelectedTaskId(task.id),
        })),
      };
    });
  }, [tasks, projects, openGroups, needle, selectedTaskId, displayNames]);

  const selected = tasks.find((t) => t.id === selectedTaskId);

  // Single-click opens a preview tab, which the next single click replaces;
  // double-clicking the tab pins it (§7.2). The Explorer's file rows are the
  // one place in this preview that opens tabs, so they are where that shows.
  const openPreview = (path: string) => {
    if (!layout) return;
    setLayout(openTab(layout, { kind: "diff", path }, { preview: true }));
  };

  return (
    <AppShell
      groups={groups}
      taskFilter={filter}
      onTaskFilterChange={(e) => setFilter(e.target.value)}
      onNewTask={() => void createTask({ cols: 120, rows: 30 })}
      endpoint={loaded ? `:${location.port || "80"}` : "connecting…"}
      tabArea={
        layout
          ? ({ leading }) => (
              <TabArea
                layout={layout}
                onLayoutChange={setLayout}
                leading={leading}
                header={
                  <TaskHeader
                    title={selected ? (displayNames.get(selected.id) ?? selected.title) : "Task"}
                    path="~/.codetoaster/worktrees/pty-extract"
                    branch="v2/pty-extract"
                    badge={<Badge>sonnet · acceptEdits</Badge>}
                  />
                }
                renderPane={(tab) => <PaneFixture tab={tab} />}
              />
            )
          : undefined
      }
      status={{
        state: selected ? taskStateOf(selected) : undefined,
        items: selected
          ? [`${selected.size.cols}×${selected.size.rows}`, `${selected.clientCount} viewing`]
          : ["no task"],
        right: "+142 −38 · 4 files",
      }}
      explorerSections={EXPLORER_SECTIONS}
      explorerTab={explorerTab}
      onExplorerTabChange={setExplorerTab}
      explorer={
        explorerTab === "Changes" ? (
          <ChangesFixture onOpen={openPreview} />
        ) : (
          <UnbuiltSection name={explorerTab} />
        )
      }
      explorerFooter={
        explorerTab === "Changes" ? (
          <>
            <Button variant="outline" className="flex-1">Review all</Button>
            <Button variant="primary" className="flex-1">Commit</Button>
          </>
        ) : undefined
      }
    >
      <NoTaskFixture />
    </AppShell>
  );
}

/** The main area before a task is picked. TASK-24 puts the composer here. */
function NoTaskFixture() {
  return (
    <div className="grid h-full place-items-center text-sm text-subtle-foreground">
      Pick a task on the left.
    </div>
  );
}

/**
 * What a pane holds, until TASK-23's hosts exist. Deliberately says which
 * descriptor it is showing: with two groups on screen, "the diff" is not enough
 * to tell whether a drag put the right tab in the right place.
 */
function PaneFixture({ tab }: { tab: TabState }) {
  const { descriptor } = tab;
  if (descriptor.kind === "agent" || descriptor.kind === "shell") return <TerminalFixture />;
  return (
    <div className="flex h-full flex-col gap-1 overflow-auto px-3 py-2">
      <span className="font-mono text-xs tracking-mono text-foreground">
        {descriptor.kind === "diff" || descriptor.kind === "file"
          ? descriptor.path
          : descriptor.kind === "commit"
            ? descriptor.sha
            : descriptor.kind}
      </span>
      <span className="text-xs text-subtle-foreground">
        The {descriptor.kind} host arrives with TASK-23.
      </span>
    </div>
  );
}

/** Only Changes has fixture content. Saying so beats showing the diff tree
 * under all four labels and calling the rail verified. */
function UnbuiltSection({ name }: { name: string }) {
  return (
    <div className="px-2 py-3 text-xs text-subtle-foreground">
      {name} is not built yet — see TASK-26.
    </div>
  );
}

function ChangesFixture({ onOpen }: { onOpen: (path: string) => void }) {
  return (
    <>
      <SectionLabel>src/lib/xtmux</SectionLabel>
      <FileRow
        name="pty.ts"
        status="modified"
        additions={142}
        deletions={38}
        onClick={() => onOpen("src/lib/xtmux/pty.ts")}
      />
      <FileRow
        name="manager.ts"
        status="modified"
        additions={9}
        deletions={7}
        onClick={() => onOpen("src/lib/xtmux/manager.ts")}
      />
      <FileRow
        name="multiplex.test.ts"
        status="added"
        additions={61}
        onClick={() => onOpen("src/lib/xtmux/multiplex.test.ts")}
      />
      <SectionLabel className="mt-1.5">src/frontend</SectionLabel>
      <FileRow
        name="SessionContext.tsx"
        status="deleted"
        deletions={214}
        onClick={() => onOpen("src/frontend/SessionContext.tsx")}
      />
      <FileRow
        name="TopBar.tsx"
        status="renamed"
        note="renamed"
        onClick={() => onOpen("src/frontend/TopBar.tsx")}
      />
    </>
  );
}

/**
 * Stands in for the agent terminal at the product's real metrics. The design
 * system ships a `TerminalFrame` for exactly this and says never to use it in
 * production — so it was not ported, and this fixture lives with the preview
 * route rather than in the component library. TASK-19 puts the real
 * multi-instance `Terminal` here.
 */
function TerminalFixture() {
  return (
    <div className="h-full overflow-auto bg-pane px-3 py-2 font-mono text-base leading-code tracking-mono">
      <div className="text-subtle-foreground">
        $ claude --session-id 1fc1a3c8 --settings ./settings.json "extract Pty from Session"
      </div>
      <Gap />
      <div>
        <span className="text-state-busy">›</span> extract Pty from Session, keeping the OSC handlers intact
      </div>
      <Gap />
      <div className="text-muted-foreground">
        I'll split the process-owning half of <span className="text-foreground">Session</span> into{" "}
        <span className="text-foreground">Pty</span> and leave naming on the task record.
      </div>
      <Gap />
      <div>
        <span className="text-success">●</span> <span className="text-muted-foreground">Read</span>{" "}
        src/lib/xtmux/session.ts <span className="text-subtle-foreground">399 lines</span>
      </div>
      <div>
        <span className="text-success">●</span> <span className="text-muted-foreground">Write</span>{" "}
        src/lib/xtmux/pty.ts <span className="text-diff-add-marker">+142</span>{" "}
        <span className="text-diff-del-marker">−38</span>
      </div>
      <div>
        <span className="text-state-busy">●</span> <span className="text-muted-foreground">Bash</span>{" "}
        bun test src/lib/xtmux
      </div>
      <Gap />
      <div className="text-subtle-foreground">
        {"  multiplex.test.ts:  "}
        <span className="text-success">12 pass</span>
        {"  0 fail"}
      </div>
      <div className="mt-1 inline-block h-[1.05em] w-[0.6em] translate-y-[0.15em] bg-foreground [animation:ct-caret_1s_step-end_infinite]" />
    </div>
  );
}

function Gap() {
  return <div className="h-2.5" aria-hidden />;
}
