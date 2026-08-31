import type { Database, SQLQueryBindings } from "bun:sqlite";
import type { AgentState, Lifecycle, TaskRow, TitleSource, WorktreeState } from "../db";

// The columns a caller has to decide. Everything else either has a sensible
// starting value (a task begins live, starting, with no worktree) or is
// something only the agent and the harvester learn later.
export interface NewTask {
  id: string;
  project_id: string;
  title: string;
  initial_prompt: string;
  repo_root: string | null;
  cwd: string;
  title_source?: TitleSource;
  worktree_path?: string | null;
  worktree_repo?: string | null;
  branch?: string | null;
  base_ref?: string | null;
  worktree_state?: WorktreeState;
  agent_session_id?: string | null;
  agent_state?: AgentState;
  lifecycle?: Lifecycle;
  model?: string | null;
  permission_mode?: string | null;
  pinned?: boolean;
  created_at?: number;
  last_active_at?: number;
}

export interface TaskFilter {
  /** One lifecycle or several; omitted means every task, archived included. */
  lifecycle?: Lifecycle | Lifecycle[];
}

export type TaskUpdate = Partial<Omit<TaskRow, "id">>;

// Every column an update is allowed to name. `update` builds its SET clause
// from caller-supplied keys, and a key reaches SQL as an identifier, not a
// bound parameter — so it is checked against this set rather than trusted.
// The type says as much at compile time; this is what holds at runtime, where
// the object may have come off the wire.
const UPDATABLE_COLUMNS: ReadonlySet<string> = new Set([
  "project_id", "title", "title_source", "initial_prompt", "repo_root", "cwd",
  "worktree_path", "worktree_repo", "branch", "base_ref", "worktree_state",
  "wip_ref", "wip_at",
  "setup_duration_ms", "pinned", "agent_session_id", "transcript_path",
  "agent_state", "lifecycle", "last_message", "last_size_cols", "last_size_rows",
  "model", "permission_mode", "created_at", "last_active_at", "idle_since",
  "exit_code",
]);

const INSERT_COLUMNS = [
  "id", "project_id", "title", "title_source", "initial_prompt", "repo_root",
  "cwd", "worktree_path", "worktree_repo", "branch", "base_ref", "worktree_state", "pinned",
  "agent_session_id", "agent_state", "lifecycle", "model", "permission_mode",
  "created_at", "last_active_at",
] as const;

// Pure data access over the `tasks` table (§5.2). It holds no processes, runs
// no git, and touches no filesystem: a task row is just what we know about a
// task, and a task can exist with nothing running.
//
// The database handle is a constructor argument rather than the module-wide
// singleton so a caller — a test, or a second store over a different file —
// can say which database it means.
export class TaskStore {
  constructor(private db: Database) {}

  create(task: NewTask): TaskRow {
    const row = {
      id: task.id,
      project_id: task.project_id,
      title: task.title,
      title_source: task.title_source ?? "derived",
      initial_prompt: task.initial_prompt,
      repo_root: task.repo_root,
      cwd: task.cwd,
      worktree_path: task.worktree_path ?? null,
      worktree_repo: task.worktree_repo ?? null,
      branch: task.branch ?? null,
      base_ref: task.base_ref ?? null,
      worktree_state: task.worktree_state ?? "none",
      pinned: task.pinned ? 1 : 0,
      agent_session_id: task.agent_session_id ?? null,
      agent_state: task.agent_state ?? "starting",
      lifecycle: task.lifecycle ?? "live",
      model: task.model ?? null,
      permission_mode: task.permission_mode ?? null,
      created_at: task.created_at ?? Date.now(),
      // A brand-new task is the most recent thing that happened, so it sorts
      // to the top of the list before anything has run in it.
      last_active_at: task.last_active_at ?? task.created_at ?? Date.now(),
    };
    this.db.run(
      `INSERT INTO tasks (${INSERT_COLUMNS.join(", ")})
       VALUES (${INSERT_COLUMNS.map(() => "?").join(", ")})`,
      INSERT_COLUMNS.map((column) => row[column]),
    );
    return this.get(task.id)!;
  }

  get(id: string): TaskRow | undefined {
    // bun:sqlite reports a missing row as null; callers of a store should not
    // have to know which flavour of absent they are holding.
    return (this.db.query("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | null) ?? undefined;
  }

  /** Most recently active first — the only order the task list is ever shown in. */
  list(filter: TaskFilter = {}): TaskRow[] {
    const lifecycles = filter.lifecycle === undefined
      ? undefined
      : Array.isArray(filter.lifecycle) ? filter.lifecycle : [filter.lifecycle];
    if (lifecycles?.length === 0) return [];

    const where = lifecycles
      ? ` WHERE lifecycle IN (${lifecycles.map(() => "?").join(", ")})`
      : "";
    return this.db
      .query(`SELECT * FROM tasks${where} ORDER BY last_active_at DESC`)
      .all(...(lifecycles ?? [])) as TaskRow[];
  }

  /** Writes only the columns named. A field set to undefined is left alone;
   * null is a value, and clears the column. */
  update(id: string, fields: TaskUpdate): TaskRow | undefined {
    const sets: string[] = [];
    const values: SQLQueryBindings[] = [];
    for (const [column, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      if (!UPDATABLE_COLUMNS.has(column)) {
        throw new Error(`Not an updatable task column: ${column}`);
      }
      sets.push(`${column} = ?`);
      values.push(value as SQLQueryBindings);
    }
    if (sets.length === 0) return this.get(id);
    values.push(id);
    this.db.run(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`, values);
    return this.get(id);
  }

  /** Move every task of one project to another, and answer how many moved.
   * Rows outlive the manager's in-memory grouping — a task suspended by a
   * previous run is in no project's `taskIds` but still carries its
   * `project_id` — so deleting a project has to reassign by column, not by
   * whatever the manager happens to be holding. */
  reassignProject(from: string, to: string): number {
    return this.db.run("UPDATE tasks SET project_id = ? WHERE project_id = ?", [to, from]).changes;
  }

  /** True if a row was actually removed. Archiving is a lifecycle, not this —
   * a deleted task is one we are done remembering. */
  delete(id: string): boolean {
    return this.db.run("DELETE FROM tasks WHERE id = ?", [id]).changes > 0;
  }
}
