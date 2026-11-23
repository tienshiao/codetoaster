import { UnknownProfileError } from "../agent/profiles";
import * as db from "../db";
import type { ProjectRow, TaskRow } from "../db";
import { expandTilde } from "../tilde";
import { repoRootOf } from "../worktree";
import type { ProjectInfo, ProjectSettings } from "../xtmux/types";
import type { CreateTaskOptions } from "./manager";
import type { TaskHost } from "./host";

/** The project every task without one falls into. Minted per call rather than
 * shared: the caller pushes it into a list whose `taskIds` it then mutates. */
function generalProject(): ProjectInfo {
  return {
    id: "general",
    name: "General",
    initialPath: "",
    taskIds: [],
    ...UNSET_PROJECT_SETTINGS,
  };
}

/** A project that decides nothing on its tasks' behalf. Every field here is
 * "ask someone else": the agent's own default for the model and mode, the
 * repository's HEAD for the base ref, and no setup at all. Spelled once so a
 * project minted in memory — General, and a freshly created one — cannot
 * drift from the shape `loadProjects` reads off a row. */
const UNSET_PROJECT_SETTINGS: ProjectSettings = {
  defaultModel: null,
  defaultPermissionMode: null,
  defaultProfile: null,
  defaultBaseRef: null,
  setupCommand: null,
  worktreeCopy: null,
  worktreeDefault: false,
};

/** A project row's settings, in the shape the client reads them. The one
 * conversion is `worktree_default`: SQLite has no boolean, and doing it here
 * means no reader downstream has to remember that 0 is a number. */
function projectSettingsOf(row: ProjectRow): ProjectSettings {
  return {
    defaultModel: row.default_model,
    defaultPermissionMode: row.default_permission_mode,
    defaultProfile: row.default_profile,
    defaultBaseRef: row.default_base_ref,
    setupCommand: row.setup_command,
    worktreeCopy: row.worktree_copy,
    worktreeDefault: row.worktree_default !== 0,
  };
}

/** A settings patch with `""` resolved to "unset", which is the one thing a
 * text field cannot say for itself. A cleared input sends an empty string, and
 * a project storing one would put an empty `--model` on the agent's argv or
 * branch a worktree from a ref called nothing — so blank becomes `null`, which
 * is how unset is spelled everywhere else.
 *
 * Normalized once, before either the database or the in-memory projection sees
 * it, so the client is told back what was actually stored rather than what it
 * sent. A client echoing its own `""` would show a value the next reload
 * contradicts.
 *
 * Absence is `undefined`, not a missing key. A patch assembled from a form —
 * `{ setupCommand: form.setup }` where that field was not on this dialog —
 * carries the key with nothing behind it, and reading that as "unset it" would
 * clear a setting the caller never mentioned. Everywhere else a patch is
 * written here (`TaskStore.update`, `db.updateProject`) `undefined` already
 * means "leave alone"; this agrees with them. `null` is still a value, and is
 * how a setting is deliberately cleared. */
function normalizeSettingsPatch(patch: Partial<ProjectSettings>): Partial<ProjectSettings> {
  const next: Partial<ProjectSettings> = {};
  // `unknown` in, because this arrives off the socket with nothing between it
  // and here: a client sending a number for `defaultModel` must get it
  // rejected as unset, not throw `.trim is not a function` out of the message
  // handler and take the frame with it.
  const text = (value: unknown) => (typeof value === "string" ? value.trim() || null : null);
  if (patch.defaultModel !== undefined) next.defaultModel = text(patch.defaultModel);
  if (patch.defaultPermissionMode !== undefined) {
    next.defaultPermissionMode = text(patch.defaultPermissionMode);
  }
  // Normalized like the rest — blank is unset, which is how the dialog's empty
  // choice arrives. Whether the name is one this daemon knows is *not* asked
  // here: this function has no registry, and the answer belongs where the
  // failure can be reported, which is the two writers below.
  if (patch.defaultProfile !== undefined) next.defaultProfile = text(patch.defaultProfile);
  if (patch.defaultBaseRef !== undefined) next.defaultBaseRef = text(patch.defaultBaseRef);
  if (patch.setupCommand !== undefined) next.setupCommand = text(patch.setupCommand);
  // Blank-as-a-whole is unset here too, but the entries inside are left alone:
  // this is a list, one path per line, and trimming each is `parseCopyList`'s
  // job at the point of use.
  if (patch.worktreeCopy !== undefined) next.worktreeCopy = text(patch.worktreeCopy);
  if (patch.worktreeDefault !== undefined) next.worktreeDefault = patch.worktreeDefault === true;
  return next;
}

