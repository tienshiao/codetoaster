import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { taskDisplayNames, taskStateOf, useTasks } from "@/frontend/TaskContext";
import { ArchiveTaskDialog } from "@/frontend/components/TaskSidebar";
import { CommandPalette, type PaletteGroup, type PaletteItem } from "@/frontend/components/v2/CommandPalette";
import { Dialog } from "@/frontend/components/v2/Dialog";
import { useFileSearch, type FileSearchResult } from "@/frontend/hooks/use-file-search";
import { useGitLog } from "@/frontend/hooks/use-git-log";
import { useGitRefs } from "@/frontend/hooks/use-git-refs";
import { useTaskDiff } from "@/frontend/hooks/use-task-diff";
import { useOpenComposer, useOpenTask } from "@/frontend/hooks/use-task-nav";
import type { ShellCommand } from "@/frontend/keymap";
import { focusTab, type TabDescriptor, type TaskLayout } from "@/frontend/layout-store";
import {
  actionEntries,
  changeEntries,
  commitEntries,
  fileEntries,
  refEntries,
  tabEntries,
  taskEntries,
  type PaletteAction,
  type PaletteEntry,
} from "@/frontend/palette-items";

/**
 * The command palette, wired (TASK-35 §8): tasks, the current task's open tabs,
 * the actions the shell and the sidebar already offer, and the Explorer's
 * openable items, behind one search box.
 *
 * `v2/CommandPalette` draws it and knows nothing about tasks; `palette-items`
 * turns app state into rows and knows nothing about React. What is left here
 * is the wiring: which queries feed the rows, and what each selection does —
 * and each one goes through the door that already exists for it, so a task
 * jumped to from here is `useOpenTask`'s navigation and a chord run from here
 * is `useShellKeymap`'s reduction rather than a second copy of either.
 */
export interface CommandPaletteHostProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The task on screen, or null at the composer. */
  taskId: string | null;
  layout: TaskLayout | null;
  onLayoutChange: (next: TaskLayout) => void;
  /** Asks the pane for a tab to take the caret — the shell's focus pulse — so
   * a tab chosen from the keyboard does not leave the caret in a closed
   * palette. */
  onFocusTab: (tabId: string) => void;
  /** Opens a tab permanently rather than as a preview: a row chosen by name
   * from a list is the user asking for that tab, like a `?tab=` link. */
  onOpenTab: (descriptor: TabDescriptor) => void;
  /** `useShellKeymap`'s `run`, so a listed chord does exactly what the chord
   * does. */
  runCommand: (command: ShellCommand) => void;
  onToggleSidebar: () => void;
  onToggleExplorer: () => void;
}

export function CommandPaletteHost(props: CommandPaletteHostProps) {
  const { open, onOpenChange, taskId } = props;
  const { tasks, closeTask, resumeTask, archivePreview, archiveTask } = useTasks();
  const selected = tasks.find((t) => t.id === taskId) ?? null;
  const label = useMemo(
    () => (selected ? (taskDisplayNames(tasks).get(selected.id) ?? selected.title) : ""),
    [tasks, selected],
  );

  // The two confirmations outlive the palette: selecting Close or Archive shuts
  // it and opens the dialog, so their state cannot live inside the part that
  // unmounts when the palette closes.
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [archiving, setArchiving] = useState(false);

  const handleArchivePreview = useCallback(
    async (id: string) => {
      const result = await archivePreview(id);
      return result.ok ? result.value : null;
    },
    [archivePreview],
  );

  return (
    <>
      {/* Mounted only while open, so its queries — the diff, the log, the refs,
          a file search per keystroke — run only while the palette is on
          screen rather than for the whole life of the shell. */}
      {open && (
        <OpenPalette
          {...props}
          onCloseTask={() => {
            if (!selected) return;
            // Closing a working agent interrupts it, so that one asks first —
            // the same rule as the sidebar row's X.
            if (taskStateOf(selected) === "busy") setConfirmingClose(true);
            else void closeTask(selected.id);
          }}
          onArchiveTask={() => setArchiving(true)}
          onResumeTask={() => {
            if (selected) void resumeTask(selected.id);
          }}
        />
      )}
      {selected && (
        <ArchiveTaskDialog
          open={archiving}
          taskId={selected.id}
          label={label}
          onArchivePreview={handleArchivePreview}
          onArchive={(id) => void archiveTask(id)}
          onClose={() => setArchiving(false)}
        />
      )}
      {selected && (
        <Dialog
          open={confirmingClose}
          title="Close this task?"
          description={`${label} is still working. Closing stops the agent; the task keeps its row and can be resumed.`}
          confirmLabel="Close task"
          confirmVariant="destructive"
          onConfirm={() => void closeTask(selected.id)}
          onClose={() => {
            setConfirmingClose(false);
            onOpenChange(false);
          }}
        />
      )}
    </>
  );
}

type OpenPaletteProps = CommandPaletteHostProps & {
  onCloseTask: () => void;
  onArchiveTask: () => void;
  onResumeTask: () => void;
};

/** How many commits the palette offers. The log is paged at 200 and the
 * palette is not a history browser; a commit further down is what the History
 * section is for. */
const COMMIT_LIMIT = 50;

