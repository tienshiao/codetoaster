import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { ServerWebSocket } from "bun";
import { applyMigrations } from "../db";
import { TaskStore } from "./store";
import { TaskManager } from "./manager";
import type { ServerMessage, WebSocketData } from "../xtmux/types";
import { taskDir, taskSettingsPath } from "../agent/spawn";

// A client socket that records what the server sent it.
function fakeClient(id = "c1") {
  const received: ServerMessage[] = [];
  const ws = {
    send: (data: string) => { received.push(JSON.parse(data)); },
  } as unknown as ServerWebSocket<WebSocketData>;
  return {
    id,
    ws,
    received,
    of: (type: string) => received.filter((m) => m.type === type) as any[],
    last: (type: string) => [...received].reverse().find((m) => m.type === type) as any,
  };
}

async function waitFor(predicate: () => boolean, ms = 4000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return predicate();
}

const managers: TaskManager[] = [];
function newManager(): { manager: TaskManager; store: TaskStore; db: Database } {
  const db = new Database(":memory:");
  applyMigrations(db);
  const manager = new TaskManager(db);
  managers.push(manager);
  // A second view of the same database, for asserting on rows directly.
  return { manager, store: new TaskStore(db), db };
}

afterEach(() => {
  // PTYs are real processes; a leaked one outlives the test run.
  for (const m of managers) {
    for (const task of m.listTasks()) m.closeTask(task.id);
  }
  managers.length = 0;
});

// `true` runs a command that exits at once, so the exit path is testable.
function shell(exitImmediately = false): string[] {
  return exitImmediately ? ["true"] : [process.env.SHELL || "bash"];
}

