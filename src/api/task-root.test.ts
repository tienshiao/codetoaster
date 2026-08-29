import { test, expect, describe, beforeAll, afterAll, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { initDatabase, getDatabase } from "../lib/db";
import { TaskStore } from "../lib/tasks/store";
import { taskManager } from "../lib/tasks/manager";
import { resolveTaskRoot } from "./utils";

let dbDir: string;
let store: TaskStore;
const spawned: string[] = [];

beforeAll(() => {
  dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-taskroot-"));
  initDatabase(path.join(dbDir, "codetoaster.db"));
  store = new TaskStore(getDatabase());
  taskManager.loadProjects();
});

afterEach(async () => {
  for (const id of spawned) taskManager.closeTask(id);
  spawned.length = 0;
  // A killed PTY's onExit lands a tick later and writes to the store. Letting
  // it land here keeps it from firing against a database this file has already
  // taken away — and the manager under test is the process-wide one, so the
  // fallout would surface in whatever test file ran next.
  await Bun.sleep(50);
});

afterAll(() => {
  fs.rmSync(dbDir, { recursive: true, force: true });
});

/** A row and nothing else — no process, which is the case that matters. */
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

describe("resolveTaskRoot", () => {
  test("reads the row, with no process anywhere near it", () => {
    row("suspended", { repo_root: "/repo", cwd: "/repo/worktree", lifecycle: "suspended" });
    const result = resolveTaskRoot("suspended");
    expect(result).toEqual({ repoRoot: "/repo", cwd: "/repo/worktree" });
    // The whole point: browsing a task that has no terminal to interrogate.
    expect(taskManager.primaryPty("suspended")).toBeUndefined();
  });

  test("an unknown task is a 404", async () => {
    const result = resolveTaskRoot("nope") as { error: Response };
    expect(result.error.status).toBe(404);
    expect(await result.error.json()).toEqual({ error: "Task not found" });
  });

  test("a task outside a repository is a 400, not a directory that fails later", async () => {
    row("bare", { repo_root: null, cwd: "/tmp" });
    const result = resolveTaskRoot("bare") as { error: Response };
    expect(result.error.status).toBe(400);
    expect(await result.error.json()).toEqual({ error: "Not a git repository" });
  });

  test("a live task resolves to the root stored at creation", async () => {
    await taskManager.createTask({ id: "live", command: ["sleep", "30"] });
    spawned.push("live");

    const result = resolveTaskRoot("live") as { repoRoot: string; cwd: string };
    expect(result.repoRoot).toBe(store.get("live")!.repo_root!);
    expect(result.cwd).toBe(process.cwd());
    // Created inside this repository, so the root is a real one.
    expect(fs.existsSync(path.join(result.repoRoot, ".git"))).toBe(true);
  });

  test("the task's terminal has an id of its own", async () => {
    await taskManager.createTask({ id: "task-x", command: ["sleep", "30"] });
    spawned.push("task-x");
    const pty = taskManager.primaryPty("task-x")!;
    expect(pty.id).not.toBe("task-x");
    expect(taskManager.taskIdForPty(pty.id)).toBe("task-x");
  });
});

describe("refreshCwd", () => {
  test("a lookup that could not run keeps the root the task already had", async () => {
    // Not "there is no repository" — git never answered. Overwriting a good
    // root with null here would 400 the task's data routes for good, since
    // nothing re-resolves once the directory stops moving.
    row("wedged", { repo_root: "/repo", cwd: "/repo" });
    const before = store.get("wedged")!;
    // No terminal to ask, so the row is returned untouched — the same shape
    // the guard protects: an absent answer never becomes a written null.
    expect(await taskManager.refreshCwd("wedged")).toBe("/repo");
    expect(store.get("wedged")!.repo_root).toBe(before.repo_root);
  });

  test("leaves the row alone while the agent stays put", async () => {
    await taskManager.createTask({ id: "still", command: ["sleep", "30"] });
    spawned.push("still");
    const before = store.get("still")!;

    expect(await taskManager.refreshCwd("still")).toBe(before.cwd);
    expect(store.get("still")).toEqual(before);
  });

  test("a task with no terminal reports the row's directory", () => {
    row("parked", { cwd: "/repo/elsewhere" });
    expect(taskManager.refreshCwd("parked")).resolves.toBe("/repo/elsewhere");
  });

  test("an unknown task reports nothing", () => {
    expect(taskManager.refreshCwd("nope")).resolves.toBeUndefined();
  });
});