function OpenPalette({
  onOpenChange,
  taskId,
  layout,
  onLayoutChange,
  onFocusTab,
  onOpenTab,
  runCommand,
  onToggleSidebar,
  onToggleExplorer,
  onCloseTask,
  onArchiveTask,
  onResumeTask,
}: OpenPaletteProps) {
  const { tasks, projects } = useTasks();
  const openTask = useOpenTask();
  const openComposer = useOpenComposer();

  const [query, setQuery] = useState("");
  const searching = query.trim().length > 0;

  // Where the caret was when the palette opened, so a dismissal puts it back.
  // Only a dismissal: a selection either moves focus itself (a tab, through the
  // pulse) or leaves for somewhere the old element no longer means anything (a
  // task jump, a close).
  const opener = useRef<HTMLElement | null>(
    typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null),
  );

  const hasTask = taskId !== null;
  const { data: changes } = useTaskDiff(taskId ?? "", hasTask);
  // Both are gated on a query: at an empty box these are lists, not answers,
  // and a hundred commits under the actions would bury the rows the palette
  // is opened for. Typed, they are what the box is searching.
  const log = useGitLog(taskId ?? "", hasTask && searching);
  const refs = useGitRefs(taskId ?? "", hasTask && searching);

  // The file search is a request per query, so it waits for the typing to
  // pause; everything else filters in place and does not.
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(handle);
  }, [query]);
  const files = useFileSearch(hasTask ? taskId : null, debounced);

  const selectedTask = tasks.find((t) => t.id === taskId) ?? null;

  const groups = useMemo((): { groups: PaletteGroup[]; entries: Map<string, PaletteEntry> } => {
    const labels = taskDisplayNames(tasks);
    const projectNames = new Map(projects.map((p) => [p.id, p.name]));
    const commits = log.data?.pages.flatMap((page) => page.commits) ?? [];

    const built: { id: string; label: string; items: PaletteEntry[] }[] = [
      { id: "tabs", label: "Open tabs", items: tabEntries(layout) },
      {
        id: "tasks",
        label: "Tasks",
        items: taskEntries(tasks, {
          labels,
          projectNames,
          currentTaskId: taskId,
          stateOf: taskStateOf,
        }),
      },
      {
        id: "actions",
        label: "Actions",
        items: actionEntries({ task: selectedTask, layout }),
      },
      { id: "changes", label: "Changes", items: changeEntries(changes ?? []) },
      { id: "history", label: "History", items: commitEntries(commits, COMMIT_LIMIT) },
      { id: "refs", label: "Refs", items: refEntries(refs.data) },
      {
        id: "files",
        label: "Files",
        items: fileEntries(files.data?.results ?? []).map((entry, i) => ({
          ...entry,
          labelNode: <HighlightedPath {...files.data!.results[i]!} />,
        })),
      },
    ];

    const entries = new Map<string, PaletteEntry>();
    for (const group of built) for (const item of group.items) entries.set(item.id, item);
    return { groups: built, entries };
  }, [tasks, projects, layout, taskId, selectedTask, changes, log.data, refs.data, files.data]);

  const perform = (action: PaletteAction) => {
    switch (action.type) {
      case "open-task":
        return openTask(action.taskId);
      case "focus-tab":
        if (!layout) return;
        onLayoutChange(focusTab(layout, action.tabId));
        return onFocusTab(action.tabId);
      case "open-tab":
        return onOpenTab(action.descriptor);
      case "command":
        return runCommand(action.command);
      case "new-task":
        return openComposer();
      case "close-task":
        return onCloseTask();
      case "resume-task":
        return onResumeTask();
      case "archive-task":
        return onArchiveTask();
      case "toggle-sidebar":
        return onToggleSidebar();
      case "toggle-explorer":
        return onToggleExplorer();
    }
  };

  const handleSelect = (item: PaletteItem) => {
    const entry = groups.entries.get(item.id);
    // Closed first, then acted on: an action that navigates or opens a dialog
    // should find the palette already gone rather than race its own unmount.
    onOpenChange(false);
    if (entry) perform(entry.action);
  };

  const handleDismiss = () => {
    onOpenChange(false);
    const element = opener.current;
    if (element && element.isConnected) element.focus();
  };

  const footer: ReactNode =
    hasTask && debounced && files.isFetching ? "Searching files…" : undefined;

  return (
    <CommandPalette
      open
      query={query}
      onQueryChange={setQuery}
      placeholder={hasTask ? "Search tasks, tabs, files, actions…" : "Search tasks and actions…"}
      groups={groups.groups}
      onSelect={handleSelect}
      onDismiss={handleDismiss}
      footer={footer}
    />
  );
}

/** A search hit's path with the matched characters set apart, so a fuzzy hit
 * on `src/a/b/c.ts` shows *why* it matched. */
function HighlightedPath({ path, indices }: FileSearchResult) {
  const matched = new Set(indices);
  const runs: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < path.length; i++) {
    const hit = matched.has(i);
    const last = runs[runs.length - 1];
    if (last && last.hit === hit) last.text += path[i];
    else runs.push({ text: path[i]!, hit });
  }
  return (
    <span className="truncate font-mono text-xs tracking-mono">
      {runs.map((run, i) =>
        run.hit ? (
          <span key={i} className="font-semibold text-foreground">
            {run.text}
          </span>
        ) : (
          <span key={i} className="text-muted-foreground">
            {run.text}
          </span>
        ),
      )}
    </span>
  );
}