/** The columns a normalized patch writes. */
function settingsColumns(patch: Partial<ProjectSettings>): Partial<ProjectRow> {
  const columns: Partial<ProjectRow> = {};
  if ("defaultModel" in patch) columns.default_model = patch.defaultModel;
  if ("defaultPermissionMode" in patch) {
    columns.default_permission_mode = patch.defaultPermissionMode;
  }
  if ("defaultProfile" in patch) columns.default_profile = patch.defaultProfile;
  if ("defaultBaseRef" in patch) columns.default_base_ref = patch.defaultBaseRef;
  if ("setupCommand" in patch) columns.setup_command = patch.setupCommand;
  if ("worktreeCopy" in patch) columns.worktree_copy = patch.worktreeCopy;
  if ("worktreeDefault" in patch) columns.worktree_default = patch.worktreeDefault ? 1 : 0;
  return columns;
}

/** The projects and the sidebar's grouping of tasks into them: loaded from the
 * database, edited by the project routes, and read by everything that has to
 * know which project a task is in. Split out of TaskManager (TASK-152). */
export class ProjectRegistry {
  projects: ProjectInfo[] = [generalProject()];

  constructor(private readonly host: TaskHost) {}

  loadProjects(): void {
    const rows = db.getAllProjects(this.host.db);
    this.projects = rows.map((row) => ({
      id: row.id,
      name: row.name,
      initialPath: row.initial_path,
      taskIds: [],
      ...projectSettingsOf(row),
    }));
    // Ensure General always exists
    if (!this.projects.some((p) => p.id === "general")) {
      this.projects.unshift(generalProject());
    }
  }

  /** The same answer as `repoRootFor` (suspend.ts), without healing the row
   * with it.
   *
   * Hard delete needs this: it removes the row first, deliberately and
   * synchronously, and only then goes looking for the checkout and the branch
   * to clean up — so by the time it asks, the write-back in `repoRootFor` would either
   * silently do nothing or, worse, resurrect a task that has just been deleted.
   * Splitting the two makes "which repository is this?" a question that can be
   * asked about a row nobody holds any more. */
  async resolveRepoRoot(row: TaskRow): Promise<string | null> {
    if (row.worktree_repo) return row.worktree_repo;
    const project = this.projects.find((p) => p.id === row.project_id);
    if (!project?.initialPath) return null;
    return await repoRootOf(expandTilde(project.initialPath)).catch(() => null);
  }

  hasProject(projectId: string): boolean {
    return this.projects.some((p) => p.id === projectId);
  }

  getProjects(): ProjectInfo[] {
    return this.projects.map((p) => ({ ...p, taskIds: [...p.taskIds] }));
  }

  /** `getProjects` with each project's sidebar rank (TASK-141), for the
   * snapshot alone. Kept off `getProjects`, which the project-rooted routes
   * call per request only to find one project: the rank is a grouped scan of
   * the whole tasks table, archived rows included, that only the list needs. */
  rankedProjects(): ProjectInfo[] {
    const ranks = this.host.store.projectRanks();
    return this.host.getProjects().map((p) => ({ ...p, rankAt: ranks.get(p.id) ?? null }));
  }

  resolveProjectId(options: CreateTaskOptions): string {
    if (options.afterTaskId) {
      const after = this.projects.find((p) => p.taskIds.includes(options.afterTaskId!));
      if (after && (!options.projectId || options.projectId === after.id)) return after.id;
    }
    if (options.projectId && this.projects.some((p) => p.id === options.projectId)) {
      return options.projectId;
    }
    return "general";
  }