describe("creating a task", () => {
  test("writes the row, spawns the terminal, and associates the two", async () => {
    const { manager, store } = newManager();
    const row = await manager.createTask({ id: "t1", command: shell() });

    expect(store.get("t1")).toBeDefined();
    expect(row.lifecycle).toBe("live");
    expect(row.agent_state).toBe("starting");

    const pty = manager.primaryPty("t1");
    expect(pty).toBeDefined();
    expect(manager.taskIdForPty(pty!.id)).toBe("t1");
  });

  test("allocates the agent's session id before anything spawns", async () => {
    const { manager, store } = newManager();
    const row = await manager.createTask({ id: "t1", command: shell() });

    // On the row the moment the task exists, not written back once the agent
    // reports in: it is what `--session-id` was given, and what a resume has
    // to ask for (§4.1).
    expect(row.agent_session_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(store.get("t1")!.agent_session_id).toBe(row.agent_session_id);
  });

  test("gives each task its own session id", async () => {
    const { manager } = newManager();
    const a = await manager.createTask({ id: "t1", command: shell() });
    const b = await manager.createTask({ id: "t2", command: shell() });
    // A used id cannot be reused — sharing one would leave the second task
    // unable to start at all (§4.3).
    expect(a.agent_session_id).not.toBe(b.agent_session_id);
  });

  test("the terminal's environment names the task and drops inherited markers", async () => {
    const { manager } = newManager();
    const out = `${process.env.TMPDIR ?? "/tmp"}/codetoaster-env-${crypto.randomUUID()}`;
    // Poison this process the way a daemon started from inside an agent
    // session is poisoned, and check the child comes out clean. Restored
    // rather than deleted afterwards: a suite run from inside an agent session
    // already has these, and unsetting them would quietly change the
    // environment every later test spawns under.
    const poisoned = ["CLAUDECODE", "CLAUDE_CODE_CHILD_SESSION"] as const;
    const previous = poisoned.map((key) => [key, process.env[key]] as const);
    for (const key of poisoned) process.env[key] = "1";
    try {
      await manager.createTask({
        id: "t1",
        command: ["bash", "-c", `env > ${out}`],
      });
      expect(await waitFor(() => Bun.file(out).size > 0)).toBe(true);
      const keys = (await Bun.file(out).text())
        .split("\n")
        .map((line) => line.slice(0, line.indexOf("=")));

      // The keys we poisoned, not "nothing starting with CLAUDE": the scrub is
      // deliberately narrow, and a developer who exports CLAUDE_CONFIG_DIR is
      // meant to have it inherited — a blanket assertion would fail on their
      // machine over correct behaviour.
      for (const key of poisoned) expect(keys).not.toContain(key);
      expect(keys).toContain("CODETOASTER_TASK_ID");
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await Bun.file(out).delete().catch(() => {});
    }
  });

  test("writes the hook settings before the agent starts, and points --settings at them", async () => {
    const { manager } = newManager();
    // A stand-in agent that records the argv it was given and then sits on the
    // PTY, so the settings path can be read off the command line the real
    // binary would have received.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-agent-"));
    const argvFile = path.join(dir, "argv");
    const bin = path.join(dir, "fake-agent");
    fs.writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' "$@" > ${argvFile}\nexec cat\n`);
    fs.chmodSync(bin, 0o755);

    const previousBin = process.env.CODETOASTER_AGENT_BIN;
    process.env.CODETOASTER_AGENT_BIN = bin;
    const id = `test-${crypto.randomUUID()}`;
    try {
      await manager.createTask({ id });
      expect(await waitFor(() => fs.existsSync(argvFile) && fs.statSync(argvFile).size > 0)).toBe(true);

      const argv = fs.readFileSync(argvFile, "utf8").trim().split("\n");
      expect(argv).toContain("--settings");
      const settingsPath = argv[argv.indexOf("--settings") + 1];
      expect(settingsPath).toBe(taskSettingsPath(id));

      // Already on disk by the time the agent was handed the path: a file
      // written after the spawn would leave the first session reporting
      // nothing.
      const parsed = JSON.parse(fs.readFileSync(settingsPath!, "utf8"));
      expect(Object.keys(parsed.hooks)).toContain("SessionStart");
      expect(parsed.hooks.Stop[0].hooks[0].command).toEndWith(" hook");
    } finally {
      if (previousBin === undefined) delete process.env.CODETOASTER_AGENT_BIN;
      else process.env.CODETOASTER_AGENT_BIN = previousBin;
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(taskDir(id), { recursive: true, force: true });
    }
  });

  test("a failed spawn takes the settings directory with the row", async () => {
    const { manager, store } = newManager();
    const previousBin = process.env.CODETOASTER_AGENT_BIN;
    process.env.CODETOASTER_AGENT_BIN = "/nonexistent/codetoaster-not-an-agent";
    const id = `test-${crypto.randomUUID()}`;
    try {
      await expect(manager.createTask({ id })).rejects.toThrow();
      expect(store.get(id)).toBeUndefined();
      // Nothing will ever read that directory again, and the id cannot be
      // issued a second time.
      expect(fs.existsSync(taskDir(id))).toBe(false);
    } finally {
      if (previousBin === undefined) delete process.env.CODETOASTER_AGENT_BIN;
      else process.env.CODETOASTER_AGENT_BIN = previousBin;
      fs.rmSync(taskDir(id), { recursive: true, force: true });
    }
  });

  // A caller that brings its own command is not running an agent, so there are
  // no hooks to install for it.
  test("writes no settings for a task given its own command", async () => {
    const { manager } = newManager();
    const id = `test-${crypto.randomUUID()}`;
    await manager.createTask({ id, command: shell() });
    expect(fs.existsSync(taskDir(id))).toBe(false);
  });

  test("derives a title from the cwd, and a caller's title outranks it", async () => {
    const { manager } = newManager();
    await manager.createTask({ id: "t1", command: shell() });
    await manager.createTask({ id: "t2", title: "Chosen", command: shell() });

    expect(manager.taskInfo("t1")!.titleSource).toBe("derived");
    expect(manager.taskInfo("t1")!.title.length).toBeGreaterThan(0);
    expect(manager.taskInfo("t2")!.title).toBe("Chosen");
    expect(manager.taskInfo("t2")!.titleSource).toBe("manual");
  });

  test("two tasks in the same directory get distinguishable titles", async () => {
    const { manager } = newManager();
    await manager.createTask({ id: "t1", command: shell() });
    await manager.createTask({ id: "t2", command: shell() });
    const [a, b] = manager.listTasks();
    expect(a!.title).not.toBe(b!.title);
  });

  test("resolves and stores the repo root once, rather than asking a process", async () => {
    const { manager, store } = newManager();
    await manager.createTask({ id: "t1", command: shell() });
    const row = store.get("t1")!;
    // Created inside this repository, so it has a real root rather than null.
    expect(row.repo_root).toBe(process.cwd());
    expect(row.cwd).toBe(process.cwd());
  });

  test("refuses a duplicate id rather than orphaning the first task's terminal", async () => {
    const { manager } = newManager();
    await manager.createTask({ id: "t1", command: shell() });
    await expect(manager.createTask({ id: "t1", command: shell() })).rejects.toThrow(/already exists/);
    expect(manager.primaryPty("t1")).toBeDefined();
  });
});

describe("the ptyId ↔ taskId association", () => {
  // A task's terminal defaults to the task's own id, which would hide any
  // client or broadcast that confused the two. These drive a task whose
  // terminal id is deliberately different — which is what a resumed task
  // (TASK-13) and a second shell tab (TASK-27) will both look like.
  async function taskWithDistinctPty(manager: TaskManager) {
    await manager.createTask({ id: "task-1", ptyId: "pty-9", command: shell() });
    return manager.primaryPty("task-1")!;
  }

  test("a terminal is addressed by its own id and still names its task", async () => {
    const { manager } = newManager();
    const pty = await taskWithDistinctPty(manager);
    expect(pty.id).toBe("pty-9");
    expect(manager.taskIdForPty("pty-9")).toBe("task-1");
    expect(manager.taskIdForPty("task-1")).toBeUndefined();
    expect(manager.taskInfo("task-1")!.ptyId).toBe("pty-9");
  });

  test("attaching answers with the task, not just the terminal", async () => {
    const { manager } = newManager();
    await taskWithDistinctPty(manager);
    const client = fakeClient();
    manager.attachClient("pty-9", client.id, client.ws, 80, 24);

    const attached = client.last("attached");
    expect(attached.ptyId).toBe("pty-9");
    expect(attached.taskId).toBe("task-1");
    // Before the restore, so a client knows whose screen is arriving.
    expect(client.received.findIndex((m) => m.type === "attached"))
      .toBeLessThan(client.received.findIndex((m) => m.type === "restore"));
  });

  test("activity is readdressed to the task", async () => {
    const { manager } = newManager();
    const pty = await taskWithDistinctPty(manager);
    const client = fakeClient();
    manager.registerClient(client.id, client.ws);
    manager.attachClient("pty-9", client.id, client.ws, 80, 24);

    pty.write("echo hello\n");
    expect(await waitFor(() => client.of("activity").length > 0)).toBe(true);
    expect(client.of("activity")[0].taskId).toBe("task-1");
    expect(client.of("activity")[0]).not.toHaveProperty("ptyId");
  });

  test("closing the task takes its terminal with it, whatever the terminal is called", async () => {
    const { manager, store } = newManager();
    await taskWithDistinctPty(manager);

    expect(manager.closeTask("task-1")).toBe(true);
    expect(manager.getPty("pty-9")).toBeUndefined();
    expect(manager.taskIdForPty("pty-9")).toBeUndefined();
    expect(store.get("task-1")).toBeUndefined();
    expect(manager.closeTask("task-1")).toBe(false);
  });
});

describe("broadcasting", () => {
  test("a snapshot carries every live task and the projects", async () => {
    const { manager } = newManager();
    const client = fakeClient();
    manager.registerClient(client.id, client.ws);
    manager.loadProjects();
    await manager.createTask({ id: "t1", command: shell() });

    manager.broadcastTasks();
    const snapshot = client.last("tasks");
    expect(snapshot.list.map((t: any) => t.id)).toEqual(["t1"]);
    expect(snapshot.projects.some((p: any) => p.id === "general")).toBe(true);
    expect(snapshot.list[0].ptyId).toBe(manager.primaryPty("t1")!.id);
  });

  test("a rename sends one row, not the whole list", async () => {
    const { manager } = newManager();
    const client = fakeClient();
    manager.registerClient(client.id, client.ws);
    await manager.createTask({ id: "t1", command: shell() });
    client.received.length = 0;

    expect(manager.renameTask("t1", "Renamed")).toBe(true);
    expect(client.of("tasks")).toHaveLength(0);
    expect(client.last("task").task).toMatchObject({
      id: "t1", title: "Renamed", titleSource: "manual",
    });
  });

  test("renaming a task that isn't there reports it", () => {
    const { manager } = newManager();
    expect(manager.renameTask("nope", "x")).toBe(false);
  });

  test("an exiting terminal marks the task exited and sends the row", async () => {
    const { manager, store } = newManager();
    const client = fakeClient();
    manager.registerClient(client.id, client.ws);
    await manager.createTask({ id: "t1", command: shell(true) });

    expect(await waitFor(() => store.get("t1")?.agent_state === "exited")).toBe(true);
    expect(store.get("t1")!.exit_code).toBe(0);
    expect(client.last("task").task.agentState).toBe("exited");
  });
});

describe("task info", () => {
  test("a suspended task reports no terminal and its remembered size", async () => {
    const { manager, store } = newManager();
    await manager.createTask({ id: "t1", command: shell() });
    manager.closeTask("t1");

    store.create({
      id: "gone", project_id: "general", title: "Suspended", initial_prompt: "",
      repo_root: "/repo", cwd: "/repo", lifecycle: "suspended",
    });
    store.update("gone", { last_size_cols: 132, last_size_rows: 43 });

    const info = manager.taskInfo("gone")!;
    expect(info.ptyId).toBeNull();
    expect(info.clientCount).toBe(0);
    expect(info.size).toEqual({ cols: 132, rows: 43 });
    expect(info.lifecycle).toBe("suspended");
  });

  test("the v1 list shows live tasks only", async () => {
    const { manager, store } = newManager();
    await manager.createTask({ id: "t1", command: shell() });
    await manager.createTask({ id: "t2", command: shell() });
    store.update("t2", { lifecycle: "suspended" });

    expect(manager.listTasks().map((t) => t.id)).toEqual(["t1"]);
  });
});

describe("boot reconciliation", () => {
  test("rows left live by the previous run become suspended", () => {
    const { manager, store } = newManager();
    store.create({
      id: "stale", project_id: "general", title: "Was running", initial_prompt: "",
      repo_root: "/repo", cwd: "/repo",
    });
    store.create({
      id: "already", project_id: "general", title: "Was suspended", initial_prompt: "",
      repo_root: "/repo", cwd: "/repo", lifecycle: "suspended", agent_state: "idle",
    });

    expect(manager.reconcileOnBoot()).toBe(1);
    expect(store.get("stale")!.lifecycle).toBe("suspended");
    expect(store.get("stale")!.agent_state).toBe("unknown");
    // A row that was already suspended is left exactly as it was.
    expect(store.get("already")!.agent_state).toBe("idle");
  });

  test("it is a no-op the second time", () => {
    const { manager, store } = newManager();
    store.create({
      id: "stale", project_id: "general", title: "x", initial_prompt: "",
      repo_root: "/repo", cwd: "/repo",
    });
    manager.reconcileOnBoot();
    expect(manager.reconcileOnBoot()).toBe(0);
  });
});
