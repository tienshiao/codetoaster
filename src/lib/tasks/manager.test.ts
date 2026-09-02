import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { ServerWebSocket } from "bun";
import { applyMigrations, updateProject } from "../db";
import { TaskStore } from "./store";
import { TaskManager } from "./manager";
import type { ServerMessage, WebSocketData } from "../xtmux/types";
import { buildAgentCommand, taskDir, taskScrollbackPath, taskSettingsPath } from "../agent/spawn";
import { writeTaskSettings } from "../agent/settings";
import { readSnapshot, writeSnapshot } from "./snapshot";
import { sessionDisplayNames } from "../xtmux/naming";
import { TEST_SHELL } from "../../../test/shell";

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

afterEach(async () => {
  // PTYs are real processes; a leaked one outlives the test run. `deleteTask`
  // rather than `closeTask`, which is a suspend now and would leave every row
  // behind — and in a `:memory:` database that nobody else reads, a row with
  // no process is nothing worth keeping.
  for (const m of managers) {
    for (const task of m.listTasks()) await m.deleteTask(task.id);
  }
  managers.length = 0;
});

// `true` runs a command that exits at once, so the exit path is testable.
function shell(exitImmediately = false): string[] {
  return exitImmediately ? ["true"] : [TEST_SHELL];
}

/** A task whose terminal has actually painted something, and the wait for it to
 * have done so.
 *
 * Anything asserting about a *file* on disk has to go through this: a screen
 * with nothing on it is nothing to snapshot — an empty serialization is what a
 * disposed terminal answers too, and persisting it would blank the last screen
 * the task painted — so a task closed before its first paint writes no
 * scrollback at all. A bare `shell()` is exactly that task for the first few
 * milliseconds of its life. */
async function paintedTask(manager: TaskManager, id: string): Promise<void> {
  await manager.createTask({ id, command: ["sh", "-c", "printf 'on the screen'; exec cat"] });
  expect(await waitFor(() => manager.primaryPty(id)!.serialize().includes("on the screen"))).toBe(true);
}

