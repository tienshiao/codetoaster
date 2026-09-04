import { Database } from "bun:sqlite";
import * as fs from "fs";
import * as path from "path";

export interface ProjectRow {
  id: string;
  name: string;
  initial_path: string;
  sort_order: number;
  // v2 defaults a new task inherits from its project. NULL means "unset" —
  // the task falls back to whatever the agent or git would have picked
  // anyway, which is why none of these carry a default value.
  default_base_ref: string | null;
  default_model: string | null;
  default_permission_mode: string | null;
  // Run after every `git worktree add` (e.g. `bun install`), and the ignored
  // files to copy over from the project checkout (e.g. `.env`).
  setup_command: string | null;
  worktree_copy: string | null;
  worktree_default: number;
}

// One row of the v2 `tasks` table (docs/v2-architecture.md §5.1). A task
// outlives the process that runs it, so every column here is something a
// suspended task still has to answer for — where its checkout is, what the
// agent was last doing, how big its grid was.
export interface TaskRow {
  id: string;
  project_id: string;
  title: string;
  title_source: TitleSource;
  initial_prompt: string;
  /** NULL when the task's directory is not inside a repository. Every git
   * route needs one, so this is the difference between "browse it" and a 400 —
   * which a directory standing in for a repo root could not express. */
  repo_root: string | null;
  cwd: string;
  worktree_path: string | null;
  /** A directory inside the repository the checkout was added to — the one fact
   * a task needs to survive its project (TASK-64).
   *
   * *A* directory, not the toplevel exactly, and that is deliberate: every
   * consumer runs `git -C <this>`, which resolves the repository from anywhere
   * inside it. Requiring the toplevel would force a `rev-parse` before the
   * value could be written, which would make `deleteProject` — the operation
   * that most needs to stamp one — asynchronous for no gain.
   *
   * Not `repo_root`, which is `--show-toplevel` resolved from `cwd`: for a
   * worktree task that names the *checkout's* own root, so it dies with the
   * directory the moment the task is evicted. Every worktree operation used to
   * find the repository through the project instead, and a project deleted from
   * under a task reassigns it to General — whose path is empty — leaving a task
   * that could neither be reopened nor evicted, with its branch and its
   * snapshot sitting in a repository nothing could name.
   *
   * A working directory and not the git common dir, though: `worktree add`,
   * `worktree list` and `update-ref` all work from a `.git` directory, but
   * `rev-parse --show-toplevel` does not, so a `.git` here would break anything
   * that re-derives the root.
   *
   * NULL for a task with no checkout of its own, and for one created before
   * this column existed — those resolve from the project once and write the
   * answer back. */
  worktree_repo: string | null;
  /** Where in the checkout the task actually works: the project's directory
   * relative to the repository's toplevel, `''` for a project pointing at the
   * root (TASK-65).
   *
   * A project's `initial_path` need not be a repository root — `repo/frontend`
   * is a reasonable thing to point one at — and a worktree is a checkout of the
   * whole repository. So the offset is what turns one into the other: the
   * agent's cwd is `<worktree>/<this>`, and the `worktree_copy` entries are read
   * from and written to that directory rather than the toplevel.
   *
   * Recorded at create rather than recomputed, because a restore resolves the
   * repository from `worktree_repo` and cannot ask the project: the project may
   * have been deleted (TASK-64), or repointed somewhere else entirely, and
   * either way the checkout the task was evicted from has to come back at the
   * same directory the transcript was recorded against.
   *
   * NULL for every task created before this column existed, read as `''` — that
   * is exactly what those tasks got, since the cwd was the worktree root. */
  worktree_subdir: string | null;
  branch: string | null;
  base_ref: string | null;
  worktree_state: WorktreeState;
  wip_ref: string | null;
  wip_at: number | null;
  setup_duration_ms: number | null;
  pinned: number;
  agent_session_id: string | null;
  transcript_path: string | null;
  agent_state: AgentState;
  lifecycle: Lifecycle;
  last_message: string | null;
  last_size_cols: number | null;
  last_size_rows: number | null;
  model: string | null;
  permission_mode: string | null;
  created_at: number;
  last_active_at: number;
  idle_since: number | null;
  exit_code: number | null;
}

export type TitleSource = "derived" | "manual";
// Where the task's checkout stands: `none` for a task running straight in the
// project directory, `evicted` for one whose worktree we removed to reclaim
// disk (restorable), `missing` for one removed behind our back.
export type WorktreeState = "none" | "present" | "evicted" | "missing";
// `unknown` is "we cannot tell" — no hook has ever reported for this task
// (TASK-12). `could_not_resume` is the different, sharper thing: we tried
// every way of reopening the conversation and none of them worked, so the card
// has a button to offer rather than a shrug (§4.3).
export type AgentState =
  | "starting" | "busy" | "idle" | "needs_attention" | "compacting" | "exited"
  | "unknown" | "could_not_resume";
