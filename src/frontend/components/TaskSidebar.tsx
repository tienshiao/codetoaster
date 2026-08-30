import { useCallback, useMemo, useState, type ReactNode } from "react";
import { FolderPlus, Pencil, Trash2, X } from "lucide-react";
import { taskStateOf, useTasks } from "@/frontend/TaskContext";
import { groupByProject, selectTasks } from "@/frontend/task-list";
import { meaningfulTitle, sessionDisplayNames } from "@/lib/xtmux/naming";
import type { TaskInfo } from "@/lib/xtmux/types";
import type { AppShellProps, ShellTask } from "@/frontend/components/v2/AppShell";
import { Dialog } from "@/frontend/components/v2/Dialog";
import { IconButton } from "@/frontend/components/v2/IconButton";
import { TextInput } from "@/frontend/components/v2/TextInput";

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
 * back to `<dir> · <branch>` and the title is the more specific of the two.
 */
function previewOf(task: TaskInfo, label: string): string | undefined {
  if (task.lastMessage) return task.lastMessage;
  const title = meaningfulTitle(task.terminalTitle);
  return title && title !== label ? title : undefined;
}

interface TaskRowActionsProps {
  taskId: string;
  label: string;
  /** Closing a working agent interrupts it, so that one asks first. */
  busy: boolean;
  onRename: (id: string, title: string) => void;
  onClose: (id: string) => void;
}

/**
 * Rename and close, as siblings of the row rather than children of it — see
 * `ShellTask.actions`. Two plain buttons and not a menu behind an ellipsis:
 * a menu would need a popover the v2 system does not have yet, and would put
 * both actions two keystrokes away instead of one.
 */
export function TaskRowActions({ taskId, label, busy, onRename, onClose }: TaskRowActionsProps) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmingClose, setConfirmingClose] = useState(false);

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
        icon={X}
        label={`Close ${label}`}
        size="sm"
        onClick={() => (busy ? setConfirmingClose(true) : onClose(taskId))}
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

interface ProjectActionsProps {
  projectId: string;
  name: string;
  onDelete: (id: string) => void;
}

function ProjectActions({ projectId, name, onDelete }: ProjectActionsProps) {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <IconButton
        icon={Trash2}
        label={`Delete ${name}`}
        size="sm"
        onClick={() => setConfirming(true)}
      />
      <Dialog
        open={confirming}
        title="Delete this project?"
        description={`"${name}" will be deleted. Its tasks are not: they move to General.`}
        confirmLabel="Delete"
        confirmVariant="destructive"
        onConfirm={() => onDelete(projectId)}
        onClose={() => setConfirming(false)}
      />
    </>
  );
}

/**
 * The one affordance for adding a repo, which v1 had and nothing else in v2
 * does. Self-contained — button plus dialog — so it can be handed to the shell
 * as a header slot without the shell learning what a project is.
 */
export function NewProjectButton({
  onCreate,
}: {
  onCreate: (name: string, initialPath: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [path, setPath] = useState("");

  return (
    <>
      <IconButton
        icon={FolderPlus}
        label="New project"
        size="sm"
        onClick={() => {
          setName("");
          setPath("");
          setOpen(true);
        }}
      />
      <Dialog
        open={open}
        title="New project"
        confirmLabel="Create"
        confirmDisabled={!name.trim()}
        onConfirm={() => onCreate(name.trim(), path.trim())}
        onClose={() => setOpen(false)}
      >
        <TextInput
          id="new-project-name"
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Website"
          data-1p-ignore
        />
        <TextInput
          id="new-project-path"
          label="Repository path"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="~/projects/website"
          data-1p-ignore
        />
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
>;

export function useTaskSidebar({
  selectedTaskId,
  onSelectTask,
}: TaskSidebarOptions): TaskSidebarProps {
  const { tasks, projects, createTask, renameTask, closeTask, createProject, deleteProject } =
    useTasks();
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
  const handleDeleteProject = useCallback((id: string) => deleteProject(id), [deleteProject]);

  // The label is projected, not stored: an explicit rename, else the live
  // terminal title when it carries real content *and is unique*, else the
  // stable name. Claude Code sits on a bare "Claude Code" until it has a task,
  // so without this every agent task in the list reads identically — which is
  // the failure the projection exists to prevent (naming.ts).
  const labels = useMemo(
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

  const projectNames = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects],
  );

  // Recency across projects, flat, and in the order the server sent: `TaskInfo`
  // arrives sorted `last_active_at DESC`, so re-sorting here could only
  // disagree with it.
  const visible = useMemo(
    () => selectTasks(tasks, { labels, projectNames, filter, showArchived }),
    [tasks, labels, projectNames, filter, showArchived],
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
      return {
        id: task.id,
        title: label,
        state,
        preview: previewOf(task, label),
        meta: ago(task.lastActiveAt, now),
        selected: task.id === selectedTaskId,
        indent: false,
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
          />
        ),
      };
    });
  }, [visible, labels, selectedTaskId, onSelectTask, handleRename, handleClose]);

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
      // General is the fallback every orphaned task moves to, so deleting it
      // would leave them nowhere; the server refuses, and offering the button
      // anyway would just be a dialog that does nothing.
      actions:
        group.id === "general" ? undefined : (
          <ProjectActions
            projectId={group.id}
            name={group.name}
            onDelete={handleDeleteProject}
          />
        ),
    }));
  }, [rows, visible, projects, projectNames, closedGroups, filter, handleDeleteProject]);

  const headerActions: ReactNode = <NewProjectButton onCreate={createProject} />;

  return {
    tasks: rows,
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
