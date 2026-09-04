import { test, expect, describe, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { applyMigrations, initDatabase, getAllProjects, createProject } from "./db";

function columnNames(db: Database, table: string): Set<string> {
  const rows = db.query(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

function indexNames(db: Database, table: string): Set<string> {
  const rows = db.query(`PRAGMA index_list(${table})`).all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

function appliedMigrations(db: Database): string[] {
  return (db.query("SELECT name FROM applied_migrations ORDER BY name").all() as { name: string }[])
    .map((r) => r.name);
}

// The schema as v1 shipped it, written out rather than replayed from the
// migration list: the point of the upgrade test is that a database created by
// the *old* code moves forward, so it must not depend on today's definitions.
function seedV1Database(db: Database, opts: { droppedColor: boolean }): void {
  db.run(`
    CREATE TABLE applied_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      initial_path TEXT NOT NULL DEFAULT '',
      ${opts.droppedColor ? "" : "color TEXT NOT NULL DEFAULT '',"}
      sort_order INTEGER NOT NULL DEFAULT 0
    )
  `);
  db.run(`INSERT INTO projects (id, name, sort_order) VALUES ('general', 'General', 0)`);
  db.run(`INSERT INTO projects (id, name, initial_path, sort_order) VALUES ('web', 'Web', '~/src/web', 1)`);
  const applied = opts.droppedColor
    ? ["001_initial_projects", "002_drop_project_color"]
    : ["001_initial_projects"];
  for (const name of applied) {
    db.run("INSERT INTO applied_migrations (name, applied_at) VALUES (?, ?)", [name, "2026-01-01"]);
  }
}

const tempDirs: string[] = [];
function tempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-db-"));
  tempDirs.push(dir);
  return path.join(dir, "nested", "codetoaster.db");
}

afterEach(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  tempDirs.length = 0;
});

const TASK_COLUMNS = [
  "id", "project_id", "title", "title_source", "initial_prompt", "repo_root", "cwd",
  "worktree_path", "worktree_repo", "worktree_subdir", "branch", "base_ref", "worktree_state",
  "wip_ref", "wip_at",
  "setup_duration_ms", "pinned", "agent_session_id", "transcript_path", "agent_state",
  "lifecycle", "last_message", "last_size_cols", "last_size_rows", "model",
  "permission_mode", "created_at", "last_active_at", "idle_since", "exit_code",
];

const PROJECT_V2_COLUMNS = [
  "default_base_ref", "default_model", "default_permission_mode",
  "worktree_default", "setup_command", "worktree_copy",
];

describe("fresh database", () => {
  test("has the tasks table with every v2 column", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    expect([...columnNames(db, "tasks")].sort()).toEqual([...TASK_COLUMNS].sort());
  });

  test("has the recency index the task list reads through", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    expect(indexNames(db, "tasks").has("tasks_by_recency")).toBe(true);
  });

  test("projects gains the per-project task defaults", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const columns = columnNames(db, "projects");
    for (const column of PROJECT_V2_COLUMNS) expect(columns.has(column)).toBe(true);
  });

  test("worktree_default is off unless a project opts in", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const row = db.query("SELECT * FROM projects WHERE id = 'general'").get() as any;
    expect(row.worktree_default).toBe(0);
    expect(row.default_base_ref).toBeNull();
  });

  test("pinned defaults to 0 and the unset columns stay null", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.run(`
      INSERT INTO tasks (id, project_id, title, title_source, initial_prompt, repo_root, cwd,
                         worktree_state, agent_state, lifecycle, created_at, last_active_at)
      VALUES ('t1', 'general', 'Fix the parser', 'derived', 'fix the parser', '/repo', '/repo',
              'none', 'starting', 'live', 1, 1)
    `);
    const row = db.query("SELECT * FROM tasks WHERE id = 't1'").get() as any;
    expect(row.pinned).toBe(0);
    expect(row.worktree_path).toBeNull();
    // Which is what a task that predates the column reads as too: no offset,
    // so the checkout's root is where it works.
    expect(row.worktree_subdir).toBeNull();
    expect(row.exit_code).toBeNull();
  });
});

