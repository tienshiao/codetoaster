import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Archive, FolderPlus, Pencil, SlidersHorizontal, Trash2, X } from "lucide-react";
import { taskStateOf, useTasks } from "@/frontend/TaskContext";
import { archiveSummary } from "@/frontend/archive-summary";
import { groupByProject, selectTasks } from "@/frontend/task-list";
import { meaningfulTitle, sessionDisplayNames } from "@/lib/xtmux/naming";
import type { ArchivePreview, ProjectInfo, ProjectSettings, TaskInfo } from "@/lib/xtmux/types";
import type { AppShellProps, ShellTask } from "@/frontend/components/v2/AppShell";
import { Dialog } from "@/frontend/components/v2/Dialog";
import { IconButton } from "@/frontend/components/v2/IconButton";
import { TextInput } from "@/frontend/components/v2/TextInput";
import { DirectoryBrowser, PathField } from "@/frontend/components/PathField";
import { ProjectSettingsDialog } from "@/frontend/components/ProjectSettingsDialog";

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
  const [preview, setPreview] = useState<ArchivePreview | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);

  // Asked on open, and asked again on every open: the counts are what the user
  // is being shown, and a dialog reopened an hour later must not quote what
  // git said the first time.
  useEffect(() => {
    if (!archiving) return;
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
  }, [archiving, taskId, onArchivePreview]);

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

      <Dialog
        open={archiving}
        title="Archive this task?"
        description={`${label} leaves the list, and the archived toggle is where it can be found again. What that costs:`}
        confirmLabel="Archive"
        confirmVariant="destructive"
        // Nothing to confirm against until the dialog has said what it costs.
        confirmDisabled={!preview && !previewFailed}
        onConfirm={() => onArchive(taskId)}
        onClose={() => setArchiving(false)}
      >
        <ArchiveBody preview={preview} failed={previewFailed} />
      </Dialog>

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

      <Dialog
        open={confirmingClose}
        title="Close this task?"
        description={`${label} is still working. Closing stops the agent; the task keeps its row and can be resumed.`}
        confirmLabel="Close task"
        confirmVariant="destructive"
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
   * decides a default model and permission mode. */
  deletable: boolean;
}

function ProjectActions({ project, onSave, onDelete, deletable }: ProjectActionsProps) {
  const [confirming, setConfirming] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const name = project.name;
  return (
    <>
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
 * Two views, one dialog. Browsing for a directory swaps the body and re-labels
 * the footer rather than opening a second `Dialog`: `Dialog` binds Escape to
 * `document` and renders `fixed z-50`, so stacking two of them would dismiss
 * both at once and leave their z-order to declaration order.
 */
export function NewProjectButton({
  onCreate,
}: {
  onCreate: (name: string, initialPath: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [browsing, setBrowsing] = useState(false);
  /** Whether the browser has been open once — only then should returning to the
   * form pull focus, since the first open belongs to the Name field. */
  const [browsed, setBrowsed] = useState(false);
  /** The row highlighted in the browser, already spelled the way the field wants. */
  const [picked, setPicked] = useState<string | null>(null);

  const usePicked = useCallback((chosen: string) => {
    setPath(chosen);
    setPicked(null);
    setBrowsing(false);
  }, []);

  return (
    <>
      <IconButton
        icon={FolderPlus}
        label="New project"
        size="sm"
        onClick={() => {
          setName("");
          setPath("");
          setPicked(null);
          setBrowsing(false);
          setBrowsed(false);
          setOpen(true);
        }}
      />
      <Dialog
        open={open}
        title={browsing ? "Choose a folder" : "New project"}
        confirmLabel={browsing ? "Use this folder" : "Create"}
        confirmDisabled={browsing ? !picked : !name.trim()}
        onConfirm={() => (browsing ? usePicked(picked!) : onCreate(name.trim(), path.trim()))}
        // While browsing, Cancel and Escape mean "back to the form", not
        // "abandon the project". That also makes confirming work without
        // `Dialog` growing a stay-open option: it calls `onConfirm` then
        // `onClose`, and here the second is the same leave-browse-mode the
        // first already did.
        onClose={() => (browsing ? setBrowsing(false) : setOpen(false))}
        className={browsing ? "max-w-md" : undefined}
      >
        {browsing ? (
          <DirectoryBrowser
            initialPath={path}
            onSelectionChange={setPicked}
            onCommit={usePicked}
          />
        ) : (
          <>
            <TextInput
              id="new-project-name"
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Website"
              data-1p-ignore
            />
            <PathField
              id="new-project-path"
              label="Repository path"
              value={path}
              onChange={setPath}
              placeholder="~/projects/website"
              autoFocus={browsed}
              onBrowse={() => {
                setPicked(null);
                setBrowsed(true);
                setBrowsing(true);
              }}
            />
          </>
        )}
      </Dialog>
    </>
  );
}

export interface TaskSidebarOptions {
  selectedTaskId: string | null;
  onSelectTask: (id: string) => void;
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
}: TaskSidebarOptions): TaskSidebarProps {
  const {
    tasks,
    archivedTasks,
    projects,
    unclaimed,
    createTask,
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
  const [filter, setFilter] = useState("");
  const [grouped, setGrouped] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  // Only the groups the user has closed; everything else defaults open.
  const [closedGroups, setClosedGroups] = useState<Record<string, boolean>>({});

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
  const visible = useMemo(
    () =>
      selectTasks(showArchived ? [...tasks, ...archivedTasks] : tasks, {
        labels,
        projectNames,
        filter,
        showArchived,
      }),
    [tasks, archivedTasks, labels, projectNames, filter, showArchived],
  );

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
      onToggle: () =>
        setClosedGroups((closed) => ({ ...closed, [group.id]: !closed[group.id] })),
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
        />
      ) : undefined,
    }));
  }, [rows, visible, projects, projectNames, closedGroups, filter, projectById, handleSaveProject, handleDeleteProject]);

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
    onTaskFilterChange: (e) => setFilter(e.target.value),
    onToggleGrouping: () => setGrouped((on) => !on),
    showArchived,
    onToggleArchived: () => setShowArchived((on) => !on),
    onNewTask: () => void createTask({ cols: 120, rows: 30 }),
    headerActions,
  };
}