  /** Put a task into the sidebar grouping if it is not there already, by the
   * project its row names. What a task created by a previous daemon needs
   * before it can appear in `listTasks` at all — `loadProjects` starts every
   * project empty, since the ordering is the only thing the rows do not
   * record. */
  ensureInProject(taskId: string): void {
    if (this.projects.some((p) => p.taskIds.includes(taskId))) return;
    const projectId = this.host.store.get(taskId)?.project_id;
    const project =
      this.projects.find((p) => p.id === projectId) ??
      this.projects.find((p) => p.id === "general");
    project?.taskIds.push(taskId);
  }

  /** `projectId` is the one already written to the row, not a fresh
   * resolution: the two must not be able to disagree. Falls back to General if
   * the project was deleted while the create was awaiting, which is the same
   * place `deleteProject` would have moved the task to anyway. */
  placeInProject(taskId: string, projectId: string, options: CreateTaskOptions): void {
    const project =
      this.projects.find((p) => p.id === projectId) ??
      this.projects.find((p) => p.id === "general");
    if (!project) return;
    const afterIndex = options.afterTaskId ? project.taskIds.indexOf(options.afterTaskId) : -1;
    if (afterIndex >= 0) {
      project.taskIds.splice(afterIndex + 1, 0, taskId);
    } else {
      project.taskIds.push(taskId);
    }
  }

  /** A default profile is refused before it is stored, never after.
   *
   * The failure a project's default causes is not the project's: it is every
   * `createTask` started in it, where `profiles.require` throws at a point the
   * user has already typed a prompt and pressed Start. Checked at the write —
   * the one moment a name arrives from a client — the mistake is reported to
   * the person who made it, while a project that was configured before a
   * `profiles.json` edit removed the profile keeps its column and fails
   * honestly at the create. Nothing rewrites a stored value behind the user.
   *
   * Only a non-null one: null is unset and resolves to `claude`, and `claude`
   * is a name a registry can never be without. */
  private checkDefaultProfile(patch: Partial<ProjectSettings>): void {
    const name = patch.defaultProfile;
    if (typeof name !== "string") return;
    if (!this.host.profiles.get(name)) throw new UnknownProfileError(name);
  }

  /** Add a project, with whatever it starts out deciding for its tasks.
   *
   * `settings` is optional and normalized exactly as `updateProject` does it,
   * so blank reaches the column as NULL rather than as an empty string — a
   * project storing `""` as its model would put an empty `--model` on an
   * agent's argv. Anything left out keeps the unset default.
   *
   * One write and one broadcast, rather than a create followed by an update:
   * the second would put a project on every attached client with none of the
   * defaults it was created with, and leave it that way if the update failed. */
  createProject(
    id: string,
    name: string,
    initialPath: string,
    settings?: Partial<ProjectSettings>,
  ): void {
    if (this.projects.some((p) => p.id === id)) {
      throw new Error(`Project "${id}" already exists`);
    }
    const patch = settings ? normalizeSettingsPatch(settings) : {};
    this.checkDefaultProfile(patch);
    db.createProject(
      {
        id,
        name,
        initial_path: initialPath,
        sort_order: this.projects.length,
        ...settingsColumns(patch),
      },
      this.host.db,
    );
    this.projects.push({
      id,
      name,
      initialPath,
      taskIds: [],
      ...UNSET_PROJECT_SETTINGS,
      ...patch,
    });
    this.host.broadcastTasks();
  }

  /** Rename a project, move it, and set what it decides for its tasks.
   *
   * `settings` is a patch and an absent field keeps what the project has —
   * the rename dialog sends none of them, and must not clear a setup command
   * it never showed the user. An explicit `null` (or a cleared text field,
   * which normalizes to one) is how a setting is unset. */
  updateProject(
    id: string,
    name: string,
    initialPath: string,
    settings?: Partial<ProjectSettings>,
  ): boolean {
    const project = this.projects.find((p) => p.id === id);
    if (!project) return false;
    const patch = settings ? normalizeSettingsPatch(settings) : {};
    this.checkDefaultProfile(patch);
    db.updateProject(
      id,
      { name, initial_path: initialPath, ...settingsColumns(patch) },
      this.host.db,
    );
    project.name = name;
    project.initialPath = initialPath;
    Object.assign(project, patch);
    this.host.broadcastTasks();
    return true;
  }

