import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { initDatabase, getDatabase } from "../lib/db";
import { TaskStore } from "../lib/tasks/store";
import { taskManager } from "../lib/tasks/manager";
import { backlogRoutes } from "./backlog";

// Driven through a real Bun.serve so the params, status codes and JSON bodies
// under test are the ones a client actually gets. Every row here is a row and
// nothing else — no process, which is the case the route has to answer for.
let server: ReturnType<typeof Bun.serve>;
let base: string;
let dbDir: string;
let store: TaskStore;
const dirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-backlog-api-"));
  dirs.push(dir);
  return dir;
}

function row(id: string, overrides: Partial<Parameters<TaskStore["create"]>[0]> = {}) {
  return store.create({
    id,
    project_id: "general",
    title: id,
    initial_prompt: "",
    repo_root: "/repo",
    cwd: "/repo",
    ...overrides,
  });
}

beforeAll(() => {
  dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-backlogroutes-"));
  initDatabase(path.join(dbDir, "codetoaster.db"));
  store = new TaskStore(getDatabase());
  taskManager.loadProjects();
  server = Bun.serve({ port: 0, routes: backlogRoutes as any, fetch: () => new Response("", { status: 404 }) });
  base = `http://localhost:${server.port}`;
});

afterAll(() => {
  server.stop(true);
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(dbDir, { recursive: true, force: true });
});

function get(id: string) {
  return fetch(`${base}/api/tasks/${id}/backlog`);
}

describe("GET /api/tasks/:id/backlog", () => {
  test("a repository with no backlog answers detected: false, not an error", async () => {
    row("plain", { repo_root: tempDir(), cwd: "/repo" });
    const res = await get("plain");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ detected: false });
  });

  // The route turns resolveTaskRoot's 400 into an answer: "this task has no
  // backlog" is exactly what a task outside a repository means to the client.
  test("a task with no repository answers detected: false with a 200", async () => {
    row("rootless", { repo_root: null, cwd: os.tmpdir() });
    const res = await get("rootless");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ detected: false });
  });

  test("an unknown task is still a 404", async () => {
    const res = await get("nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Task not found" });
  });

  test("a Backlog.md repository answers its prefix, statuses and tasks", async () => {
    const repoRoot = tempDir();
    fs.mkdirSync(path.join(repoRoot, "backlog", "tasks"), { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, "backlog", "config.yml"),
      `statuses: ["To Do", "In Progress", "Done"]\ntask_prefix: "task"\n`
    );
    fs.writeFileSync(
      path.join(repoRoot, "backlog", "tasks", "task-1 - First.md"),
      `---\nid: TASK-1\ntitle: First\nstatus: To Do\nordinal: 1000\n---\n\nBody.\n`
    );
    row("backlogged", { repo_root: repoRoot, cwd: repoRoot });

    const res = await get("backlogged");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      detected: true,
      prefix: "TASK",
      statuses: ["To Do", "In Progress", "Done"],
      tasks: [
        {
          id: "TASK-1",
          title: "First",
          status: "To Do",
          ordinal: 1000,
          priority: null,
          labels: [],
          assignee: [],
          path: "backlog/tasks/task-1 - First.md",
        },
      ],
    });
  });
});
