import { test, expect, describe, beforeAll, afterAll, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { initDatabase } from "../lib/db";
import { taskManager } from "../lib/tasks/manager";
import { taskRoutes } from "./tasks";
import { taskDir, taskScrollbackPath, taskSettingsPath } from "../lib/agent/spawn";
import { writeSnapshot } from "../lib/tasks/snapshot";

// Driven through a real Bun.serve, so the params, status codes and JSON bodies
// under test are the ones a client actually gets.
let server: ReturnType<typeof Bun.serve>;
let base: string;
let dbDir: string;

// A task now starts its agent, and these tests create a lot of them. The
// stand-in has to *ignore* the argv a real agent is given and then sit there:
// `cat` alone exits at once on `cat: illegal option -- -`, which would leave
// every route test asserting against a task whose terminal had already died
// (`agentState` flips to "exited" from the exit callback). A one-line script
// keeps the process alive until it is killed, and keeps the suite from
// starting real Claude Code sessions, each with a transcript on disk.
let previousAgentBin: string | undefined;

beforeAll(() => {
  previousAgentBin = process.env.CODETOASTER_AGENT_BIN;
  dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-taskroutes-"));
  const agentBin = path.join(dbDir, "fake-agent");
  fs.writeFileSync(agentBin, "#!/bin/sh\nexec cat\n", { mode: 0o755 });
  process.env.CODETOASTER_AGENT_BIN = agentBin;
  initDatabase(path.join(dbDir, "codetoaster.db"));
  taskManager.loadProjects();
  server = Bun.serve({ port: 0, routes: taskRoutes as any, fetch: () => new Response("", { status: 404 }) });
  base = `http://localhost:${server.port}`;
});

afterEach(async () => {
  // `deleteTask`, not `closeTask`: close is a suspend now, and a suspended row
  // stays in `listTasks` — cleaning up with it would leave every task of every
  // test in the next test's list.
  for (const task of taskManager.listTasks()) taskManager.deleteTask(task.id);
  // Deleting a task deliberately leaves its settings directory alone — that is
  // archive's to remove (TASK-31) — and a test that deleted its own task is
  // already gone from listTasks. So cleanup runs off what was created, not off
  // what is still live.
  for (const id of created.splice(0)) {
    fs.rmSync(taskDir(id), { recursive: true, force: true });
  }
  // Killed PTYs write from onExit a tick later; let that land before the next
  // test, and before afterAll takes the database away.
  await Bun.sleep(50);
});

afterAll(() => {
  if (previousAgentBin === undefined) delete process.env.CODETOASTER_AGENT_BIN;
  else process.env.CODETOASTER_AGENT_BIN = previousAgentBin;
  server.stop(true);
  fs.rmSync(dbDir, { recursive: true, force: true });
});

// Every task id the route handed back, so afterEach can clear the directories
// they left in ~/.codetoaster/tasks.
const created: string[] = [];

async function post(body: unknown, url = "/api/tasks") {
  const res = await fetch(`${base}${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  if (res.status === 201) {
    // Read off a clone: the caller still gets an unconsumed body.
    const task = await res.clone().json();
    if (typeof task?.id === "string") created.push(task.id);
  }
  return res;
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
    const bin = process.env.CODETOASTER_AGENT_BIN;
    process.env.CODETOASTER_AGENT_BIN = "/nonexistent/codetoaster-not-an-agent";
    try {
      const res = await post({});
      expect(res.status).toBe(500);
      expect((await res.json()).error).toBeString();
      // And nothing is left behind holding the id.
      expect(taskManager.listTasks()).toHaveLength(0);
    } finally {
      if (bin === undefined) delete process.env.CODETOASTER_AGENT_BIN;
      else process.env.CODETOASTER_AGENT_BIN = bin;
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

// The two doors, and the whole of what separates them: §6 makes the close
// button a suspend, and leaves `DELETE` as the interim archive.
describe("POST /api/tasks/:id/close", () => {
  test("suspends the task and kills its terminal, without deleting anything", async () => {
    const created = await (await post({})).json();
    // Typed into the terminal so that there is a screen to save: the stand-in
    // agent is `exec cat`, which paints nothing of its own, and a screen with
    // nothing on it is nothing to snapshot — closing before the first paint
    // leaves whatever snapshot the task already had rather than blanking it.
    const pty = taskManager.getPty(created.ptyId)!;
    pty.write("something on the screen\r");
    for (let i = 0; i < 200 && !pty.serialize().includes("something on the screen"); i++) {
      await Bun.sleep(10);
    }

    const res = await fetch(`${base}/api/tasks/${created.id}/close`, { method: "POST" });

    expect(res.status).toBe(200);
    expect((await res.json()).lifecycle).toBe("suspended");
    expect(taskManager.getTask(created.id)).toBeDefined();
    expect(taskManager.getPty(created.ptyId)).toBeUndefined();
    // What reopening the task is built out of (AC #5).
    expect(fs.existsSync(taskSettingsPath(created.id))).toBe(true);
    expect(fs.existsSync(taskScrollbackPath(created.id))).toBe(true);
  });

  test("closing an already closed task is not an error", async () => {
    const created = await (await post({})).json();
    await fetch(`${base}/api/tasks/${created.id}/close`, { method: "POST" });
    const res = await fetch(`${base}/api/tasks/${created.id}/close`, { method: "POST" });

    expect(res.status).toBe(200);
    expect((await res.json()).lifecycle).toBe("suspended");
  });

  test("404s for a task that isn't there", async () => {
    const res = await fetch(`${base}/api/tasks/no-such-task/close`, { method: "POST" });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Unknown task "no-such-task"');
  });
});

// The first half of the two-phase reopen (§5.5): what the client paints before
// the resumed agent exists.
describe("GET /api/tasks/:id/scrollback", () => {
  function scrollback(id: string) {
    return fetch(`${base}/api/tasks/${id}/scrollback`);
  }

  test("answers the stored screen and the grid it was taken at", async () => {
    const created = await (await post({ cols: 100, rows: 30 })).json();
    // The stand-in agent echoes, so this is the closest thing to a screen the
    // task can be given: what the snapshot has to come back holding.
    taskManager.primaryPty(created.id)!.write("left off here\r");
    await Bun.sleep(100);
    await fetch(`${base}/api/tasks/${created.id}/close`, { method: "POST" });

    const res = await scrollback(created.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toContain("left off here");
    expect(body.size).toEqual({ cols: 100, rows: 30 });
  });

  test("a task with no stored screen answers data: null, not an error", async () => {
    const created = await (await post({})).json();
    const res = await scrollback(created.id);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: null, size: null });
  });

  test("404s for a task that isn't there — which is not the same answer", async () => {
    const res = await scrollback("no-such-task");
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Unknown task "no-such-task"');
  });

  test("a snapshot with no remembered size answers size: null", async () => {
    // A task never closed has no `last_size_*` on its row, so writing a
    // snapshot behind its back is the state a pre-TASK-14 suspension leaves:
    // a screen, and nothing saying what grid it was taken at. The client paints
    // it at its own measured size rather than a fabricated one.
    const created = await (await post({})).json();
    await writeSnapshot(created.id, "an old screen");

    const body = await (await scrollback(created.id)).json();
    expect(body.data).toBe("an old screen");
    expect(body.size).toBeNull();
  });
});

describe("DELETE /api/tasks/:id", () => {
  test("deletes the task and its terminal outright", async () => {
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