  deleteProject(id: string): boolean {
    if (id === "general") return false;
    const index = this.projects.findIndex((p) => p.id === id);
    if (index === -1) return false;
    const project = this.projects[index]!;
    const general = this.projects.find((p) => p.id === "general")!;
    // Every checkout of this project gets told where its repository is, before
    // the project that knows stops existing (TASK-64). This is the moment a
    // task is stranded: the reassignment below moves it to General, whose path
    // is empty, and from then on nothing can name the repository its branch and
    // its snapshot live in — so it can neither be reopened nor evicted, and the
    // directory is pinned on disk forever.
    //
    // The project's own directory rather than a resolved toplevel, which is
    // what lets this stay synchronous: the column is documented as *a*
    // directory inside the repository, and `git -C` asks for no more than that.
    // Only rows that have none are touched, so a task that recorded its own at
    // create keeps it — that one is the truth about where the worktree was
    // actually added, and this is a fallback.
    const projectPath = project.initialPath ? expandTilde(project.initialPath) : null;
    if (projectPath) {
      for (const task of this.host.store.list()) {
        if (task.project_id !== id || task.worktree_repo || task.worktree_state === "none") continue;
        this.host.store.update(task.id, { worktree_repo: projectPath });
      }
    }
    // The tasks outlive the grouping: they move to General rather than being
    // destroyed with it. By column, not by `project.taskIds` — that list only
    // holds the tasks this run started, so a task suspended by a previous
    // daemon would keep a project_id pointing at a project that no longer
    // exists, and nothing else ever revisits the column.
    this.host.store.reassignProject(id, "general");
    general.taskIds.push(...project.taskIds);
    this.projects.splice(index, 1);
    db.deleteProject(id, this.host.db);
    this.host.broadcastTasks();
    return true;
  }

  reorderProjects(orderedProjects: Array<{ id: string; taskIds: string[] }>): void {
    const validTaskIds = new Set(this.projects.flatMap((p) => p.taskIds));
    const existing = new Map(this.projects.map((p) => [p.id, p]));
    const seenProjects = new Set<string>();
    const seenTasks = new Set<string>();
    const next: ProjectInfo[] = [];

    for (const { id, taskIds } of orderedProjects) {
      const project = existing.get(id);
      if (!project || seenProjects.has(id)) continue;
      seenProjects.add(id);

      const kept: string[] = [];
      for (const taskId of taskIds) {
        if (validTaskIds.has(taskId) && !seenTasks.has(taskId)) {
          kept.push(taskId);
          seenTasks.add(taskId);
        }
      }
      next.push({ ...project, taskIds: kept });
    }

    // Append projects the client did not mention, keeping whatever they held.
    for (const project of this.projects) {
      if (seenProjects.has(project.id)) continue;
      const kept = project.taskIds.filter((id) => validTaskIds.has(id) && !seenTasks.has(id));
      for (const id of kept) seenTasks.add(id);
      next.push({ ...project, taskIds: kept });
      seenProjects.add(project.id);
    }

    // Anything the reorder dropped on the floor lands in General rather than
    // vanishing from the sidebar while its process keeps running.
    const general = next.find((p) => p.id === "general")!;
    for (const taskId of validTaskIds) {
      if (!seenTasks.has(taskId)) general.taskIds.push(taskId);
    }

    this.projects = next;
    // The in-memory order is the v1 sidebar's, but which project a task
    // belongs to is durable — so rows that actually moved get written, and
    // the ones that only shifted position do not.
    for (const project of next) {
      for (const taskId of project.taskIds) {
        if (this.host.store.get(taskId)?.project_id !== project.id) {
          this.host.store.update(taskId, { project_id: project.id });
        }
      }
    }
    db.updateProjectOrder(next.map((p, i) => ({ id: p.id, sort_order: i })), this.host.db);
    this.host.broadcastTasks();
  }
}
