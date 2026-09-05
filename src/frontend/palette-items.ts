import {
  Archive,
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Hash,
  PanelLeft,
  PanelRight,
  Plus,
  RotateCcw,
  Sparkles,
  Tag,
  Terminal,
  X,
  GitBranch,
  type LucideIcon,
} from "lucide-react";
import { SHELL_COMMANDS, chordCaps, type CommandId, type ShellCommand } from "@/frontend/keymap";
import {
  activeGroup,
  activeTab,
  allTabs,
  canSplit,
  type TabDescriptor,
  type TaskLayout,
} from "@/frontend/layout-store";
import { basename, presentTab } from "@/frontend/components/tabs/tab-labels";
import { isMac } from "@/frontend/utils/platform";
import { TAB_KINDS } from "@/frontend/components/v2/TabStrip";
import type { PaletteItem } from "@/frontend/components/v2/CommandPalette";
import type { TaskState } from "@/frontend/components/v2/StatusDot";
import type { TaskInfo } from "@/lib/xtmux/types";
import type { FileDiff } from "@/frontend/types/diff";
import type { GitLogCommit, GitRefsResponse } from "@/frontend/types/git";
import type { FileSearchResult } from "@/frontend/hooks/use-file-search";

/**
 * What the command palette can list, as functions over app state (TASK-35).
 *
 * It lives apart from the palette for the reason `task-list.ts` lives apart
 * from the sidebar: none of this needs a DOM, and the interesting cases — a
 * jump-to-tab row that must stop at the tab count, a Resume that appears only
 * for a task that can be resumed — are far easier to state as inputs and
 * outputs than as a mounted component.
 *
 * Nothing here runs anything. Every row carries a `PaletteAction` describing
 * what selecting it means, and the host interprets it: the builders stay pure
 * and the palette stays presentational.
 *
 * `TaskContext` is deliberately not imported. It pulls React and sonner in with
 * it, which a `bun test` runner has no DOM for — so the one thing this file
 * needs from it, the agent-state projection, arrives as a `stateOf` parameter.
 */

export type PaletteAction =
  | { type: "open-task"; taskId: string }
  | { type: "focus-tab"; tabId: string }
  | { type: "open-tab"; descriptor: TabDescriptor }
  /** Dispatched through `useShellKeymap`'s `run`, so a palette row and its
   * chord are the same code path. */
  | { type: "command"; command: ShellCommand }
  | { type: "new-task" }
  | { type: "close-task" }
  | { type: "resume-task" }
  | { type: "archive-task" }
  | { type: "toggle-sidebar" }
  | { type: "toggle-explorer" };

export type PaletteEntry = PaletteItem & { action: PaletteAction };

/** The task fields a palette row reads. Narrow so a test can state a task in
 * six fields rather than building a whole `TaskInfo`. */
export type PaletteTask = Pick<
  TaskInfo,
  "id" | "projectId" | "title" | "lifecycle" | "lastMessage" | "agentState"
>;

// ── tasks ───────────────────────────────────────────────────────────────────

export interface TaskEntryOptions {
  /** Displayed labels by task id — `taskDisplayNames`' projection, not the
   * stored titles, for the reason `task-list.ts` gives: the projection is what
   * is on screen, and filtering on anything else hides the task the user has
   * just typed the name of. */
  labels: ReadonlyMap<string, string>;
  projectNames: ReadonlyMap<string, string>;
  /** The task the shell is showing, marked so the list says where you are. */
  currentTaskId?: string | null;
  /** `taskStateOf`, passed in rather than imported — see the note at the top. */
  stateOf: (task: PaletteTask) => TaskState;
}

/**
 * Every task that can still be opened, in the order given.
 *
 * The order is the caller's: `TaskInfo` arrives from the server sorted by
 * recency, and the most recently touched task being the first row is the whole
 * reason the palette is faster than the sidebar. Archived tasks are left out —
 * opening one is a restore, not a navigation, and the archived list is where
 * that decision belongs.
 */
export function taskEntries(
  tasks: readonly PaletteTask[],
  { labels, projectNames, currentTaskId, stateOf }: TaskEntryOptions,
): PaletteEntry[] {
  return tasks
    .filter((task) => task.lifecycle !== "archived")
    .map((task) => {
      const project = projectNames.get(task.projectId) ?? task.projectId;
      return {
        id: `task:${task.id}`,
        label: labels.get(task.id) ?? task.title,
        state: stateOf(task),
        detail: task.id === currentTaskId ? `${project} · current` : project,
        // The last thing the agent said is often the only text on the row the
        // user remembers, and it is not otherwise anywhere in the palette.
        keywords: task.lastMessage ? [task.lastMessage] : undefined,
        action: { type: "open-task", taskId: task.id },
      };
    });
}

// ── tabs ────────────────────────────────────────────────────────────────────