export type Lifecycle = "live" | "suspended" | "archived";

interface Migration {
  name: string;
  up(db: Database): void;
}

const migrations: Migration[] = [
  {
    name: "001_initial_projects",
    up(db) {
      // IF NOT EXISTS / OR IGNORE for the same reason 003 and 004 guard
      // themselves: a database whose applied_migrations row went missing must
      // not wedge the daemon on "table projects already exists" at every boot.
      // The shape is unchanged, so this is a no-op for every database that
      // already ran it.
      db.run(`
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          initial_path TEXT NOT NULL DEFAULT '',
          color TEXT NOT NULL DEFAULT '',
          sort_order INTEGER NOT NULL DEFAULT 0
        )
      `);
      db.run(`INSERT OR IGNORE INTO projects (id, name, sort_order) VALUES ('general', 'General', 0)`);
    },
  },
  {
    // Project colors were removed: they tinted session rows and the top bar,
    // which turned out to be noise rather than signal. Migration 001 is left
    // as it was — history is append-only — so this drops the column from
    // databases that already ran it.
    name: "002_drop_project_color",
    up(db) {
      // Best-effort: a leftover column is inert (nothing reads it, and inserts
      // rely on its DEFAULT), whereas a throw here aborts the transaction, so
      // the migration is never recorded and every subsequent start fails the
      // same way — an unusable daemon over a column nobody looks at.
      const columns = db.query(`PRAGMA table_info(projects)`).all() as { name: string }[];
      if (!columns.some((c) => c.name === "color")) return;
      try {
        db.run(`ALTER TABLE projects DROP COLUMN color`);
      } catch (e) {
        console.warn("Could not drop the unused projects.color column:", e);
      }
    },
  },
  {
    // v2's task model. A task is the durable thing — it owns a checkout, an
    // agent conversation, and a grid size, and it keeps all three while no
    // process is running. Scrollback is deliberately absent: those are
    // multi-hundred-KB ANSI blobs and live at
    // ~/.codetoaster/tasks/<id>/scrollback.ans instead (§5.1).
    name: "003_v2_tasks",
    up(db) {
      // IF NOT EXISTS for the same reason addColumn checks first: a database
      // whose applied_migrations row went missing must not wedge the daemon on
      // "table tasks already exists" at every boot.
      db.run(`
        CREATE TABLE IF NOT EXISTS tasks (
          id                    TEXT PRIMARY KEY,
          project_id            TEXT NOT NULL REFERENCES projects(id),
          title                 TEXT NOT NULL,
          title_source          TEXT NOT NULL,
          initial_prompt        TEXT NOT NULL,
          repo_root             TEXT NOT NULL,
          cwd                   TEXT NOT NULL,
          worktree_path         TEXT,
          branch                TEXT,
          base_ref              TEXT,
          worktree_state        TEXT NOT NULL,
          wip_ref               TEXT,
          wip_at                INTEGER,
          setup_duration_ms     INTEGER,
          pinned                INTEGER NOT NULL DEFAULT 0,
          agent_session_id      TEXT,
          transcript_path       TEXT,
          agent_state           TEXT NOT NULL,
          lifecycle             TEXT NOT NULL,
          last_message          TEXT,
          last_size_cols        INTEGER,
          last_size_rows        INTEGER,
          model                 TEXT,
          permission_mode       TEXT,
          created_at            INTEGER NOT NULL,
          last_active_at        INTEGER NOT NULL,
          idle_since            INTEGER,
          exit_code             INTEGER
        )
      `);
      // The task list is ordered by recency and nothing else, so this is the
      // one index it needs.
      db.run(`CREATE INDEX IF NOT EXISTS tasks_by_recency ON tasks(last_active_at DESC)`);
    },
  },
  {
    // Per-project defaults a new task inherits (§5.1).
    name: "004_project_task_defaults",
    up(db) {
      addColumn(db, "projects", "default_base_ref", "TEXT");
      addColumn(db, "projects", "default_model", "TEXT");
      addColumn(db, "projects", "default_permission_mode", "TEXT");
      addColumn(db, "projects", "worktree_default", "INTEGER NOT NULL DEFAULT 0");
      addColumn(db, "projects", "setup_command", "TEXT");
      addColumn(db, "projects", "worktree_copy", "TEXT");
    },
  },
  {
    // repo_root started NOT NULL, which left a task outside any repository
    // nothing honest to store: the cwd stood in for a root and read as one
    // right up until every git command inside it failed. SQLite cannot drop a
    // NOT NULL in place, so the table is rebuilt — cheap, since the only rows
    // that can exist are a developer's.
    name: "005_tasks_repo_root_nullable",
    up(db) {
      const columns = db.query(`PRAGMA table_info(tasks)`).all() as
        { name: string; notnull: number }[];
      const repoRoot = columns.find((c) => c.name === "repo_root");
      if (!repoRoot || repoRoot.notnull === 0) return;

      db.run(`
        CREATE TABLE tasks_new (
          id                    TEXT PRIMARY KEY,
          project_id            TEXT NOT NULL REFERENCES projects(id),
          title                 TEXT NOT NULL,
          title_source          TEXT NOT NULL,
          initial_prompt        TEXT NOT NULL,
          repo_root             TEXT,
          cwd                   TEXT NOT NULL,
          worktree_path         TEXT,
          branch                TEXT,
          base_ref              TEXT,
          worktree_state        TEXT NOT NULL,
          wip_ref               TEXT,
          wip_at                INTEGER,
          setup_duration_ms     INTEGER,
          pinned                INTEGER NOT NULL DEFAULT 0,
          agent_session_id      TEXT,
          transcript_path       TEXT,
          agent_state           TEXT NOT NULL,
          lifecycle             TEXT NOT NULL,
          last_message          TEXT,
          last_size_cols        INTEGER,
          last_size_rows        INTEGER,
          model                 TEXT, permission_mode TEXT,
          created_at            INTEGER NOT NULL,
          last_active_at        INTEGER NOT NULL,
          idle_since            INTEGER,
          exit_code             INTEGER
        )
      `);
      // NULLIF because the pre-migration code recorded "no repository" as an
      // empty string for exactly as long as this column was NOT NULL.
      db.run(`
        INSERT INTO tasks_new
        SELECT id, project_id, title, title_source, initial_prompt,
               NULLIF(repo_root, ''), cwd, worktree_path, branch, base_ref,
               worktree_state, wip_ref, wip_at, setup_duration_ms, pinned,
               agent_session_id, transcript_path, agent_state, lifecycle,
               last_message, last_size_cols, last_size_rows, model,
               permission_mode, created_at, last_active_at, idle_since, exit_code
        FROM tasks
      `);
      db.run(`DROP TABLE tasks`);
      db.run(`ALTER TABLE tasks_new RENAME TO tasks`);
      // The index went with the old table.
      db.run(`CREATE INDEX IF NOT EXISTS tasks_by_recency ON tasks(last_active_at DESC)`);
    },
  },
  {
    // A task's own handle on its repository (TASK-64). Everything worktree
    // resolved the repository through the *project*, so deleting one — which
    // reassigns its tasks to General, whose path is empty — left a task that
    // could neither be reopened nor evicted.
    //
    // No backfill here. `projects.initial_path` is stored as the user typed it
    // and may begin with `~`, while every value written from now on is a
    // resolved absolute root, and two shapes in one column is worse than a
    // null: the readers heal a null on first touch, and `deleteProject` stamps
    // one on the way out, which is the event that actually strands a task.
    //
    // After 005 and not before it, which took a failing suite to notice: 005
    // rebuilds `tasks` from an explicit column list, so a column added ahead of
    // it exists only until that rebuild fires — which it does on any database
    // young enough to still have `repo_root NOT NULL`.
    name: "006_tasks_worktree_repo",
    up(db) {
      addColumn(db, "tasks", "worktree_repo", "TEXT");
    },
  },
  {
    // Where the task works inside its checkout (TASK-65): a project may point
    // below the repository's toplevel, and a worktree is a checkout of the
    // whole repository, so the offset is what puts the agent — and the
    // `worktree_copy` files — in the directory the user actually chose.
    //
    // No backfill, and none is needed: every existing worktree task ran at the
    // toplevel, which is what a NULL read as `''` says.
    //
    // After 006 for the reason 006 is after 005: 005 rebuilds `tasks` from an
    // explicit column list, so a column added ahead of it exists only until
    // that rebuild fires.
    name: "007_tasks_worktree_subdir",
    up(db) {
      addColumn(db, "tasks", "worktree_subdir", "TEXT");
    },
  },
];

