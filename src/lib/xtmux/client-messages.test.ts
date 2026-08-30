import { test, expect, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import * as fs from "fs";
import type { ServerWebSocket } from "bun";
import { applyMigrations } from "../db";
import { taskDir } from "../agent/spawn";
import { TaskManager } from "../tasks/manager";
import { handleClientMessage } from "./client-messages";
import type { ClientMessage, ServerMessage, WebSocketData } from "./types";

const managers: TaskManager[] = [];

function newManager(): TaskManager {
  const db = new Database(":memory:");
  applyMigrations(db);
  const manager = new TaskManager(db);
  managers.push(manager);
  return manager;
}

afterEach(() => {
  for (const m of managers) {
    for (const task of m.listTasks()) {
      m.deleteTask(task.id);
      // `deleteTask` leaves `~/.codetoaster/tasks/<id>/` standing on purpose —
      // that is archive's to clean up — but a test that made a real task should
      // not leave one under the user's home either.
      fs.rmSync(taskDir(task.id), { recursive: true, force: true });
    }
  }
  managers.length = 0;
});

/** A client socket that records what the server said back to it. */
function fakeClient(clientId = "c1") {
  const received: ServerMessage[] = [];
  const ws = {
    data: { clientId },
    send: (data: string) => {
      received.push(JSON.parse(data));
    },
  } as unknown as ServerWebSocket<WebSocketData>;
  return { ws, received, errors: () => received.filter((m) => m.type === "error") };
}

/** What the one error the server sent looks like. Fails loudly on none or several,
 * because "no error at all" and "the wrong error" are different bugs. */
function soleError(received: ServerMessage[]): Extract<ServerMessage, { type: "error" }> {
  const errors = received.filter((m) => m.type === "error");
  expect(errors).toHaveLength(1);
  return errors[0] as Extract<ServerMessage, { type: "error" }>;
}

function send(manager: TaskManager, client: ReturnType<typeof fakeClient>, message: ClientMessage) {
  handleClientMessage(manager, client.ws, JSON.stringify(message));
}

// ── addressed refusals (TASK-49 AC #1) ──────────────────────────────────────

test("a refused attach names the terminal that was asked for", () => {
  const manager = newManager();
  const client = fakeClient();

  // What a client sends after a daemon restart: a ptyId it remembers, which
  // no longer exists.
  send(manager, client, { type: "attach", ptyId: "pty-gone", cols: 80, rows: 24 });

  const error = soleError(client.received);
  expect(error.ptyId).toBe("pty-gone");
  expect(error.message).toContain("pty-gone");
});

test("a keystroke to a terminal this client does not hold names that terminal", () => {
  const manager = newManager();
  const client = fakeClient();

  send(manager, client, { type: "input", ptyId: "pty-a", data: "ls\r" });

  const error = soleError(client.received);
  expect(error.ptyId).toBe("pty-a");
});

test("each refusal names its own terminal, so two grids do not share one answer", () => {
  const manager = newManager();
  const client = fakeClient();

  send(manager, client, { type: "attach", ptyId: "pty-a" });
  send(manager, client, { type: "input", ptyId: "pty-b", data: "x" });

  expect(client.errors().map((e: any) => e.ptyId)).toEqual(["pty-a", "pty-b"]);
});

// ── client-wide refusals stay unaddressed ───────────────────────────────────

test("a failure no terminal provoked carries no ptyId", () => {
  const manager = newManager();
  const client = fakeClient();

  handleClientMessage(manager, client.ws, "{ not json");
  handleClientMessage(manager, client.ws, Buffer.from([0x00]));
  send(manager, client, { type: "kill", taskId: "no-such-task" });
  send(manager, client, { type: "updateProject", id: "no-such-project", name: "n", initialPath: "/" });
  send(manager, client, { type: "deleteProject", id: "no-such-project" });
  handleClientMessage(manager, client.ws, JSON.stringify({ type: "nonsense" }));

  const errors = client.errors();
  expect(errors).toHaveLength(6);
  // Not `toBeUndefined` on a field that might be absent for the wrong reason:
  // the wire should carry no `ptyId` key at all.
  for (const error of errors) expect("ptyId" in error).toBe(false);
});

// ── the rest of the switch still works where it was moved to ────────────────

test("list answers with the task snapshot", () => {
  const manager = newManager();
  const client = fakeClient();

  send(manager, client, { type: "list" });

  expect(client.received).toHaveLength(1);
  expect(client.received[0]!.type).toBe("tasks");
  expect(client.errors()).toEqual([]);
});

test("detach without a ptyId is not an error", () => {
  const manager = newManager();
  const client = fakeClient();

  send(manager, client, { type: "detach" });

  expect(client.received).toEqual([]);
});

// The wire type says `ptyId?: string`, but JSON can say `null` — and null is
// neither absent nor a terminal anyone holds, so `PtyManager.detach`'s
// `undefined` branch was not taken and neither was the named one. The client
// went on being counted as a viewer of a terminal it had left: the task's grid
// stayed pinned by smallest-wins, and the harvester left the task alone because
// somebody was apparently still watching it.
test("a detach with a null ptyId detaches everything, the way an absent one does", async () => {
  const manager = newManager();
  const client = fakeClient();
  // `cat` rather than an agent: it holds the PTY open and paints nothing.
  await manager.createTask({ id: `test-${crypto.randomUUID()}`, command: ["cat"] });
  const pty = manager.primaryPty(manager.listTasks()[0]!.id)!;

  send(manager, client, { type: "attach", ptyId: pty.id, cols: 80, rows: 24 });
  expect(pty.getClientCount()).toBe(1);

  // Not through `send`, which cannot express a null the type forbids — this is
  // the frame as it arrives off the socket.
  handleClientMessage(manager, client.ws, JSON.stringify({ type: "detach", ptyId: null }));

  expect(pty.getClientCount()).toBe(0);
  expect(client.errors()).toEqual([]);
});