/**
 * Every open tab of the current task, across every group.
 *
 * Labels come from `presentTab`, so a tab reads in the palette exactly as it
 * does in the strip. The detail slot takes what the strip had no room for: a
 * file's path, a commit's full sha — the `title` the strip hid behind a
 * tooltip. Only for those kinds: the fixed tabs' titles are prose ("The agent
 * terminal"), and a gloss in the mono slot reads as an identifier that is not
 * one. Dropped too when it says the same thing as the label, which a file at
 * the repository root does.
 */
/** The tab kinds whose `title` is an address — a path or a sha — rather than
 * a description. */
const ADDRESSED_KINDS: ReadonlySet<string> = new Set(["file", "diff", "commit"]);

export function tabEntries(layout: TaskLayout | null): PaletteEntry[] {
  if (!layout) return [];
  return allTabs(layout).map((tab) => {
    const presented = presentTab(tab.descriptor);
    const addressed = ADDRESSED_KINDS.has(presented.kind) && presented.title !== presented.label;
    return {
      id: `tab:${tab.id}`,
      label: presented.label,
      icon: TAB_KINDS[presented.kind].icon,
      detail: presented.detail ?? (addressed ? presented.title : undefined),
      keywords: [presented.title],
      action: { type: "focus-tab", tabId: tab.id },
    };
  });
}

// ── actions ─────────────────────────────────────────────────────────────────

/**
 * A glyph per command, so the shortcut table does not have to carry one.
 *
 * `Partial`, with a fallback below, on purpose: the table is edited by whoever
 * adds a shortcut, and a new `CommandId` should not be a type error in a file
 * that has nothing to say about it.
 */
const COMMAND_ICONS: Partial<Record<CommandId, LucideIcon>> = {
  "next-tab": ChevronRight,
  "prev-tab": ChevronLeft,
  "jump-tab": Hash,
  "close-tab": X,
  split: Columns2,
  "focus-group-left": ArrowLeft,
  "focus-group-right": ArrowRight,
  "focus-agent": Sparkles,
  "new-shell": Terminal,
};

/** Rows placed by hand above the table, and so skipped when it is walked.
 * `palette` because offering "open the command palette" from inside the open
 * command palette is nonsense; `new-shell` because it is one of the task
 * actions and belongs beside them rather than among the tab chords. */
const PLACED_BY_HAND: ReadonlySet<string> = new Set(["palette", "new-shell"]);

export interface ActionEntryOptions {
  /** The task the shell is showing, or null at the composer. */
  task: Pick<TaskInfo, "lifecycle" | "agentState"> | null;
  /** Its tab layout, or null when there is no task to have one. */
  layout: TaskLayout | null;
  /**
   * Which caps the chords print on. Defaults to the platform, and the default
   * is a parameter rather than a call inside `chordCaps` for the reason
   * `isLeader` gives: `isMac` reads `navigator.platform`, this file is covered
   * by `bun test`, and `bun test` has no DOM. A test passes it; the app does
   * not have to.
   */
  mac?: boolean;
}

/**
 * The commands, in the order they should be offered.
 *
 * Task lifecycle first, because those are the rows a user comes to the palette
 * *for*; the leader chords after, because a user who wants one of those
 * usually presses it. Every row is conditional on being able to do anything —
 * a Resume on a live task, a Go to tab 7 in a group of three and a Split on a
 * terminal are all commands that would do nothing, and a palette that lists
 * them teaches that selecting a row may be a no-op.
 */
export function actionEntries({ task, layout, mac = isMac() }: ActionEntryOptions): PaletteEntry[] {
  const entries: PaletteEntry[] = [];

  entries.push({
    id: "action:new-task",
    label: "New task",
    icon: Plus,
    action: { type: "new-task" },
  });

  const newShell = SHELL_COMMANDS.find((c) => c.id === "new-shell");
  if (task && newShell) {
    entries.push(commandEntry(newShell, mac));
  }

  if (task?.lifecycle === "live") {
    entries.push({
      id: "action:close-task",
      label: "Close task",
      icon: X,
      action: { type: "close-task" },
    });
  }

  // `could_not_resume` is a live task whose agent failed to come back, so it is
  // the one state where Resume is the action *and* the lifecycle is not
  // `suspended` (§4.3).
  if (task && (task.lifecycle === "suspended" || task.agentState === "could_not_resume")) {
    entries.push({
      id: "action:resume-task",
      label: "Resume task",
      icon: RotateCcw,
      action: { type: "resume-task" },
    });
  }

  if (task && task.lifecycle !== "archived") {
    entries.push({
      id: "action:archive-task",
      label: "Archive task",
      icon: Archive,
      action: { type: "archive-task" },
    });
  }

  if (layout) {
    const group = activeGroup(layout);
    const active = activeTab(layout);
    for (const command of SHELL_COMMANDS) {
      if (PLACED_BY_HAND.has(command.id)) continue;
      // A chord that names a tab position the group does not have is dead; the
      // table lists all nine because it is a flat table, and this is where the
      // nine become however many there are.
      if (command.index != null && command.index > group.tabs.length) continue;
      if (command.command === "split" && !(active && canSplit(layout, active.id))) continue;
      // `closeTab` refuses the agent tab outright, so offering Close tab in
      // front of it would be offering a no-op.
      if (command.command === "close-tab" && active?.descriptor.kind === "agent") continue;
      entries.push(commandEntry(command, mac));
    }
  }

  entries.push({
    id: "action:toggle-sidebar",
    label: "Toggle task list",
    icon: PanelLeft,
    action: { type: "toggle-sidebar" },
  });
  entries.push({
    id: "action:toggle-explorer",
    label: "Toggle Explorer",
    icon: PanelRight,
    action: { type: "toggle-explorer" },
  });

  return entries;
}