// §9's risk 4: an agent run with hooks disabled, or one whose payloads a
// future version has changed, reports nothing at all. The task list has to
// stay useful anyway.
describe("degraded mode, when no hook ever arrives", () => {
  test("a silent task stops claiming to be starting", async () => {
    const { manager, store } = newManager();
    manager.setHookGrace(60);
    // `cat` sits there producing nothing, so the output heuristic has nothing
    // to say either — this is the case that would otherwise read `starting`
    // for the life of the task.
    await manager.createTask({ id: "t1", command: ["cat"] });
    expect(store.get("t1")!.agent_state).toBe("starting");

    expect(await waitFor(() => store.get("t1")!.agent_state === "unknown")).toBe(true);
  });

  test("output stands in for busy and idle", async () => {
    const { manager, store } = newManager();
    manager.setHookGrace(60);
    await manager.createTask({ id: "t1", command: ["sh", "-c", "printf hello; exec cat"] });

    // v1's inference, kept for exactly this case: bytes out means working.
    expect(await waitFor(() => store.get("t1")!.agent_state === "busy")).toBe(true);
    // ...and the 300ms trailing debounce closing means it stopped.
    expect(await waitFor(() => store.get("t1")!.agent_state === "idle")).toBe(true);
  });

  // The heuristic has to write `idle_since` too, because in degraded mode
  // nothing else ever does. A resumed task carries the column its previous
  // life left — a `Stop` from hours ago — so inferring `idle` without
  // restamping hands the idle harvester (TASK-15) a task that is already past
  // `harvest_after` and suspends it seconds after the user reopened it.
  test("an inferred idle starts the harvester's clock rather than inheriting an old one", async () => {
    const { manager, store } = newManager();
    manager.setHookGrace(60);
    await manager.createTask({ id: "t1", command: ["sh", "-c", "printf hello; exec cat"] });
    // What a previous life left behind.
    const stale = Date.now() - 6 * 60 * 60_000;
    store.update("t1", { idle_since: stale });

    expect(await waitFor(() => store.get("t1")!.agent_state === "idle")).toBe(true);
    expect(store.get("t1")!.idle_since).toBeGreaterThan(stale);
  });

  test("a hook, once seen, outranks anything the terminal does", async () => {
    const { manager, store } = newManager();
    manager.setHookGrace(60);
    await manager.createTask({ id: "t1", command: ["sh", "-c", "sleep 0.2; printf hello; exec cat"] });

    // The agent speaks for itself first...
    manager.applyHook("t1", { hook_event_name: "Stop", last_assistant_message: "done" });
    expect(store.get("t1")!.agent_state).toBe("idle");

    // ...and then the terminal paints. A task that is genuinely waiting on the
    // user must not be called busy because something echoed.
    await Bun.sleep(700);
    expect(store.get("t1")!.agent_state).toBe("idle");
    expect(store.get("t1")!.last_message).toBe("done");
  });

  test("a manual /compact does not strand the task in compacting", async () => {
    const { manager, store } = newManager();
    await manager.createTask({ id: "t1", command: ["cat"] });

    manager.applyHook("t1", { hook_event_name: "PreCompact", trigger: "manual" });
    expect(store.get("t1")!.agent_state).toBe("compacting");

    // The trigger arrived on the first hook and is needed by the second — the
    // manager is what holds it across the gap. Nothing else follows a
    // /compact typed at the prompt, so if this SessionStart does not end it,
    // nothing does.
    manager.applyHook("t1", { hook_event_name: "SessionStart", source: "compact" });
    expect(store.get("t1")!.agent_state).toBe("idle");
    expect(store.get("t1")!.idle_since).not.toBeNull();
  });

  test("an auto-compaction gives the turn back, and Stop still ends it", async () => {
    const { manager, store } = newManager();
    await manager.createTask({ id: "t1", command: ["cat"] });

    manager.applyHook("t1", { hook_event_name: "UserPromptSubmit" });
    manager.applyHook("t1", { hook_event_name: "PreCompact", trigger: "auto" });
    expect(store.get("t1")!.agent_state).toBe("compacting");

    manager.applyHook("t1", { hook_event_name: "SessionStart", source: "compact" });
    expect(store.get("t1")!.agent_state).toBe("busy");

    manager.applyHook("t1", { hook_event_name: "Stop", last_assistant_message: "done" });
    expect(store.get("t1")!.agent_state).toBe("idle");
  });

  test("a spent trigger does not colour the next compaction", async () => {
    const { manager, store } = newManager();
    await manager.createTask({ id: "t1", command: ["cat"] });

    manager.applyHook("t1", { hook_event_name: "PreCompact", trigger: "manual" });
    manager.applyHook("t1", { hook_event_name: "SessionStart", source: "compact" });
    expect(store.get("t1")!.agent_state).toBe("idle");

    // A second compaction whose PreCompact named no trigger: unknowable, so
    // the SessionStart claims nothing rather than reusing the last answer.
    manager.applyHook("t1", { hook_event_name: "UserPromptSubmit" });
    manager.applyHook("t1", { hook_event_name: "PreCompact" });
    manager.applyHook("t1", { hook_event_name: "SessionStart", source: "compact" });
    expect(store.get("t1")!.agent_state).toBe("compacting");
  });

  test("a trigger from a compaction that never came back does not colour the next one", async () => {
    const { manager, store } = newManager();
    await manager.createTask({ id: "t1", command: ["cat"] });

    // A compaction that starts and never reports back — cancelled, or its
    // SessionStart dropped — so nothing ever spends the trigger it named.
    manager.applyHook("t1", { hook_event_name: "PreCompact", trigger: "manual" });
    manager.applyHook("t1", { hook_event_name: "UserPromptSubmit" });

    // The next compaction names nothing. That is unknowable, and the answer to
    // unknowable is to claim nothing — not to reach for the answer the last
    // compaction happened to give, which would hand a mid-turn agent back as
    // idle and let the harvester suspend it out from under the user.
    manager.applyHook("t1", { hook_event_name: "PreCompact" });
    manager.applyHook("t1", { hook_event_name: "SessionStart", source: "compact" });
    expect(store.get("t1")!.agent_state).toBe("compacting");
  });

  test("the first hook cancels the clock, so a live task is never called unknown", async () => {
    const { manager, store } = newManager();
    manager.setHookGrace(60);
    await manager.createTask({ id: "t1", command: ["cat"] });
    manager.applyHook("t1", { hook_event_name: "UserPromptSubmit" });

    await Bun.sleep(150);
    expect(store.get("t1")!.agent_state).toBe("busy");
  });

  test("deleting a task takes its clock with it", async () => {
    const { manager } = newManager();
    manager.setHookGrace(60);
    const client = fakeClient();
    manager.registerClient(client.id, client.ws);
    await manager.createTask({ id: "t1", command: ["cat"] });
    await manager.deleteTask("t1");

    // Nothing to relabel, and nothing that throws trying.
    await Bun.sleep(150);
    expect(client.of("task").filter((m) => m.task?.id === "t1")).toHaveLength(0);
  });
});

