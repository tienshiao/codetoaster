import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { taskDisplayNames, taskStateOf, useTasks } from "@/frontend/TaskContext";
import { ArchiveTaskDialog, CloseTaskDialog } from "@/frontend/components/TaskSidebar";
import { CommandPalette, type PaletteGroup } from "@/frontend/components/v2/CommandPalette";
import { useFileSearch, type FileSearchResult } from "@/frontend/hooks/use-file-search";
import { useGitLog } from "@/frontend/hooks/use-git-log";
import { useGitRefs } from "@/frontend/hooks/use-git-refs";
import { useTaskDiff } from "@/frontend/hooks/use-task-diff";
import { useOpenComposer, useOpenTask } from "@/frontend/hooks/use-task-nav";
import type { ShellCommand } from "@/frontend/keymap";
import {
  activeTab,
  canSearch,
  focusTab,
  type LayoutEnv,
  type TabDescriptor,
  type TaskLayout,
} from "@/frontend/layout-store";
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
  /** The shell's device policy — see `LayoutEnv`. Forwarded to `actionEntries`
   * so the palette lists no row the chord behind it would refuse. */
  env?: LayoutEnv;
  onLayoutChange: (next: TaskLayout) => void;
  /** Asks the pane for a tab to take the caret — the shell's focus pulse — so
   * a tab chosen from the keyboard does not leave the caret in a closed
   * palette. */
  onFocusTab: (tabId: string) => void;
  /** Asks the tab's pane to open its terminal search bar — the same pulse the
   * strip's magnifier raises (TASK-58). */
  onSearchTab: (tabId: string) => void;
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

  // The two confirmations outlive the palette: selecting Close or Archive shuts
  // it and opens the dialog, so their state cannot live inside the part that
  // unmounts when the palette closes.
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [archiving, setArchiving] = useState(false);

  // Projected only while one of the two dialogs is on screen, since nothing
  // else reads it: `taskDisplayNames` walks the whole list, and as a memo over
  // `tasks` it re-ran on every activity delta for the life of the shell.
  const label =
    selected && (archiving || confirmingClose)
      ? (taskDisplayNames(tasks).get(selected.id) ?? selected.title)
      : "";

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
        <CloseTaskDialog
          open={confirmingClose}
          label={label}
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
  env,
  onLayoutChange,
  onFocusTab,
  onSearchTab,
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

  // Where the caret was when the palette opened, so closing puts it back —
  // however the palette closed. Dismissing is not the only way out that leaves
  // nothing focused: the ⌘⇧P toggle, and every selection whose action moves no
  // focus (toggle-sidebar, split, close-tab, new-shell), all unmount the input
  // and leave `document.activeElement` on `<body>`.
  const opener = useRef<HTMLElement | null>(
    typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null),
  );

  // Restored on unmount rather than in the dismiss handler, and only when
  // nothing else has taken focus. That condition is what lets a selection that
  // *does* move focus win: a tab pulse and a dialog both focus from an effect,
  // and effects run after this cleanup in the same commit, so they land last.
  useEffect(
    () => () => {
      const element = opener.current;
      if (!element?.isConnected) return;
      if (document.activeElement === null || document.activeElement === document.body) {
        element.focus();
      }
    },
    [],
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

  const groups = useMemo((): PaletteGroup<PaletteEntry>[] => {
    const labels = taskDisplayNames(tasks);
    const projectNames = new Map(projects.map((p) => [p.id, p.name]));
    // `enabled: false` stops the fetch, not the cache: these keys are shared
    // with the Explorer's History and Refs — and with this palette's own last
    // search — so React Query hands back whatever was fetched before. The
    // gating has to be repeated here or a hundred commits sit under the
    // actions at an empty box, which is exactly what the gate was for.
    const commits = searching ? (log.data?.pages.flatMap((page) => page.commits) ?? []) : [];
    // Same shape, one query later: `keepPreviousData` holds the last search's
    // hits at an empty box, and file rows are `forceMount`, so they would draw
    // unfiltered and suppress the empty state with them.
    const fileResults = debounced ? (files.data?.results ?? []) : [];

    return [
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
        items: actionEntries({ task: selectedTask, layout, env }),
      },
      { id: "changes", label: "Changes", items: changeEntries(changes ?? []) },
      { id: "history", label: "History", items: commitEntries(commits, COMMIT_LIMIT) },
      { id: "refs", label: "Refs", items: searching ? refEntries(refs.data) : [] },
      {
        id: "files",
        label: "Files",
        items: fileEntries(fileResults).map((entry, i) => ({
          ...entry,
          labelNode: <HighlightedPath {...fileResults[i]!} />,
        })),
      },
    ];
  }, [
    tasks,
    projects,
    layout,
    env,
    taskId,
    selectedTask,
    changes,
    log.data,
    refs.data,
    files.data,
    searching,
    debounced,
  ]);

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
      case "search-terminal": {
        // The row is only listed in front of a terminal, but the layout can
        // have moved under an open palette — so both the tab and whether it
        // can be searched are asked again rather than carried on the action. A
        // pulse addressed to a diff tab is one no pane answers.
        const tab = layout ? activeTab(layout) : null;
        if (tab && canSearch(layout!, tab.id)) onSearchTab(tab.id);
        return;
      }
    }
  };

  // The row itself, not an id to look one up by: `Row` hands back the exact
  // object it was given, so the action rides along with it.
  const handleSelect = (entry: PaletteEntry) => {
    // Closed first, then acted on: an action that navigates or opens a dialog
    // should find the palette already gone rather than race its own unmount.
    onOpenChange(false);
    perform(entry.action);
  };

  const footer: ReactNode =
    hasTask && debounced && files.isFetching ? "Searching files…" : undefined;

  return (
    <CommandPalette
      open
      query={query}
      onQueryChange={setQuery}
      placeholder={hasTask ? "Search tasks, tabs, files, actions…" : "Search tasks and actions…"}
      groups={groups}
      onSelect={handleSelect}
      onDismiss={() => onOpenChange(false)}
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