function commandEntry(command: ShellCommand, mac: boolean): PaletteEntry {
  return {
    id: `action:${command.id}`,
    label: command.label,
    icon: COMMAND_ICONS[command.command] ?? ChevronRight,
    keys: chordCaps(command, mac),
    action: { type: "command", command },
  };
}

// ── the working tree, git, and files ────────────────────────────────────────

/** The directory a path sits in, or undefined at the root. A detail slot that
 * repeats the label is noise, so a top-level file gets none. */
function directoryOf(path: string): string | undefined {
  const index = path.replace(/\/+$/, "").lastIndexOf("/");
  return index === -1 ? undefined : path.slice(0, index);
}

/**
 * The changed files of the working tree.
 *
 * `newPath` throughout, which is `parseDiff`'s display path: a deleted file
 * carries its old path there rather than `/dev/null`, so every row names
 * something that can be opened.
 */
export function changeEntries(files: readonly FileDiff[]): PaletteEntry[] {
  return files.map((file) => ({
    id: `diff:${file.newPath}`,
    label: basename(file.newPath),
    icon: TAB_KINDS.diff.icon,
    detail: directoryOf(file.newPath),
    keywords: [file.newPath],
    action: { type: "open-tab", descriptor: { kind: "diff", path: file.newPath } },
  }));
}

/**
 * Recent commits, newest first.
 *
 * Capped, because the log is paginated and unbounded while the palette is a
 * list someone reads: thirty is more than a query narrows to anyway, and a
 * commit older than that is found through the history tab.
 */
export function commitEntries(commits: readonly GitLogCommit[], limit = 30): PaletteEntry[] {
  return commits.slice(0, limit).map((commit) => ({
    id: `commit:${commit.hash}`,
    label: commit.subject,
    icon: TAB_KINDS.commit.icon,
    detail: commit.hash.slice(0, 7),
    // The sha as typed: nobody types a subject when they have a sha.
    keywords: [commit.hash],
    action: { type: "open-tab", descriptor: { kind: "commit", sha: commit.hash } },
  }));
}

/**
 * Branches and tags, in that order.
 *
 * Remotes are left out. They double the list — every branch again under an
 * `origin/` that is nearly always the same commit — and a user who means the
 * remote copy of a branch is doing something the palette is not the tool for.
 *
 * A ref opens the commit it points at rather than a ref tab, because that is
 * what a ref *is* to the reader: a name for a commit.
 */
export function refEntries(refs: GitRefsResponse | undefined): PaletteEntry[] {
  if (!refs) return [];
  const entry = (
    // Branches and tags share a namespace here but not in git, where `v2` can
    // be both — hence a prefix per kind rather than one `ref:` for both.
    prefix: string,
    icon: LucideIcon,
    ref: { name: string; sha: string },
  ): PaletteEntry => ({
    id: `${prefix}:${ref.name}`,
    label: ref.name,
    icon,
    detail: ref.sha.slice(0, 7),
    keywords: [ref.sha],
    action: { type: "open-tab", descriptor: { kind: "commit", sha: ref.sha } },
  });
  return [
    ...refs.branches.map((ref) => entry("ref", GitBranch, ref)),
    ...refs.tags.map((ref) => entry("tag", Tag, ref)),
  ];
}

/**
 * Repository files, from the server's own search.
 *
 * `forceMount`, because the narrowing already happened: these rows *are* the
 * answer to the query, and running cmdk's fuzzy filter over them again would
 * drop results the server ranked. The full path is the label — a palette
 * listing six `index.ts` would otherwise be six identical rows.
 */
export function fileEntries(results: readonly FileSearchResult[]): PaletteEntry[] {
  return results.map((result) => ({
    id: `file:${result.path}`,
    label: result.path,
    icon: TAB_KINDS.file.icon,
    forceMount: true,
    action: { type: "open-tab", descriptor: { kind: "file", path: result.path } },
  }));
}