// §7.5. The prompt that started a task is what it is called, so a list of
// thirty tasks in one checkout is readable — before this they were all
// "<dir> · <branch>", distinguishable only by the number `uniqueName` hung off
// the end.
describe("titles", () => {
  test("the opening line of the prompt becomes the title", async () => {
    const { manager, store } = newManager();
    await manager.createTask({
      id: "t1",
      command: shell(),
      prompt: "fix the diff parser\n\nrenames and quoted paths especially",
    });

    expect(store.get("t1")!.title).toBe("fix the diff parser");
    // A guess, not a choice — so the agent's own terminal title may still
    // display over it, which is what `manual` would have prevented for good.
    expect(store.get("t1")!.title_source).toBe("derived");
  });

  test("a prompt that says nothing falls back to the directory", async () => {
    const { manager, store } = newManager();
    // The sidebar's New task button: a task can be started with nothing to say.
    await manager.createTask({ id: "t1", command: shell() });
    await manager.createTask({ id: "t2", command: shell(), prompt: "   \n\t\n " });

    for (const id of ["t1", "t2"]) {
      expect(store.get(id)!.title).toContain(" · ");
      expect(store.get(id)!.title_source).toBe("derived");
    }
  });

  test("a prompt of nothing but whitespace is nothing to the agent either", async () => {
    const { manager, store } = newManager();
    await manager.createTask({ id: "t1", command: shell(), prompt: "   \n\t\n " });

    // `titleFromPrompt` calls this "nothing to say" and falls back to the
    // directory; `buildAgentCommand` judges `initial_prompt` on truthiness, and
    // the two must agree. Stored untrimmed, the agent would be started with a
    // blank turn already submitted instead of the plain interactive session the
    // title fallback just decided this task was.
    expect(store.get("t1")!.initial_prompt).toBe("");
    expect(buildAgentCommand(store.get("t1")!)).not.toContain("--");
  });

  test("an explicit title outranks the prompt, and is recorded as chosen", async () => {
    const { manager, store } = newManager();
    await manager.createTask({
      id: "t1",
      command: shell(),
      title: "Chosen",
      prompt: "fix the diff parser",
    });

    expect(store.get("t1")!.title).toBe("Chosen");
    expect(store.get("t1")!.title_source).toBe("manual");
  });

  test("two tasks from the same prompt do not collide", async () => {
    const { manager, store } = newManager();
    await manager.createTask({ id: "t1", command: shell(), prompt: "fix the diff parser" });
    await manager.createTask({ id: "t2", command: shell(), prompt: "fix the diff parser" });

    // The same reason two tasks in one checkout got a suffix: identical rows
    // are exactly what a derived title exists to prevent.
    expect(store.get("t1")!.title).toBe("fix the diff parser");
    expect(store.get("t2")!.title).toBe("fix the diff parser 2");
  });

  test("a prompt-derived title still yields to a live terminal title", async () => {
    const { manager } = newManager();
    await manager.createTask({ id: "t1", command: shell(), prompt: "fix the diff parser" });
    const pty = manager.primaryPty("t1")!;

    // OSC 2, the agent saying what it is doing now.
    pty.write("printf '\\033]2;Implementing the latch\\007'\n");
    expect(await waitFor(() => pty.title === "Implementing the latch")).toBe(true);

    // The projection is the client's (naming.ts), so what the server owes it is
    // both halves: the stored title, and the live one to display over it.
    const info = manager.taskInfo("t1")!;
    expect(info.title).toBe("fix the diff parser");
    expect(info.terminalTitle).toBe("Implementing the latch");
    expect(sessionDisplayNames([
      { id: info.id, name: info.title, nameSource: info.titleSource, title: info.terminalTitle },
    ]).get("t1")).toBe("Implementing the latch");
  });

  test("a renamed task does not yield to a live terminal title", async () => {
    const { manager } = newManager();
    await manager.createTask({ id: "t1", command: shell(), prompt: "fix the diff parser" });
    manager.renameTask("t1", "Chosen");
    const pty = manager.primaryPty("t1")!;

    pty.write("printf '\\033]2;Implementing the latch\\007'\n");
    expect(await waitFor(() => pty.title === "Implementing the latch")).toBe(true);

    const info = manager.taskInfo("t1")!;
    expect(sessionDisplayNames([
      { id: info.id, name: info.title, nameSource: info.titleSource, title: info.terminalTitle },
    ]).get("t1")).toBe("Chosen");
  });
});

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

  // The composer sends only what the user overrode, so an absent model or mode
  // means "whatever the project says" — resolved here rather than in the
  // client, which is what gives the API and the CLI the same answer.
  test("falls back to the project's defaults, and a caller's choice outranks them", async () => {
    const { manager, store, db: database } = newManager();
    manager.createProject("proj", "Project", "");
    // Straight onto the row: nothing writes these columns yet.
    updateProject("proj", { default_model: "opus", default_permission_mode: "plan" }, database);
    manager.loadProjects();

    await manager.createTask({ id: "t1", projectId: "proj", command: shell() });
    expect(store.get("t1")!.model).toBe("opus");
    expect(store.get("t1")!.permission_mode).toBe("plan");

    await manager.createTask({
      id: "t2", projectId: "proj", model: "haiku", permissionMode: "acceptEdits", command: shell(),
    });
    expect(store.get("t2")!.model).toBe("haiku");
    expect(store.get("t2")!.permission_mode).toBe("acceptEdits");
  });

  // The shape the API and the CLI actually send. A create that names no project
  // still lands in "general" — `resolveProjectId` says so — and a task sitting
  // in a project has to inherit that project's defaults however it got there.
  // Resolving against the *named* project rather than the joined one made this
  // the one caller that silently got nothing, which is the opposite of the
  // reason the resolution lives on the server at all.
  test("a task that names no project inherits the defaults of the one it lands in", async () => {
    const { manager, store, db: database } = newManager();
    updateProject("general", { default_model: "sonnet", default_permission_mode: "plan" }, database);
    manager.loadProjects();

    await manager.createTask({ id: "t1", command: shell() });

    expect(store.get("t1")!.project_id).toBe("general");
    expect(store.get("t1")!.model).toBe("sonnet");
    expect(store.get("t1")!.permission_mode).toBe("plan");
  });

  // TASK-81: creating a project and editing one now ask for the same eight
  // fields, so a create has to be able to carry the five defaults an update
  // could. One write, because a create followed by an update would put the
  // project on every attached client with none of them.
  test("a project can be created already configured", () => {
    const { manager, db: database } = newManager();

    manager.createProject("proj", "Project", "~/src/proj", {
      defaultModel: "fable",
      defaultBaseRef: "main",
      worktreeDefault: true,
      setupCommand: "bun install",
      worktreeCopy: ".env",
    });

    // In memory, without a reload...
    const project = manager.getProjects().find((p) => p.id === "proj")!;
    expect(project.defaultModel).toBe("fable");
    expect(project.defaultBaseRef).toBe("main");
    expect(project.worktreeDefault).toBe(true);
    expect(project.setupCommand).toBe("bun install");
    expect(project.worktreeCopy).toBe(".env");

    // ...and on the row, in the same write as the identity columns.
    const row = database
      .query("SELECT * FROM projects WHERE id = ?")
      .get("proj") as Record<string, unknown>;
    expect(row.default_model).toBe("fable");
    expect(row.default_base_ref).toBe("main");
    expect(row.worktree_default).toBe(1);
  });

  // The same normalization `updateProject` does, and for the same reason: a
  // project storing "" as its model would put an empty `--model` on an agent's
  // argv. The dialog sends every field every time, so blanks are the common
  // case rather than the odd one.
  test("blank settings are stored as unset, not as empty strings", () => {
    const { manager } = newManager();

    manager.createProject("proj", "Project", "", {
      defaultModel: "",
      defaultBaseRef: "   ",
      setupCommand: "",
      worktreeCopy: "",
      worktreeDefault: false,
    });

    const project = manager.getProjects().find((p) => p.id === "proj")!;
    expect(project.defaultModel).toBeNull();
    expect(project.defaultBaseRef).toBeNull();
    expect(project.setupCommand).toBeNull();
  });

  test("a project created with no settings is unset throughout", () => {
    const { manager } = newManager();

    manager.createProject("proj", "Project", "");

    expect(manager.getProjects().find((p) => p.id === "proj")).toMatchObject({
      defaultModel: null,
      defaultPermissionMode: null,
      defaultBaseRef: null,
      setupCommand: null,
      worktreeCopy: null,
      worktreeDefault: false,
    });
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

  test("the viewer count reaches the clients already watching", async () => {
    const { manager } = newManager();
    await taskWithDistinctPty(manager);
    const first = fakeClient("c1");
    const second = fakeClient("c2");
    manager.registerClient(first.id, first.ws);
    manager.registerClient(second.id, second.ws);

    manager.attachClient("pty-9", first.id, first.ws, 80, 24);
    expect(first.last("task").task.clientCount).toBe(1);

    // Nothing about the task itself changes when a second browser opens it —
    // no output, no state transition — so if the attach does not broadcast,
    // the first client goes on saying "1 viewing" indefinitely.
    manager.attachClient("pty-9", second.id, second.ws, 80, 24);
    expect(first.last("task").task.clientCount).toBe(2);

    manager.detachClient(second.id, "pty-9");
    expect(first.last("task").task.clientCount).toBe(1);
  });

  test("a closing socket takes its count with it, across every terminal it held", async () => {
    const { manager } = newManager();
    await taskWithDistinctPty(manager);
    await manager.createTask({ id: "task-2", command: shell() });
    const other = manager.primaryPty("task-2")!;
    const watcher = fakeClient("c1");
    const leaving = fakeClient("c2");
    manager.registerClient(watcher.id, watcher.ws);
    manager.registerClient(leaving.id, leaving.ws);

    manager.attachClient("pty-9", watcher.id, watcher.ws, 80, 24);
    manager.attachClient("pty-9", leaving.id, leaving.ws, 80, 24);
    manager.attachClient(other.id, leaving.id, leaving.ws, 80, 24);

    // The socket-closed path: one detach, no PTY named, every task the client
    // held has to be told.
    manager.detachClient(leaving.id);
    const counts = new Map(watcher.of("task").map((m) => [m.task.id, m.task.clientCount]));
    expect(counts.get("task-1")).toBe(1);
    expect(counts.get("task-2")).toBe(0);
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

  test("deleting the task takes its terminal with it, whatever the terminal is called", async () => {
    const { manager, store } = newManager();
    await taskWithDistinctPty(manager);

    expect(await manager.deleteTask("task-1")).not.toBeNull();
    expect(manager.getPty("pty-9")).toBeUndefined();
    expect(manager.taskIdForPty("pty-9")).toBeUndefined();
    expect(store.get("task-1")).toBeUndefined();
    // Null the second time: the outcome describes a deletion that happened, and
    // there is no task left to have one.
    expect(await manager.deleteTask("task-1")).toBeNull();
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
    await manager.deleteTask("t1");

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

  // §6: closing a task suspends it, so a list that hid suspended rows would be
  // the sidebar telling the user their work had been deleted.
  test("the list carries suspended tasks and leaves archived ones out", async () => {
    const { manager, store } = newManager();
    await manager.createTask({ id: "t1", command: shell() });
    await manager.createTask({ id: "t2", command: shell() });
    await manager.createTask({ id: "t3", command: shell() });
    store.update("t2", { lifecycle: "suspended" });
    store.update("t3", { lifecycle: "archived" });

    expect(manager.listTasks().map((t) => t.id).sort()).toEqual(["t1", "t2"]);
  });

  // §7.5: recency across projects is the sidebar's default order, and project
  // grouping is a toggle over it. Asserted here rather than left to the client
  // because the client sorting a list it was handed in some other order is the
  // arrangement that made v1's sidebar disagree with itself.
  test("the list is ordered by last activity, most recent first", async () => {
    const { manager, store } = newManager();
    await manager.createTask({ id: "old", command: shell() });
    await manager.createTask({ id: "middle", command: shell() });
    await manager.createTask({ id: "recent", command: shell() });
    store.update("old", { last_active_at: 1_000 });
    store.update("middle", { last_active_at: 2_000 });
    store.update("recent", { last_active_at: 3_000 });

    expect(manager.listTasks().map((t) => t.id)).toEqual(["recent", "middle", "old"]);
  });

  // The project a task belongs to travels on the task, so grouping does not
  // have to be reconstructed by searching every project's `taskIds` for it.
  test("a task carries its project id", () => {
    const { manager, store } = newManager();
    store.create({
      id: "t1", project_id: "repo", title: "In a repo", initial_prompt: "",
      repo_root: "/repo", cwd: "/repo",
    });

    expect(manager.taskInfo("t1")!.projectId).toBe("repo");
  });

});

// TASK-16. Chat products have no "close", so closing a task suspends it (§6):
// the process goes, everything that makes the task resumable stays.
describe("closing a task", () => {
  const closed: string[] = [];
  function newTaskId(): string {
    const id = `test-${crypto.randomUUID()}`;
    closed.push(id);
    return id;
  }
  afterEach(() => {
    // Closing writes a real scrollback under the user's home, since that is
    // what reopening the task reads back.
    for (const id of closed.splice(0)) fs.rmSync(taskDir(id), { recursive: true, force: true });
  });

  // AC #5: the row and the directory are what a resume is built out of.
  test("suspends the task instead of deleting it, and keeps what reopening it reads", async () => {
    const { manager, store } = newManager();
    const id = newTaskId();
    await paintedTask(manager, id);
    // Written by hand because the stand-in command skips the agent path that
    // normally writes it. It is what `claude --settings` is pointed at on the
    // way back, so a close that took it would leave the task resumable only
    // without its hooks.
    await writeTaskSettings(id);

    expect(await manager.closeTask(id)).toBe(true);

    expect(store.get(id)!.lifecycle).toBe("suspended");
    expect(manager.primaryPty(id)).toBeUndefined();
    expect(fs.existsSync(taskSettingsPath(id))).toBe(true);
    expect(fs.existsSync(taskScrollbackPath(id))).toBe(true);
    // Still in front of the user, which is the whole point of suspending
    // rather than deleting.
    expect(manager.listTasks().map((t) => t.id)).toContain(id);
  });

  // AC #1. This is the one thing that distinguishes a click from the idle
  // harvester: a user closing a task has already said what §5.5's guards exist
  // to infer, so none of them applies.
  test("closes a busy task immediately rather than waiting for it to go idle", async () => {
    const { manager, store } = newManager();
    const id = newTaskId();
    await manager.createTask({ id, command: ["cat"] });
    manager.applyHook(id, { hook_event_name: "UserPromptSubmit" });
    expect(store.get(id)!.agent_state).toBe("busy");
    expect(store.get(id)!.idle_since).toBeNull();

    expect(await manager.closeTask(id)).toBe(true);

    expect(store.get(id)!.lifecycle).toBe("suspended");
  });

  test("a task that is already closed is not closed twice", async () => {
    const { manager } = newManager();
    const id = newTaskId();
    await manager.createTask({ id, command: shell() });

    expect(await manager.closeTask(id)).toBe(true);
    expect(await manager.closeTask(id)).toBe(false);
    expect(await manager.closeTask("no-such-task")).toBe(false);
  });

  // A derived title is "<dir> · <branch>", so two tasks in one repository
  // collide by default. A user who cannot tell a new task from the one they
  // closed an hour ago is no better off than if both were still running.
  test("a new task's title is unique against the closed ones too", async () => {
    const { manager } = newManager();
    const first = newTaskId();
    const second = newTaskId();
    await manager.createTask({ id: first, command: shell() });
    expect(await manager.closeTask(first)).toBe(true);
    await manager.createTask({ id: second, command: shell() });

    const titles = manager.listTasks().map((t) => t.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  // The destructive door is the other one, and only it is destructive.
  // The mirror of "deleting a task takes its snapshot with it" below: the
  // removal moved to `deleteTask`, and a close that still fired it would take
  // the screen the user is shown while their agent comes back.
  test("the snapshot survives a close, and goes on surviving it", async () => {
    const { manager } = newManager();
    const id = newTaskId();
    await paintedTask(manager, id);

    expect(await manager.closeTask(id)).toBe(true);

    // Given as long as a fire-and-forget removal would have needed, so this is
    // not just outrunning it.
    await Bun.sleep(100);
    expect(fs.existsSync(taskScrollbackPath(id))).toBe(true);
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

  // AC #2/#3: a restart must not read as "restart nukes everything". The
  // lifecycle rewrite is the whole of it now — `listTasks` walks the rows, so a
  // task of a previous run is listable the moment its row exists, and being
  // listed no longer depends on the daemon having adopted it into the in-memory
  // project grouping first. What this still has to prove is that the rewrite
  // happens: a `live` row from a dead daemon is a lie (§5.5), and it has to come
  // back as suspended rather than as a task with a terminal that is not there.
  test("the rows it suspends are in the list a connecting client is sent", () => {
    const { manager, store } = newManager();
    manager.loadProjects();
    store.create({
      id: "stale", project_id: "general", title: "Was running", initial_prompt: "",
      repo_root: "/repo", cwd: "/repo",
    });
    store.create({
      id: "already", project_id: "general", title: "Was suspended", initial_prompt: "",
      repo_root: "/repo", cwd: "/repo", lifecycle: "suspended",
    });
    store.create({
      id: "archived", project_id: "general", title: "Gone", initial_prompt: "",
      repo_root: "/repo", cwd: "/repo", lifecycle: "archived",
    });
    manager.reconcileOnBoot();

    expect(manager.listTasks().map((t) => t.id).sort()).toEqual(["already", "stale"]);
    expect(manager.listTasks().every((t) => t.lifecycle === "suspended")).toBe(true);
  });
});

describe("snapshotting a task", () => {
  const snapshotted: string[] = [];
  function newTaskId(): string {
    const id = `test-${crypto.randomUUID()}`;
    snapshotted.push(id);
    return id;
  }
  afterEach(() => {
    for (const id of snapshotted.splice(0)) {
      fs.rmSync(taskDir(id), { recursive: true, force: true });
    }
  });

  test("writes the screen to disk and records the grid it was taken at", async () => {
    const { manager, store } = newManager();
    const id = newTaskId();
    await manager.createTask({
      id, cols: 133, rows: 41,
      command: ["sh", "-c", "printf 'snapshot me'; exec cat"],
    });
    expect(await waitFor(() => manager.primaryPty(id)!.serialize().includes("snapshot me"))).toBe(true);

    expect(await manager.snapshot(id)).toBe(true);

    expect(await readSnapshot(id)).toContain("snapshot me");
    // The two are one fact: a screen repainted into a grid it was not taken at
    // reflows into nonsense, and `runResumeLadder` sizes the terminal it spawns
    // off exactly these columns — as resume.test.ts asserts end to end.
    expect(store.get(id)!.last_size_cols).toBe(133);
    expect(store.get(id)!.last_size_rows).toBe(41);
  });

  test("a task that does not exist has nothing to snapshot", async () => {
    const { manager } = newManager();
    expect(await manager.snapshot("nope")).toBe(false);
  });

  // The file is only stale in the sense that the process behind it is gone,
  // which is precisely when a user wants to see it. Clearing it here would lose
  // the last screen of every task the daemon outlived.
  test("a task with no terminal keeps the snapshot it already had", async () => {
    const { manager, store } = newManager();
    const id = newTaskId();
    store.create({
      id, project_id: "general", title: "Suspended", initial_prompt: "",
      repo_root: "/repo", cwd: "/repo", lifecycle: "suspended",
    });
    await writeSnapshot(id, "the last thing it painted");

    expect(await manager.snapshot(id)).toBe(false);
    expect(await readSnapshot(id)).toBe("the last thing it painted");
  });

  // The same care, for a terminal that is perfectly alive. A dispose is not the
  // only way to serialize to "": a task closed in the second or two between the
  // resume spawning the agent and its first paint has a live PTY with an empty
  // buffer, and writing that would blank the screen the user is about to be
  // shown when they reopen it — with the old one gone for good.
  test("a terminal that has painted nothing keeps the snapshot it already had", async () => {
    const { manager, store } = newManager();
    const id = newTaskId();
    await manager.createTask({ id, command: shell() });
    await writeSnapshot(id, "the last thing it painted");
    store.update(id, { last_size_cols: 133, last_size_rows: 41 });
    (manager.primaryPty(id)! as any).serialize = () => "";

    expect(await manager.snapshot(id)).toBe(false);

    expect(await readSnapshot(id)).toBe("the last thing it painted");
    // The grid goes untouched with it: the two are one fact, so a size recorded
    // for a screen that was never written describes the screen still on disk.
    expect(store.get(id)!.last_size_cols).toBe(133);
    expect(store.get(id)!.last_size_rows).toBe(41);
  });

  // Deleting, not closing: a closed task's snapshot is exactly what reopening
  // it reads back (§5.5, phase 1), and only a delete leaves no row to read it
  // for.
  test("deleting a task takes its whole directory with it", async () => {
    const { manager } = newManager();
    const id = newTaskId();
    await paintedTask(manager, id);
    expect(await manager.snapshot(id)).toBe(true);
    expect(fs.existsSync(taskScrollbackPath(id))).toBe(true);

    // Awaited, and the promise is the point: the row goes synchronously, and
    // what this returns covers the disk (TASK-31). Dropping it leaves the
    // removal running into the teardown below, which then removes the same tree
    // a second time — two recursive `rm`s over one directory, and on macOS the
    // loser of that race gets an EFAULT rather than the "already gone" it
    // asked for.
    await manager.deleteTask(id);

    // Not only the screen. `closeTask` leaves the settings and the scrollback
    // standing because a resume reads both; a deleted task is resumed by
    // nothing, so the whole of `~/.codetoaster/tasks/<id>/` goes.
    expect(fs.existsSync(taskScrollbackPath(id))).toBe(false);
    expect(fs.existsSync(taskDir(id))).toBe(false);
  });
});

describe("deleting a project", () => {
  // The manager's `taskIds` only holds what this run started, so reassigning
  // off that list leaves every task suspended by a previous daemon pointing at
  // a project row that no longer exists — and nothing else revisits the column.
  test("moves the rows it is not holding in memory, not just the live ones", () => {
    const { manager, store } = newManager();
    manager.createProject("proj", "Project", "");
    store.create({
      id: "suspended", project_id: "proj", title: "From a previous run",
      initial_prompt: "", repo_root: "/repo", cwd: "/repo",
      lifecycle: "suspended", agent_state: "unknown",
    });

    expect(manager.deleteProject("proj")).toBe(true);
    expect(store.get("suspended")!.project_id).toBe("general");
  });
});

// TASK-27. A task holds an agent and however many plain shells the user has
// opened beside it (§3). The two are the same kind of object to `PtyManager`
// and must not be the same kind of thing to the task: everything the task says
// about itself — that its conversation exited, what it is called, whether it is
// working — is a claim about the agent, and a shell has no standing to make it.
describe("shell tabs", () => {
  test("a shell joins the task's terminals without becoming its agent", async () => {
    const { manager } = newManager();
    await manager.createTask({ id: "t1", command: shell() });
    const agent = manager.primaryPty("t1")!;

    const opened = manager.openShell("t1")!;

    expect(opened.id).not.toBe(agent.id);
    expect(manager.taskIdForPty(opened.id)).toBe("t1");
    // What the harvester counts views over and asks what is running, and what
    // a suspend kills.
    expect(manager.taskPtyList("t1").map((p) => p.id).sort()).toEqual([agent.id, opened.id].sort());
    // What a client attaches its agent tab to is unmoved.
    expect(manager.primaryPty("t1")!.id).toBe(agent.id);
    expect(manager.taskInfo("t1")!.ptyId).toBe(agent.id);
    expect(manager.taskInfo("t1")!.shellPtyIds).toEqual([opened.id]);
  });

  test("a shell exiting is not the agent exiting", async () => {
    const { manager, store } = newManager();
    // A silent agent, so the only thing that can move the row is the shell.
    await manager.createTask({ id: "t1", command: ["cat"] });
    store.update("t1", { agent_state: "idle" });
    const opened = manager.openShell("t1")!;

    opened.write("exit\n");
    expect(await waitFor(() => opened.exited)).toBe(true);
    // The one thing this must not have done. `adopt`'s exit callback writes
    // `agent_state: exited` and an exit code, and a user typing `exit` in a
    // shell tab would otherwise put a tombstone on a conversation that is
    // sitting there perfectly alive.
    expect(store.get("t1")!.agent_state).toBe("idle");
    expect(store.get("t1")!.exit_code).toBe(null);
  });

  test("a shell's terminal title is not the task's", async () => {
    const { manager } = newManager();
    await manager.createTask({ id: "t1", command: shell() });
    const opened = manager.openShell("t1")!;

    // OSC 2. Projected over the stored title at render time by `naming.ts`, so
    // a shell allowed to set it would rename the task in the sidebar.
    opened.write("printf '\\033]2;a shell said this\\007'\n");
    expect(await waitFor(() => opened.title === "a shell said this")).toBe(true);
    expect(manager.taskInfo("t1")!.terminalTitle).not.toBe("a shell said this");
  });

  test("a shell does not drive the degraded-mode state inference", async () => {
    const { manager, store } = newManager();
    manager.setHookGrace(60);
    // `cat` never reports a hook and never paints, so the task is exactly the
    // one degraded mode speaks for — and the only output it will ever see is
    // the shell's.
    await manager.createTask({ id: "t1", command: ["cat"] });
    expect(await waitFor(() => store.get("t1")!.agent_state === "unknown")).toBe(true);
    const before = store.get("t1")!.last_active_at;

    const opened = manager.openShell("t1")!;
    opened.write("printf 'a build, say'\n");
    expect(await waitFor(() => opened.serialize().includes("a build, say"))).toBe(true);

    // Recency moves — a user running something in a shell tab is working on
    // this task — while the agent's state does not: the shell is not the
    // conversation, and `inferState` speaks for the conversation.
    expect(await waitFor(() => store.get("t1")!.last_active_at > before)).toBe(true);
    expect(store.get("t1")!.agent_state).toBe("unknown");
  });

  test("closing a shell leaves the agent alone, and the agent cannot be closed as one", async () => {
    const { manager } = newManager();
    await manager.createTask({ id: "t1", command: shell() });
    const agent = manager.primaryPty("t1")!;
    const opened = manager.openShell("t1")!;

    // The agent tab is not closable (§7.2), and a client that asked anyway must
    // not take the conversation down by the wrong door.
    expect(manager.closeShell("t1", agent.id)).toBe(false);
    expect(agent.isDisposed).toBe(false);
    // Nor may one task close another's terminal.
    expect(manager.closeShell("t2", opened.id)).toBe(false);

    expect(manager.closeShell("t1", opened.id)).toBe(true);
    expect(opened.isDisposed).toBe(true);
    expect(manager.taskIdForPty(opened.id)).toBeUndefined();
    expect(manager.taskInfo("t1")!.shellPtyIds).toEqual([]);
    expect(manager.primaryPty("t1")!.id).toBe(agent.id);
    // Twice is not a failure to report differently, but it is not a second
    // kill either.
    expect(manager.closeShell("t1", opened.id)).toBe(false);
  });

  test("a shell inherits the task's grid rather than the 80x24 fallback", async () => {
    const { manager } = newManager();
    await manager.createTask({ id: "t1", command: shell(), cols: 120, rows: 40 });

    // The route that opens a shell has no terminal yet — the tab is drawn from
    // its answer — so nobody is in a position to measure one. Left to
    // `PtyManager`'s fallback the shell paints its first prompt laid out for 80
    // columns and reflows the moment the tab attaches.
    expect(manager.openShell("t1")!.getSize()).toEqual({ cols: 120, rows: 40 });
    // A caller that does know still wins.
    expect(manager.openShell("t1", { cols: 100, rows: 30 })!.getSize()).toEqual({
      cols: 100,
      rows: 30,
    });
  });

  test("a suspended task opens no shell", async () => {
    const { manager, store } = newManager();
    await manager.createTask({ id: "t1", command: shell() });
    store.update("t1", { lifecycle: "suspended" });

    // A process in the working directory of a conversation nobody has resumed,
    // that the next harvest would not even find — `liveTasks` is what the
    // harvester walks.
    expect(manager.openShell("t1")).toBeUndefined();
    expect(manager.taskInfo("t1")!.shellPtyIds).toEqual([]);
  });
});