describe("upgrade from v1", () => {
  for (const droppedColor of [false, true]) {
    const label = droppedColor ? "after 002" : "still carrying the color column";
    test(`keeps every project row (${label})`, () => {
      const db = new Database(":memory:");
      seedV1Database(db, { droppedColor });
      applyMigrations(db);

      const projects = db.query("SELECT id, name, initial_path, sort_order FROM projects ORDER BY sort_order").all();
      expect(projects).toEqual([
        { id: "general", name: "General", initial_path: "", sort_order: 0 },
        { id: "web", name: "Web", initial_path: "~/src/web", sort_order: 1 },
      ]);
      expect(columnNames(db, "tasks").size).toBe(TASK_COLUMNS.length);
      for (const column of PROJECT_V2_COLUMNS) {
        expect(columnNames(db, "projects").has(column)).toBe(true);
      }
    });
  }

  test("re-running the migrations changes nothing", () => {
    const db = new Database(":memory:");
    seedV1Database(db, { droppedColor: true });
    applyMigrations(db);
    const before = appliedMigrations(db);

    applyMigrations(db);
    applyMigrations(db);

    expect(appliedMigrations(db)).toEqual(before);
    expect(db.query("SELECT COUNT(*) AS n FROM projects").get()).toEqual({ n: 2 });
  });

  // The applied_migrations row and the migration share a transaction, so this
  // cannot happen in normal operation — but a hand-edited or half-restored
  // database must not wedge the daemon on `duplicate column name`.
  test("a lost migration record does not make ADD COLUMN throw", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.run("DELETE FROM applied_migrations WHERE name = '004_project_task_defaults'");

    expect(() => applyMigrations(db)).not.toThrow();
    for (const column of PROJECT_V2_COLUMNS) {
      expect(columnNames(db, "projects").has(column)).toBe(true);
    }
  });

  test("a lost migration record does not make CREATE TABLE throw", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.run("DELETE FROM applied_migrations WHERE name = '003_v2_tasks'");

    expect(() => applyMigrations(db)).not.toThrow();
    expect(columnNames(db, "tasks").size).toBe(TASK_COLUMNS.length);
    expect(indexNames(db, "tasks").has("tasks_by_recency")).toBe(true);
  });

  // The oldest migration is the one most likely to be missing from a
  // hand-edited applied_migrations, and it is the only one that creates a
  // table *and* seeds a row — so it has two ways to wedge the daemon, not one.
  test("a lost migration record does not make the first migration throw", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.run("INSERT INTO projects (id, name, sort_order) VALUES ('web', 'Web', 1)");
    db.run("DELETE FROM applied_migrations WHERE name = '001_initial_projects'");

    expect(() => applyMigrations(db)).not.toThrow();
    // Re-running it must not duplicate or clobber what is already there.
    expect(db.query("SELECT id FROM projects ORDER BY sort_order").all())
      .toEqual([{ id: "general" }, { id: "web" }]);
  });
});

