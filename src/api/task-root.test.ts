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
  test("reads the row, with no process anywhere near it", async () => {
    row("suspended", { repo_root: "/repo", cwd: "/repo/worktree", lifecycle: "suspended" });
    const result = await resolveTaskRoot("suspended");
    expect(result).toEqual({ repoRoot: "/repo", cwd: "/repo/worktree" });
    // The whole point: browsing a task that has no terminal to interrogate.
    expect(taskManager.primaryPty("suspended")).toBeUndefined();
  });

  test("an unknown task is a 404", async () => {
    const result = await resolveTaskRoot("nope") as { error: Response };
    expect(result.error.status).toBe(404);
    expect(await result.error.json()).toEqual({ error: "Task not found" });
  });

  test("a task outside a repository is a 400, not a directory that fails later", async () => {
    row("bare", { repo_root: null, cwd: "/tmp" });
    const result = await resolveTaskRoot("bare") as { error: Response };
    expect(result.error.status).toBe(400);
    expect(await result.error.json()).toEqual({ error: "Not a git repository" });
  });

  test("a live task resolves to the root stored at creation", async () => {
    await taskManager.createTask({ id: "live", command: ["sleep", "30"] });
    spawned.push("live");

    const result = await resolveTaskRoot("live") as { repoRoot: string; cwd: string };
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

  test("a task with no terminal reports the row's directory", async () => {
    row("parked", { cwd: "/repo/elsewhere" });
    expect(taskManager.refreshCwd("parked")).resolves.toBe("/repo/elsewhere");
  });

  // A null root is not an answer that ages well: createTask records a git that
  // never replied as "no repository", and `git init` happens under a cwd that
  // never moves. Nothing else revisits the column, so a task stuck on null
  // would 400 its diff, file and git routes for good.
  test("re-resolves a null root even though the directory never moved", async () => {
    row("rootless", { repo_root: null, cwd: process.cwd() });

    expect(await taskManager.refreshCwd("rootless")).toBe(process.cwd());
    expect(store.get("rootless")!.repo_root).toBeTruthy();
    expect(fs.existsSync(path.join(store.get("rootless")!.repo_root!, ".git"))).toBe(true);
  });

  // Still null after re-asking is not a write, and must not broadcast a row
  // that did not change — every list would otherwise push a delta per task
  // that simply is not in a repository.
  test("a directory that really is not a repository stays null without a write", async () => {
    row("outside", { repo_root: null, cwd: os.tmpdir() });
    const before = store.get("outside")!;

    expect(await taskManager.refreshCwd("outside")).toBe(os.tmpdir());
    expect(store.get("outside")).toEqual(before);
  });

  test("an unknown task reports nothing", async () => {
    expect(taskManager.refreshCwd("nope")).resolves.toBeUndefined();
  });
});

// The gap TASK-41 closes. Attach was the only thing refreshing a task's
// directory, and a client only re-attaches when it changes task — so a user
// moving between one task's own Changes, Files and History tabs never
// triggered it, and a single-task user never did at all.
describe("noticing that the agent has moved", () => {
  afterEach(() => taskManager.setCwdRefreshWindow(3_000));

  async function taskInThisRepo(id: string) {
    spawned.push(id);
    await taskManager.createTask({ id, command: [process.env.SHELL || "bash"] });
    return id;
  }

  test("a data route follows the agent without any re-attach", async () => {
    taskManager.setCwdRefreshWindow(0);
    const id = await taskInThisRepo("moves");
    const before = (await resolveTaskRoot(id)) as { cwd: string };
    expect(before.cwd).toBe(process.cwd());

    // The agent cd's somewhere else inside the same repository. Nobody
    // re-attaches, nobody switches task — the user just clicks Changes.
    taskManager.primaryPty(id)!.write(`cd ${process.cwd()}/src\n`);

    let followed = false;
    for (let i = 0; i < 40 && !followed; i++) {
      await Bun.sleep(50);
      followed = ((await resolveTaskRoot(id)) as { cwd: string }).cwd.endsWith("/src");
    }
    expect(followed).toBe(true);
  });

  test("and does not ask the terminal again on every request", async () => {
    taskManager.setCwdRefreshWindow(0);
    const id = await taskInThisRepo("throttled");
    await resolveTaskRoot(id);

    // From here the answer is trusted for the window's duration, however many
    // requests the diff view makes.
    taskManager.setCwdRefreshWindow(60_000);
    await resolveTaskRoot(id);
    taskManager.primaryPty(id)!.write(`cd ${process.cwd()}/src\n`);
    await Bun.sleep(400);

    const stale = (await resolveTaskRoot(id)) as { cwd: string };
    expect(stale.cwd).toBe(process.cwd());

    // And is asked again once the window is over.
    taskManager.setCwdRefreshWindow(0);
    for (let i = 0; i < 40; i++) {
      if (((await resolveTaskRoot(id)) as { cwd: string }).cwd.endsWith("/src")) return;
      await Bun.sleep(50);
    }
    throw new Error("the directory was never picked up again");
  });

  test("a task with no terminal costs nothing and still answers", async () => {
    taskManager.setCwdRefreshWindow(0);
    row("parked-here", { repo_root: "/repo", cwd: "/repo/sub", lifecycle: "suspended" });

    expect(await resolveTaskRoot("parked-here")).toEqual({ repoRoot: "/repo", cwd: "/repo/sub" });
  });
});
