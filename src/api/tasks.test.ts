import { test, expect, describe, beforeAll, afterAll, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { initDatabase } from "../lib/db";
import { taskManager } from "../lib/tasks/manager";
import { taskRoutes } from "./tasks";

// Driven through a real Bun.serve, so the params, status codes and JSON bodies
// under test are the ones a client actually gets.
let server: ReturnType<typeof Bun.serve>;
let base: string;
let dbDir: string;

beforeAll(() => {
  dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-taskroutes-"));
  initDatabase(path.join(dbDir, "codetoaster.db"));
  taskManager.loadProjects();
  server = Bun.serve({ port: 0, routes: taskRoutes as any, fetch: () => new Response("", { status: 404 }) });
  base = `http://localhost:${server.port}`;
});

afterEach(async () => {
  for (const task of taskManager.listTasks()) taskManager.closeTask(task.id);
  // Killed PTYs write from onExit a tick later; let that land before the next
  // test, and before afterAll takes the database away.
  await Bun.sleep(50);
});

afterAll(() => {
  server.stop(true);
  fs.rmSync(dbDir, { recursive: true, force: true });
});

function post(body: unknown, url = "/api/tasks") {
  return fetch(`${base}${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function patch(id: string, body: unknown) {
  return fetch(`${base}/api/tasks/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/tasks", () => {
  test("creates the task and answers 201 with its info", async () => {
    const res = await post({ cols: 100, rows: 30 });
    expect(res.status).toBe(201);

    const task = await res.json();
    expect(task.id).toBeString();
    expect(task.lifecycle).toBe("live");
    expect(task.agentState).toBe("starting");
    expect(task.title.length).toBeGreaterThan(0);
    // The terminal is running and is addressed separately from the task.
    expect(task.ptyId).toBeString();
    expect(task.ptyId).not.toBe(task.id);
    expect(taskManager.primaryPty(task.id)!.id).toBe(task.ptyId);
    expect(task.size).toEqual({ cols: 100, rows: 30 });
  });

  test("records the prompt, model and permission mode on the row", async () => {
    const res = await post({
      prompt: "fix the parser\nand the tests",
      model: "opus",
      permissionMode: "acceptEdits",
      title: "Chosen",
    });
    const task = await res.json();
    const row = taskManager.getTask(task.id)!;
    // Newlines survive: the prompt is a value, not something typed at a shell.
    expect(row.initial_prompt).toBe("fix the parser\nand the tests");
    expect(row.model).toBe("opus");
    expect(row.permission_mode).toBe("acceptEdits");
    expect(row.title).toBe("Chosen");
    expect(row.title_source).toBe("manual");
  });

  test("a task with no prompt yet is allowed — the composer arrives later", async () => {
    const task = await (await post({})).json();
    expect(taskManager.getTask(task.id)!.initial_prompt).toBe("");
  });

  test("rejects a body that isn't a JSON object", async () => {
    for (const body of ["not json", "[1,2]", '"a string"']) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Expected a JSON object body");
    }
  });

  test("rejects fields of the wrong type, naming the one at fault", async () => {
    const res = await post({ title: 42 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('"title" must be a string');

    const sizes = await post({ cols: "wide" });
    expect(sizes.status).toBe(400);
    expect((await sizes.json()).error).toContain("cols");
  });

  test("rejects an unknown project rather than quietly using General", async () => {
    const res = await post({ projectId: "no-such-project" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Unknown project "no-such-project"');
  });

  test("404s when asked to sit after a task that isn't there", async () => {
    const res = await post({ afterTaskId: "no-such-task" });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Unknown task "no-such-task"');
  });

  test("a spawn failure is a 500 with a body, not a session that never appears", async () => {
    const shell = process.env.SHELL;
    process.env.SHELL = "/nonexistent/codetoaster-not-a-shell";
    try {
      const res = await post({});
      expect(res.status).toBe(500);
      expect((await res.json()).error).toBeString();
      // And nothing is left behind holding the id.
      expect(taskManager.listTasks()).toHaveLength(0);
    } finally {
      if (shell === undefined) delete process.env.SHELL;
      else process.env.SHELL = shell;
    }
  });
});

describe("PATCH /api/tasks/:id", () => {
  test("renames the task and stops deriving its title", async () => {
    const created = await (await post({})).json();
    const res = await patch(created.id, { title: "Renamed by hand" });

    expect(res.status).toBe(200);
    const task = await res.json();
    expect(task.title).toBe("Renamed by hand");
    expect(task.titleSource).toBe("manual");
    expect(taskManager.getTask(created.id)!.title_source).toBe("manual");
  });

  test("404s for a task that isn't there", async () => {
    const res = await patch("no-such-task", { title: "x" });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Task not found");
  });

  test("rejects a missing, wrongly typed, or blank title", async () => {
    const created = await (await post({})).json();
    for (const [body, message] of [
      [{}, '"title" is required'],
      [{ title: 7 }, '"title" must be a string'],
      [{ title: "   " }, '"title" cannot be blank'],
    ] as [unknown, string][]) {
      const res = await patch(created.id, body);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(message);
    }
    // The title it had is untouched by any of that.
    expect(taskManager.getTask(created.id)!.title_source).toBe("derived");
  });
});

describe("DELETE /api/tasks/:id", () => {
  test("closes the task and its terminal", async () => {
    const created = await (await post({})).json();
    const res = await fetch(`${base}/api/tasks/${created.id}`, { method: "DELETE" });

    expect(res.status).toBe(200);
    expect(taskManager.getTask(created.id)).toBeUndefined();
    expect(taskManager.getPty(created.ptyId)).toBeUndefined();
    expect((await fetch(`${base}/api/tasks/${created.id}`, { method: "DELETE" })).status).toBe(404);
  });
});

describe("GET /api/tasks", () => {
  test("lists live tasks with their directories", async () => {
    const created = await (await post({})).json();
    const list = await (await fetch(`${base}/api/tasks`)).json();
    expect(list.map((t: any) => t.id)).toEqual([created.id]);
    expect(list[0].cwd).toBe(process.cwd());
  });
});
