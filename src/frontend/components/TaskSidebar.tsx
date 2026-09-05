import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Archive, FolderPlus, Pencil, Plus, SlidersHorizontal, Trash2, X } from "lucide-react";
import { taskStateOf, useTasks } from "@/frontend/TaskContext";
import { archiveSummary } from "@/frontend/archive-summary";
import { groupByProject, selectTasks } from "@/frontend/task-list";
import {
  getSidebarState,
  patchSidebarState,
  toggleSidebarFlag,
  toggleSidebarGroup,
  type SidebarState,
} from "@/frontend/sidebar-store";
import { meaningfulTitle, sessionDisplayNames } from "@/lib/xtmux/naming";
import type { ArchivePreview, ProjectInfo, ProjectSettings, TaskInfo } from "@/lib/xtmux/types";
import type { AppShellProps, ShellTask } from "@/frontend/components/v2/AppShell";
import { Dialog } from "@/frontend/components/v2/Dialog";
import { IconButton } from "@/frontend/components/v2/IconButton";
import { TextInput } from "@/frontend/components/v2/TextInput";
import { ProjectSettingsDialog } from "@/frontend/components/ProjectSettingsDialog";
import { BLANK_PROJECT, ProjectDialog } from "@/frontend/components/ProjectDialog";

/**
 * The chat-history / resume list (§7.5): the shell's left column, fed by
 * `TaskContext`.
 *
 * The arrangement itself is not here — it is in `task-list.ts`, as functions
 * over rows, so the filter, the archived predicate and the grouping can be
 * tested without a DOM. What is here is the React around it: the toggles, the
 * projection of a task onto a row, and the per-row controls, which have to be
 * components because each owns a dialog.
 *
 * `AppShell` stays layout-only, so this hands it props rather than markup.
 */

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
 * The row's second line.
 *
 * `lastMessage` first, because that is what answers "which of these want me?"
 * — it is the last thing the agent said, from the `Stop` hook. The OSC
 * terminal title is the fallback, and only when it is not already the label:
 * once the projection has promoted a title to the row's name, repeating it
 * underneath says nothing. That happens when the title is ambiguous across
 * tasks — two agents both reporting "Fix the parser" — where the label falls
 * back to the stored title (the task's opening prompt, or `<dir> · <branch>`)
 * and the terminal title is the more specific of the two.
 */
function previewOf(task: TaskInfo, label: string): string | undefined {
  if (task.lastMessage) return task.lastMessage;
  const title = meaningfulTitle(task.terminalTitle);
  return title && title !== label ? title : undefined;
}

/**
 * The body of the archive confirmation: what this particular task would cost.
 *
 * The preview is fetched when the dialog opens rather than held on the row,
 * because answering it runs git against a working tree — see `ArchivePreview`.
 * Three states, and the middle one is why this is a component at all:
 *
 * - **checking** — the confirm is disabled, because the dialog has not yet said
 *   anything for the user to confirm *against*.
 * - **failed** — the confirm comes back, and the text says plainly that the
 *   cost could not be established. Fail closed on the claim, not on the
 *   action: refusing to archive because git was slow is the worse failure, and
 *   the archive itself reports what it actually did afterwards.
 * - **answered** — `archiveSummary`'s sentences.
 */
function ArchiveBody({ preview, failed }: { preview: ArchivePreview | null; failed: boolean }) {
  if (failed) {
    return (
      <p className="text-xs text-muted-foreground">
        What this would remove could not be established, so nothing here is
        promised. Archiving still snapshots the work first, and reports what it
        did.
      </p>
    );
  }
  if (!preview) {
    return <p className="text-xs text-muted-foreground">Checking what this would remove…</p>;
  }
  return (
    <ul className="flex list-none flex-col gap-1 text-xs text-muted-foreground">
      {archiveSummary(preview).map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

export interface ArchiveTaskDialogProps {
  open: boolean;
  taskId: string;
  label: string;
  /** What archiving would cost, fetched when the dialog opens. Resolving to
   * null is a failure the dialog says out loud rather than a blank. */
  onArchivePreview: (id: string) => Promise<ArchivePreview | null>;
  onArchive: (id: string) => void;
  onClose: () => void;
}

/**
 * The archive confirmation, with its cost fetched on open.
 *
 * Its own component rather than a dialog inside `TaskRowActions`, because two
 * surfaces ask the same question — the row's archive button and the command
 * palette's Archive task — and the preview fetch, its cancellation and the
 * "checking / failed / answered" states are the part that must not be written
 * twice.
 */
export function ArchiveTaskDialog({
  open,
  taskId,
  label,
  onArchivePreview,
  onArchive,
  onClose,
}: ArchiveTaskDialogProps) {
  const [preview, setPreview] = useState<ArchivePreview | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);

  // Asked on open, and asked again on every open: the counts are what the user
  // is being shown, and a dialog reopened an hour later must not quote what
  // git said the first time.
  useEffect(() => {
    if (!open) return;
    let live = true;
    setPreview(null);
    setPreviewFailed(false);
    // Rejection is the same answer as `null`, and it has to be handled or the
    // "failed" state is unreachable by the one route that reaches it without a
    // resolved value: `request` swallows fetch and HTTP failures, so what is
    // left to throw is a 200 whose body would not parse. Unhandled, that leaves
    // the dialog sitting on "Checking what this would remove…" for good, with
    // the confirm disabled and nothing saying why.
    void onArchivePreview(taskId)
      .catch(() => null)
      .then((answer) => {
        if (!live) return;
        setPreview(answer);
        setPreviewFailed(answer === null);
      });
    // Not a cancellation of the request — there is nothing to cancel — but of
    // its effect: a dialog closed and reopened has two in flight, and the
    // slower one would otherwise land on top of the newer answer.
    return () => {
      live = false;
    };
  }, [open, taskId, onArchivePreview]);

  return (
    <Dialog
      open={open}
      title="Archive this task?"
      description={`${label} leaves the list, and the archived toggle is where it can be found again. What that costs:`}
      confirmLabel="Archive"
      confirmVariant="destructive"
      // Nothing to confirm against until the dialog has said what it costs.
      confirmDisabled={!preview && !previewFailed}
      onConfirm={() => onArchive(taskId)}
      onClose={onClose}
    >
      <ArchiveBody preview={preview} failed={previewFailed} />
    </Dialog>
  );
}

/**
 * The close confirmation, for a task whose agent is still working.
 *
 * Its own component for the same reason `ArchiveTaskDialog` is one: two
 * surfaces ask the same question — the row's X and the command palette's Close
 * task — and the wording of what closing costs must not drift between them.
 */
export function CloseTaskDialog({
  open,
  label,
  onConfirm,
  onClose,
}: {
  open: boolean;
  label: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      title="Close this task?"
      description={`${label} is still working. Closing stops the agent; the task keeps its row and can be resumed.`}
      confirmLabel="Close task"
      confirmVariant="destructive"
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}

interface TaskRowActionsProps {
  taskId: string;
  label: string;
  /** Closing a working agent interrupts it, so that one asks first. */
  busy: boolean;
  onRename: (id: string, title: string) => void;
  onClose: (id: string) => void;
  /** What archiving would cost, fetched when the dialog opens. Resolving to
   * null is a failure the dialog says out loud rather than a blank. */
  onArchivePreview: (id: string) => Promise<ArchivePreview | null>;
  onArchive: (id: string) => void;
}

/**
 * Rename, archive and close, as siblings of the row rather than children of it
 * — see `ShellTask.actions`. Plain buttons and not a menu behind an ellipsis:
 * a menu would need a popover the v2 system does not have yet, and would put
 * every action two keystrokes away instead of one.
 *
 * Close and archive sit next to each other and mean very different things, so
 * only one of them is destructive: closing suspends a task and keeps its row,
 * which is the resting state of a finished conversation (§5.5), while
 * archiving is how one leaves (§6). The archive is the one that always asks.
 */
export function TaskRowActions({
  taskId,
  label,
  busy,
  onRename,
  onClose,
  onArchivePreview,
  onArchive,
}: TaskRowActionsProps) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [archiving, setArchiving] = useState(false);

  return (
    <>
      <IconButton
        icon={Pencil}
        label={`Rename ${label}`}
        size="sm"
        // Seeded with the label on screen, not the stored title: renaming a
        // task that is showing its terminal title should start from that.
        onClick={() => setRenaming(label)}
      />
      <IconButton
        icon={Archive}
        label={`Archive ${label}`}
        size="sm"
        onClick={() => setArchiving(true)}
      />
      <IconButton
        icon={X}
        label={`Close ${label}`}
        size="sm"
        onClick={() => (busy ? setConfirmingClose(true) : onClose(taskId))}
      />

      <ArchiveTaskDialog
        open={archiving}
        taskId={taskId}
        label={label}
        onArchivePreview={onArchivePreview}
        onArchive={onArchive}
        onClose={() => setArchiving(false)}
      />

      <Dialog
        open={renaming !== null}
        title="Rename task"
        confirmLabel="Rename"
        confirmDisabled={!renaming?.trim()}
        onConfirm={() => onRename(taskId, renaming!.trim())}
        onClose={() => setRenaming(null)}
      >
        <TextInput
          id={`rename-${taskId}`}
          label="Title"
          value={renaming ?? ""}
          onChange={(e) => setRenaming(e.target.value)}
          data-1p-ignore
        />
      </Dialog>

      <CloseTaskDialog
        open={confirmingClose}
        label={label}
        onConfirm={() => onClose(taskId)}
        onClose={() => setConfirmingClose(false)}
      />
    </>
  );
}

/**
 * The one control an archived row carries: delete, for good.
 *
 * Not rename, and not close — there is nothing running and nothing the label
 * is used for once the row is out of the list — and deliberately no unarchive,
 * because there is no server path back: `resumeTask` and `openTask` both refuse
 * an archived row, and offering a button that could only fail would be worse
 * than offering none.
 *
 * The confirmation is unconditional and the wording is blunt. Archiving is the
 * recoverable half of §5.6 — the snapshot is still there, and this is what
 * throws it away.
 */
export function ArchivedRowActions({
  taskId,
  label,
  onDelete,
}: {
  taskId: string;
  label: string;
  onDelete: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <IconButton
        icon={Trash2}
        label={`Delete ${label}`}
        size="sm"
        onClick={() => setConfirming(true)}
      />
      <Dialog
        open={confirming}
        title="Delete this task for good?"
        description={`${label} and the snapshot of the work archiving saved will be deleted. Nothing else has a copy, and this cannot be undone.`}
        confirmLabel="Delete for good"
        confirmVariant="destructive"
        onConfirm={() => onDelete(taskId)}
        onClose={() => setConfirming(false)}
      />
    </>
  );
}

/**
 * The delete on an unclaimed-worktree card.
 *
 * It always confirms, where `TaskRowActions` only confirms for a busy task:
 * closing a task keeps its row and can be undone by resuming, while this
 * removes a directory and every uncommitted change in it, and the checkout is
 * unclaimed precisely because nothing else in the app knows what that work was.
 * There is no version of this that is cheap enough to fire on one click.
 */
export function UnclaimedActions({
  path,
  branch,
  onDelete,
}: {
  path: string;
  branch: string | null;
  onDelete: (path: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  // The branch names it to a human; the path is what actually identifies it,
  // and two checkouts of the same branch are exactly the situation this list
  // exists to sort out. Both, then.
  const label = branch ?? path;
  return (
    <>
      <IconButton
        icon={Trash2}
        label={`Delete ${label}`}
        size="sm"
        onClick={() => setConfirming(true)}
      />
      <Dialog
        open={confirming}
        title="Delete this worktree?"
        description={`${path} will be removed from disk, along with any uncommitted work in it. Nothing else has a copy, and this cannot be undone.`}
        confirmLabel="Delete worktree"
        confirmVariant="destructive"
        onConfirm={() => onDelete(path)}
        onClose={() => setConfirming(false)}
      />
    </>
  );
}

interface ProjectActionsProps {
  project: ProjectInfo;
  onSave: (name: string, initialPath: string, settings: Partial<ProjectSettings>) => void;
  onDelete: (id: string) => void;
  /** General is the fallback every orphaned task moves to, so deleting it would
   * leave them nowhere. The server refuses, and offering a button that opens a
   * dialog that does nothing would be worse than not offering one. Its
   * settings are still worth reaching: it has no repository, but it still
   * decides a default model. */
  deletable: boolean;
  /** Start a task in this project: the composer, opened with the project the
   * press was made under already chosen. First among the header's controls
   * because it is the one that is used, and the only one that is not
   * administrative. */
  onNewTask: () => void;
}

function ProjectActions({ project, onSave, onDelete, deletable, onNewTask }: ProjectActionsProps) {
  const [confirming, setConfirming] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const name = project.name;
  return (
    <>
      <IconButton icon={Plus} label={`New task in ${name}`} size="sm" onClick={onNewTask} />
      <IconButton
        icon={SlidersHorizontal}
        label={`${name} settings`}
        size="sm"
        onClick={() => setSettingsOpen(true)}
      />
      <ProjectSettingsDialog
        project={project}
        open={settingsOpen}
        onSave={onSave}
        onClose={() => setSettingsOpen(false)}
      />
      {deletable ? (
      <IconButton
        icon={Trash2}
        label={`Delete ${name}`}
        size="sm"
        onClick={() => setConfirming(true)}
      />
      ) : null}
      <Dialog
        open={confirming}
        title="Delete this project?"
        description={`"${name}" will be deleted. Its tasks are not: they move to General.`}
        confirmLabel="Delete"
        confirmVariant="destructive"
        onConfirm={() => onDelete(project.id)}
        onClose={() => setConfirming(false)}
      />
    </>
  );
}

/**
 * The one affordance for adding a repo, which v1 had and nothing else in v2
 * does. Self-contained — button plus dialog — so it can be handed to the shell
 * as a header slot without the shell learning what a project is.
 *
 * The dialog is `ProjectDialog`, the same one editing a project opens. It used
 * to be a form of its own asking for a name and a path, which is how projects
 * came into being with none of their five defaults set and had to be reopened
 * to finish (TASK-81).
 */
export function NewProjectButton({
  onCreate,
}: {
  onCreate: (name: string, initialPath: string, settings: Partial<ProjectSettings>) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <IconButton
        icon={FolderPlus}
        label="New project"
        size="sm"
        onClick={() => setOpen(true)}
      />
      <ProjectDialog
        open={open}
        title="New project"
        confirmLabel="Create"
        initial={BLANK_PROJECT}
        // A constant is enough: the dialog is closed between openings, so the
        // key passes through null and the blank values are read again.
        seedKey="new"
        onSubmit={onCreate}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

export interface TaskSidebarOptions {
  selectedTaskId: string | null;
  onSelectTask: (id: string) => void;
  /** What the header's New task button does, and each project group header's.
   * Passed in rather than decided here: it is a navigation, and the sidebar
   * knows about tasks, not about addresses. The group headers name their
   * project; the header at the top names none. */
  onNewTask: (options?: { projectId?: string }) => void;
}

/** Exactly the left-column half of `AppShellProps`. Spread, so adding a control
 * to the sidebar does not mean threading another prop through the route. */
export type TaskSidebarProps = Pick<
  AppShellProps,
  | "tasks"
  | "groups"
  | "grouped"
  | "taskFilter"
  | "onTaskFilterChange"
  | "onToggleGrouping"
  | "showArchived"
  | "onToggleArchived"
  | "onNewTask"
  | "headerActions"
  | "unclaimed"
>;

export function useTaskSidebar({
  selectedTaskId,
  onSelectTask,
  onNewTask,
}: TaskSidebarOptions): TaskSidebarProps {
  const {
    tasks,
    archivedTasks,
    projects,
    unclaimed,
    renameTask,
    closeTask,
    loadArchivedTasks,
    archivePreview,
    archiveTask,
    deleteTaskForGood,
    deleteUnclaimedWorktree,
    createProject,
    updateProject,
    deleteProject,
  } = useTasks();
  // The filter, the grouping, the archived toggle and the closed groups live in
  // `sidebar-store`, not in this component (TASK-67). `/` and `/t/$slug` are
  // separate route components that each render their own `TaskShell`, so a
  // `useState` here is thrown away the moment the user acts on what they were
  // looking at — filter the list, click the task you found, and the box is empty
  // on the screen you used it to reach.
  //
  // Read with the initialiser rather than in an effect, so the first paint is
  // already the stored arrangement. An effect would draw the ungrouped default
  // and then swap it, which is the flash the store exists to avoid.
  const [sidebar, setSidebar] = useState(getSidebarState);
  const { filter, grouped, showArchived, closedGroups } = sidebar;
  /** Every write goes through the store, which merges against the live value
   * rather than against whatever this render closed over — two writes fired
   * from one event cannot then undo each other. A *toggle* has to read the
   * live value too, so it goes through `toggleSidebarFlag` rather than
   * negating what this render destructured. */
  const update = useCallback(
    (patch: Partial<SidebarState>) => setSidebar(patchSidebarState(patch)),
    [],
  );

  const handleRename = useCallback(
    (id: string, title: string) => void renameTask(id, title),
    [renameTask],
  );
  const handleClose = useCallback((id: string) => void closeTask(id), [closeTask]);
  const handleArchive = useCallback((id: string) => void archiveTask(id), [archiveTask]);
  const handleDeleteForGood = useCallback(
    (id: string) => void deleteTaskForGood(id),
    [deleteTaskForGood],
  );
  /** The dialog wants "the answer, or nothing"; the context answers with a
   * result carrying the failure it has already declined to toast. Flattened
   * here so `TaskRowActions` stays a component over plain values and can be
   * rendered in a test without one. */
  const handleArchivePreview = useCallback(
    async (id: string) => {
      const result = await archivePreview(id);
      return result.ok ? result.value : null;
    },
    [archivePreview],
  );

  // On every turn-on, not once: these rows are fetched rather than pushed, so
  // a list loaded before three tasks were archived would go on showing the
  // three it knew about.
  useEffect(() => {
    if (showArchived) void loadArchivedTasks();
  }, [showArchived, loadArchivedTasks]);
  const handleDeleteUnclaimed = useCallback(
    (path: string) => void deleteUnclaimedWorktree(path),
    [deleteUnclaimedWorktree],
  );
  const handleDeleteProject = useCallback((id: string) => deleteProject(id), [deleteProject]);

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  /** One message for the whole dialog — the name, the path and the defaults
   * (TASK-61). `updateProject` takes all three because renaming, moving and
   * reconfiguring are the same write, and splitting them would give a failure
   * a way to land half of it. */
  const handleSaveProject = useCallback(
    (id: string, name: string, initialPath: string, settings: Partial<ProjectSettings>) =>
      updateProject(id, name, initialPath, settings),
    [updateProject],
  );

  // The label is projected, not stored: an explicit rename, else the live
  // terminal title when it carries real content *and is unique*, else the
  // stable name. Claude Code sits on a bare "Claude Code" until it has a task,
  // so without this every agent task in the list reads identically — which is
  // the failure the projection exists to prevent (naming.ts).
  //
  // Over the live list only. `sessionDisplayNames` demotes a terminal title
  // that is not unique, and it counts stored names alongside titles — so
  // folding the archived rows in would let an archived task's stored name make
  // a live task's title ambiguous, and every label on screen could change the
  // moment the toggle went on. An archived task has no live terminal anyway, so
  // the projection would only ever hand back its stored title, which is what
  // its row uses directly.
  //
  // Directly, but still through this map: `selectTasks` matches the filter
  // against whatever this holds and falls back to the task *id* when it holds
  // nothing, so an archived row left out of it would be searchable only by its
  // UUID — type the name of the task you archived and it disappears from the
  // list you turned the toggle on to find it in. So the stored titles are added
  // after the projection has run, where they cannot make a live task's terminal
  // title ambiguous.
  const labels = useMemo(() => {
    const projected = sessionDisplayNames(
      tasks.map((t) => ({
        id: t.id,
        name: t.title,
        nameSource: t.titleSource,
        title: t.terminalTitle,
      })),
    );
    for (const t of archivedTasks) if (!projected.has(t.id)) projected.set(t.id, t.title);
    return projected;
  }, [tasks, archivedTasks]);

  const projectNames = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects],
  );

  // Recency across projects, flat, and in the order the server sent: `TaskInfo`
  // arrives sorted `last_active_at DESC`, so re-sorting here could only
  // disagree with it.
  //
  // Archived rows are appended rather than merged by recency: they are their
  // own answer to a different question, and re-sorting the whole list would
  // reorder the live rows under the pointer the moment the toggle went on.
  // `selectTasks` keeps its `archived` predicate all the same — it is the
  // guarantee that an archived row never draws while the toggle is off,
  // whoever concatenated what.
  //
  // Concatenated by id and not blindly, because for a moment the two lists can
  // hold the same task. They are corrected by different transports — `tasks` by
  // the socket's delta, `archivedTasks` by a fetch — so an archive whose fetch
  // lands before the delta that drops the live row has the task in both, and
  // the row would draw twice under one React key. The live copy wins: it is the
  // one the socket is about to correct.
  const visible = useMemo(() => {
    let all = tasks;
    if (showArchived) {
      const live = new Set(tasks.map((t) => t.id));
      all = [...tasks, ...archivedTasks.filter((t) => !live.has(t.id))];
    }
    return selectTasks(all, { labels, projectNames, filter, showArchived });
  }, [tasks, archivedTasks, labels, projectNames, filter, showArchived]);

  const rows = useMemo(() => {
    // Read inside the memo, not in the render body: as a dependency it changes
    // on every render, which would rebuild the whole list on every keystroke
    // and every activity delta — the memo would never hit. Ages are coarse
    // enough that recomputing them whenever the list actually changes is the
    // resolution this display has anyway.
    const now = Date.now();
    return visible.map((task): ShellTask => {
      const label = labels.get(task.id) ?? task.title;
      const state = taskStateOf(task);
      if (task.lifecycle === "archived") {
        // No `onClick`, and that is the sidebar agreeing with the server rather
        // than being cautious: `resumeTask` and `openTask` both refuse an
        // archived row, so a row that navigated would land on a slug the route
        // then bounced straight back off.
        return {
          id: task.id,
          title: label,
          state,
          archived: true,
          meta: ago(task.lastActiveAt, now),
          indent: false,
          actions: (
            <ArchivedRowActions taskId={task.id} label={label} onDelete={handleDeleteForGood} />
          ),
        };
      }
      return {
        id: task.id,
        title: label,
        state,
        preview: previewOf(task, label),
        meta: ago(task.lastActiveAt, now),
        selected: task.id === selectedTaskId,
        indent: false,
        // Two separate statements, and they answer different questions. The
        // flag is "this task has a checkout of its own", which the row knows
        // the moment the task exists; the facts are what git says about it,
        // which arrive later and may never arrive at all. Collapsing them would
        // make an unmeasured checkout indistinguishable from no checkout.
        worktree: task.worktreeState !== "none",
        worktreeFacts: task.worktree,
        // Selecting is all the sidebar does, including for a suspended task:
        // `AgentPane` resumes one when it mounts, and a second resume path
        // here would race it (§7.5, AC #4).
        onClick: () => onSelectTask(task.id),
        actions: (
          <TaskRowActions
            taskId={task.id}
            label={label}
            busy={state === "busy"}
            onRename={handleRename}
            onClose={handleClose}
            onArchivePreview={handleArchivePreview}
            onArchive={handleArchive}
          />
        ),
      };
    });
  }, [
    visible,
    labels,
    selectedTaskId,
    onSelectTask,
    handleRename,
    handleClose,
    handleArchivePreview,
    handleArchive,
    handleDeleteForGood,
  ]);

  const groups = useMemo(() => {
    const rowById = new Map(rows.map((row) => [row.id, row]));
    // A project with nothing in it is still worth a header — until it has a
    // task it has no other way onto the screen — but not while a filter is
    // running: it can never match one, so it would only be a row of noise
    // between the rows that did.
    const empties = filter.trim() ? [] : projects.map((p) => p.id);
    return groupByProject(visible, projectNames, empties).map((group) => ({
      id: group.id,
      name: group.name,
      open: !closedGroups[group.id],
      count: group.tasks.length,
      attention: group.tasks.some((t) => taskStateOf(t) === "attention"),
      onToggle: () => setSidebar(toggleSidebarGroup(group.id)),
      // Indented here and not in `rows`, because the same row is drawn both
      // ways and only one of them has a chevron to line up under.
      tasks: group.tasks.map((t) => ({ ...rowById.get(t.id)!, indent: true })),
      // Only for a project that is really one. `groupByProject` also emits a
      // group for tasks whose project has gone, and there is nothing behind
      // that header to configure or delete.
      actions: projectById.get(group.id) ? (
        <ProjectActions
          project={projectById.get(group.id)!}
          onSave={(name, path, settings) => handleSaveProject(group.id, name, path, settings)}
          onDelete={handleDeleteProject}
          deletable={group.id !== "general"}
          onNewTask={() => onNewTask({ projectId: group.id })}
        />
      ) : undefined,
    }));
  }, [rows, visible, projects, projectNames, closedGroups, filter, projectById, handleSaveProject, handleDeleteProject, onNewTask]);

  const headerActions: ReactNode = <NewProjectButton onCreate={createProject} />;

  // Straight through: the shell draws the band and decides that an empty list
  // is no band at all, so there is nothing to filter or sort here. Each entry
  // brings its own delete, the same way a task row brings its own actions.
  const unclaimedCards = useMemo(
    () =>
      unclaimed.map((worktree) => ({
        ...worktree,
        actions: (
          <UnclaimedActions
            path={worktree.path}
            branch={worktree.branch}
            onDelete={handleDeleteUnclaimed}
          />
        ),
      })),
    [unclaimed, handleDeleteUnclaimed],
  );

  return {
    tasks: rows,
    unclaimed: unclaimedCards,
    groups,
    grouped,
    taskFilter: filter,
    onTaskFilterChange: (e) => update({ filter: e.target.value }),
    onToggleGrouping: () => setSidebar(toggleSidebarFlag("grouped")),
    showArchived,
    onToggleArchived: () => setSidebar(toggleSidebarFlag("showArchived")),
    // Bare, not passed through: the shell wires this straight onto a button, so
    // handing the caller's function over directly would call it with a
    // MouseEvent — which is now an options object, and would read as a request
    // for a project whose id is `undefined` at best.
    onNewTask: () => onNewTask(),
    headerActions,
  };
}
