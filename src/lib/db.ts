import { Database } from "bun:sqlite";
import * as fs from "fs";
import * as path from "path";

export interface ProjectRow {
  id: string;
  name: string;
  initial_path: string;
  color: string;
  sort_order: number;
}

interface Migration {
  name: string;
  up(db: Database): void;
}

const migrations: Migration[] = [
  {
    name: "001_initial_projects",
    up(db) {
      db.run(`
        CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          initial_path TEXT NOT NULL DEFAULT '',
          color TEXT NOT NULL DEFAULT '',
          sort_order INTEGER NOT NULL DEFAULT 0
        )
      `);
      db.run(`INSERT INTO projects (id, name, sort_order) VALUES ('general', 'General', 0)`);
    },
  },
];

let db: Database | null = null;

function getDb(): Database {
  if (!db) throw new Error("Database not initialized. Call initDatabase() first.");
  return db;
}

export function initDatabase(dbPath: string): void {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  db = new Database(dbPath);
  db.run("PRAGMA journal_mode = WAL");

  // Bootstrap migrations table
  db.run(`
    CREATE TABLE IF NOT EXISTS applied_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  // Get already applied migrations
  const applied = new Set(
    db.query("SELECT name FROM applied_migrations").all().map((r: any) => r.name as string)
  );

  // Run unapplied migrations in order
  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;
    db.transaction(() => {
      migration.up(db!);
      db!.run("INSERT INTO applied_migrations (name, applied_at) VALUES (?, ?)", [
        migration.name,
        new Date().toISOString(),
      ]);
    })();
  }
}

export function getAllProjects(): ProjectRow[] {
  return getDb().query("SELECT * FROM projects ORDER BY sort_order").all() as ProjectRow[];
}

export function getProject(id: string): ProjectRow | null {
  return (getDb().query("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow) ?? null;
}

export function createProject(project: ProjectRow): void {
  getDb().run(
    "INSERT INTO projects (id, name, initial_path, color, sort_order) VALUES (?, ?, ?, ?, ?)",
    [project.id, project.name, project.initial_path, project.color, project.sort_order],
  );
}

export function updateProject(id: string, fields: Partial<Omit<ProjectRow, "id">>): void {
  const sets: string[] = [];
  const values: any[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      sets.push(`${key} = ?`);
      values.push(value);
    }
  }
  if (sets.length === 0) return;
  values.push(id);
  getDb().run(`UPDATE projects SET ${sets.join(", ")} WHERE id = ?`, values);
}

export function deleteProject(id: string): void {
  getDb().run("DELETE FROM projects WHERE id = ?", [id]);
}

export function updateProjectOrder(projects: { id: string; sort_order: number }[]): void {
  const stmt = getDb().prepare("UPDATE projects SET sort_order = ? WHERE id = ?");
  const runAll = getDb().transaction(() => {
    for (const p of projects) {
      stmt.run(p.sort_order, p.id);
    }
  });
  runAll();
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