// ALTER TABLE ADD COLUMN is not idempotent, and applied_migrations is the only
// thing standing between this and a second run. That record is written in the
// same transaction as the migration, so it cannot drift in normal operation —
// but a database restored from a backup taken mid-write, or hand-edited, would
// otherwise wedge the daemon at startup over a column that is already there.
function addColumn(db: Database, table: string, column: string, ddl: string): void {
  const columns = db.query(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (columns.some((c) => c.name === column)) return;
  db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}

let db: Database | null = null;

function getDb(): Database {
  if (!db) throw new Error("Database not initialized. Call initDatabase() first.");
  return db;
}

/** The shared handle, for stores that take their own database rather than
 * going through the helpers here. */
export function getDatabase(): Database {
  return getDb();
}

// Bring a database up to the current schema. Split out from initDatabase so it
// can be driven against a database that isn't the process-wide singleton —
// which is the only way to test the upgrade path from a v1 file.
export function applyMigrations(target: Database): void {
  // Bootstrap migrations table
  target.run(`
    CREATE TABLE IF NOT EXISTS applied_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  // Get already applied migrations
  const applied = new Set(
    target.query("SELECT name FROM applied_migrations").all().map((r: any) => r.name as string)
  );

  // Run unapplied migrations in order
  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;
    target.transaction(() => {
      migration.up(target);
      target.run("INSERT INTO applied_migrations (name, applied_at) VALUES (?, ?)", [
        migration.name,
        new Date().toISOString(),
      ]);
    })();
  }
}

export function initDatabase(dbPath: string): void {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  // Re-initializing would otherwise strand the previous handle and its WAL
  // with no way to reach them again.
  db?.close(false);
  db = new Database(dbPath);
  db.run("PRAGMA journal_mode = WAL");
  applyMigrations(db);
}

// Each of these takes the database to act on, defaulting to the process-wide
// one. A caller holding its own handle — a test, or a manager built against a
// specific file — must not read projects out of one database and tasks out of
// another.
export function getAllProjects(database: Database = getDb()): ProjectRow[] {
  return database.query("SELECT * FROM projects ORDER BY sort_order").all() as ProjectRow[];
}

// Every column an update is allowed to name. The SET clause is built from
// caller-supplied keys, and a key reaches SQL as an identifier, not a bound
// parameter — so it is checked against this set rather than trusted. The type
// says as much at compile time; this is what holds at runtime, where the
// object may have come off the wire.
const UPDATABLE_PROJECT_COLUMNS: ReadonlySet<string> = new Set([
  "name", "initial_path", "sort_order", "default_base_ref", "default_model",
  "default_permission_mode", "setup_command", "worktree_copy", "worktree_default",
]);

// An insert may name everything an update may, plus the id it is being given.
const INSERTABLE_PROJECT_COLUMNS: ReadonlySet<string> = new Set([
  "id",
  ...UPDATABLE_PROJECT_COLUMNS,
]);

/** The identity columns, and optionally any default the project is created
 * with. The defaults were once always set afterwards through `updateProject`;
 * they are writable here so a project can be created already configured
 * without a second write and a second broadcast (TASK-81). */
export type NewProject = Pick<ProjectRow, "id" | "name" | "initial_path" | "sort_order"> &
  Partial<Omit<ProjectRow, "id" | "name" | "initial_path" | "sort_order">>;

export function createProject(project: NewProject, database: Database = getDb()): void {
  // Built from the caller's keys rather than a fixed list, for the same reason
  // `updateProject` is — and checked against the same kind of allowlist, since
  // a column name reaches SQL as an identifier and cannot be bound.
  const columns: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(project)) {
    if (value === undefined) continue;
    if (!INSERTABLE_PROJECT_COLUMNS.has(key)) {
      throw new Error(`Not an insertable project column: ${key}`);
    }
    columns.push(key);
    values.push(value);
  }
  database.run(
    `INSERT INTO projects (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    values as any,
  );
}

export function updateProject(id: string, fields: Partial<Omit<ProjectRow, "id">>, database: Database = getDb()): void {
  const sets: string[] = [];
  const values: any[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (!UPDATABLE_PROJECT_COLUMNS.has(key)) {
      throw new Error(`Not an updatable project column: ${key}`);
    }
    sets.push(`${key} = ?`);
    values.push(value);
  }
  if (sets.length === 0) return;
  values.push(id);
  database.run(`UPDATE projects SET ${sets.join(", ")} WHERE id = ?`, values);
}

export function deleteProject(id: string, database: Database = getDb()): void {
  database.run("DELETE FROM projects WHERE id = ?", [id]);
}

export function updateProjectOrder(
  projects: { id: string; sort_order: number }[],
  database: Database = getDb(),
): void {
  const stmt = database.prepare("UPDATE projects SET sort_order = ? WHERE id = ?");
  const runAll = database.transaction(() => {
    for (const p of projects) {
      stmt.run(p.sort_order, p.id);
    }
  });
  runAll();
}

