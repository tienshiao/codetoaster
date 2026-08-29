import { test, expect, describe, beforeAll, afterAll, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { ServerWebSocket } from "bun";
import { initDatabase } from "../lib/db";
import { taskManager } from "../lib/tasks/manager";
import { hookRoutes } from "./hooks";
import type { ServerMessage, WebSocketData } from "../lib/xtmux/types";

let server: ReturnType<typeof Bun.serve>;
let base: string;
let dbDir: string;

beforeAll(() => {
  dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-hooks-"));
  initDatabase(path.join(dbDir, "codetoaster.db"));
  taskManager.loadProjects();
  server = Bun.serve({ port: 0, routes: hookRoutes as any, fetch: () => new Response("", { status: 404 }) });
  base = `http://localhost:${server.port}`;
});

afterEach(async () => {
  for (const task of taskManager.listTasks()) taskManager.deleteTask(task.id);
  await Bun.sleep(50);
});

afterAll(() => {
  server.stop(true);
  fs.rmSync(dbDir, { recursive: true, force: true });
});

/** A task with a plain command, so these tests never start an agent — the
 * route under test does not care what the PTY is running. */
async function task(id: string) {
  await taskManager.createTask({ id, command: [process.env.SHELL || "bash"] });
  return id;
}

function hook(id: string, body: unknown) {
  return fetch(`${base}/api/tasks/${id}/hook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** A client socket that records what the server pushed to it. */
function listen(clientId = "c1") {
  const received: ServerMessage[] = [];
  const ws = {
    send: (data: string) => { received.push(JSON.parse(data)); },
  } as unknown as ServerWebSocket<WebSocketData>;
  taskManager.registerClient(clientId, ws);
  return {
    stop: () => taskManager.unregisterClient(clientId),
    tasks: () => received.filter((m) => m.type === "task") as any[],
  };
}

describe("POST /api/tasks/:id/hook", () => {
  test("Stop moves the row and pushes the delta", async () => {
    const id = await task("t-stop");
    const client = listen();
    try {
      const res = await hook(id, {
        session_id: "1fc1",
        hook_event_name: "Stop",
        last_assistant_message: "pong",
      });

      expect(res.status).toBe(200);
      const row = taskManager.getTask(id)!;
      expect(row.agent_state).toBe("idle");
      expect(row.last_message).toBe("pong");
      expect(row.idle_since).toBeGreaterThan(0);

      // One row changed, so one row is sent — not the whole list.
      const pushed = client.tasks();
      expect(pushed).toHaveLength(1);
      expect(pushed[0].task.id).toBe(id);
      expect(pushed[0].task.agentState).toBe("idle");
    } finally {
      client.stop();
    }
  });

  test("SessionStart records the conversation id and brings the task live", async () => {
    const id = await task("t-start");
    await hook(id, {
      hook_event_name: "SessionStart",
      source: "startup",
      session_id: "sid-1",
      transcript_path: "/tmp/sid-1.jsonl",
    });

    const row = taskManager.getTask(id)!;
    expect(row.agent_session_id).toBe("sid-1");
    expect(row.transcript_path).toBe("/tmp/sid-1.jsonl");
    expect(row.lifecycle).toBe("live");
    expect(row.agent_state).toBe("idle");
  });

  test("a /clear swaps the conversation id without touching the task", async () => {
    const id = await task("t-clear");
    await hook(id, { hook_event_name: "SessionStart", source: "startup", session_id: "first" });
    await hook(id, { hook_event_name: "SessionEnd", reason: "clear" });
    await hook(id, { hook_event_name: "SessionStart", source: "clear", session_id: "second" });

    const row = taskManager.getTask(id)!;
    expect(row.agent_session_id).toBe("second");
    // The SessionEnd in the middle must not have marked it dead.
    expect(row.agent_state).toBe("idle");
    expect(taskManager.listTasks().filter((t) => t.id === id)).toHaveLength(1);
  });

  // A hook reports its failures into the agent's own transcript, so there is
  // nothing this route can usefully say by failing.
  test("an unknown task is accepted and changes nothing", async () => {
    const res = await hook("no-such-task", { hook_event_name: "Stop" });
    expect(res.status).toBe(204);
  });

  test("an event we do not map is accepted and changes nothing", async () => {
    const id = await task("t-unmapped");
    const before = taskManager.getTask(id)!;

    const res = await hook(id, { hook_event_name: "PreToolUse", tool_name: "Bash" });

    expect(res.status).toBe(204);
    expect(taskManager.getTask(id)).toEqual(before);
  });

  test("a body that is not a payload is accepted and changes nothing", async () => {
    const id = await task("t-junk");
    const before = taskManager.getTask(id)!;

    for (const body of ["not json at all", "[1,2,3]", '"a string"', "null"]) {
      expect((await hook(id, body)).status).toBe(204);
    }
    expect(taskManager.getTask(id)).toEqual(before);
  });
});