describe("005_tasks_repo_root_nullable", () => {
  function columnIsNullable(db: Database, table: string, column: string): boolean {
    const rows = db.query(`PRAGMA table_info(${table})`).all() as
      { name: string; notnull: number }[];
    return rows.find((r) => r.name === column)!.notnull === 0;
  }

  test("repo_root ends up nullable, and every other column survives the rebuild", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    expect(columnIsNullable(db, "tasks", "repo_root")).toBe(true);
    expect([...columnNames(db, "tasks")].sort()).toEqual([...TASK_COLUMNS].sort());
    expect(indexNames(db, "tasks").has("tasks_by_recency")).toBe(true);
  });

  test("a task with no repository can say so", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.run(`
      INSERT INTO tasks (id, project_id, title, title_source, initial_prompt, cwd,
                         worktree_state, agent_state, lifecycle, created_at, last_active_at)
      VALUES ('t1', 'general', 'Loose', 'derived', '', '/tmp', 'none', 'starting', 'live', 1, 1)
    `);
    expect((db.query("SELECT repo_root FROM tasks WHERE id = 't1'").get() as any).repo_root)
      .toBeNull();
  });

  // The rebuild has to carry rows across, including the empty string the
  // NOT NULL column forced on tasks that were not in a repository.
  test("rows written before the rebuild come across, with '' folded to NULL", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.run("DELETE FROM applied_migrations WHERE name = '005_tasks_repo_root_nullable'");
    // Put the old shape back, so this is a genuine upgrade rather than a re-run.
    db.run("DROP TABLE tasks");
    db.run(`
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL,
        title_source TEXT NOT NULL, initial_prompt TEXT NOT NULL,
        repo_root TEXT NOT NULL, cwd TEXT NOT NULL, worktree_path TEXT, branch TEXT,
        base_ref TEXT, worktree_state TEXT NOT NULL, wip_ref TEXT, wip_at INTEGER,
        setup_duration_ms INTEGER, pinned INTEGER NOT NULL DEFAULT 0,
        agent_session_id TEXT, transcript_path TEXT, agent_state TEXT NOT NULL,
        lifecycle TEXT NOT NULL, last_message TEXT, last_size_cols INTEGER,
        last_size_rows INTEGER, model TEXT, permission_mode TEXT,
        created_at INTEGER NOT NULL, last_active_at INTEGER NOT NULL,
        idle_since INTEGER, exit_code INTEGER
      )
    `);
    const insert = `INSERT INTO tasks (id, project_id, title, title_source, initial_prompt,
      repo_root, cwd, worktree_state, agent_state, lifecycle, created_at, last_active_at)
      VALUES (?, 'general', ?, 'derived', '', ?, '/dir', 'none', 'idle', 'suspended', 1, ?)`;
    db.run(insert, ["in-repo", "Has a repo", "/repo", 200]);
    db.run(insert, ["loose", "Has none", "", 100]);

    applyMigrations(db);

    expect(columnIsNullable(db, "tasks", "repo_root")).toBe(true);
    expect(db.query("SELECT id, repo_root FROM tasks ORDER BY last_active_at DESC").all())
      .toEqual([
        { id: "in-repo", repo_root: "/repo" },
        { id: "loose", repo_root: null },
      ]);
    expect(indexNames(db, "tasks").has("tasks_by_recency")).toBe(true);
  });

  test("re-running it over an already-nullable column does nothing", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.run(`
      INSERT INTO tasks (id, project_id, title, title_source, initial_prompt, repo_root, cwd,
                         worktree_state, agent_state, lifecycle, created_at, last_active_at)
      VALUES ('t1', 'general', 'Kept', 'derived', '', '/repo', '/repo', 'none', 'idle', 'live', 1, 1)
    `);
    db.run("DELETE FROM applied_migrations WHERE name = '005_tasks_repo_root_nullable'");

    expect(() => applyMigrations(db)).not.toThrow();
    expect(db.query("SELECT COUNT(*) AS n FROM tasks").get()).toEqual({ n: 1 });
  });
});

describe("initDatabase", () => {
  test("creates the directory, migrates, and is idempotent across opens", () => {
    const dbPath = tempDbPath();

    initDatabase(dbPath);
    createProject({ id: "web", name: "Web", initial_path: "~/src/web", sort_order: 1 });
    expect(getAllProjects().map((p) => p.id)).toEqual(["general", "web"]);

    initDatabase(dbPath);
    expect(getAllProjects().map((p) => p.id)).toEqual(["general", "web"]);

    const db = new Database(dbPath);
    expect(columnNames(db, "tasks").size).toBe(TASK_COLUMNS.length);
    expect(appliedMigrations(db)).toEqual([
      "001_initial_projects",
      "002_drop_project_color",
      "003_v2_tasks",
      "004_project_task_defaults",
      "005_tasks_repo_root_nullable",
      "006_tasks_worktree_repo",
      "007_tasks_worktree_subdir",
    ]);
    db.close();
  });
});
