import { test, expect, describe, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import * as fs from "fs";
import * as path from "path";
import { applyMigrations } from "../db";
import { TaskStore } from "./store";
import { NotArchivedError, TaskManager } from "./manager";
import { wipRefFor } from "../worktree";
import { cleanupRepos, git, tempProject, tempRepo } from "../../../test/git-repo";

// The pairings of concurrent lifecycle calls on one task that no other file
// covers (TASK-152). Resume, suspend, evict, archive and unarchive each keep an
// in-flight entry per task, and each one either joins the same operation,
// waits out another one and starts over, or refuses at the door. These pin
// down which, for every pairing not already tested beside its operation in
// resume, worktree, archive, unarchive and harvester tests, so that moving the
// five maps out of TaskManager can be shown to change nothing.
//
// Every call below registers its in-flight entry before its first await, so
// starting the second call straight after the first is enough to land it
// inside the first's window. The fake agent from `test/preload.ts` stands in
// for every task; it sends no hooks, so the resume ladder settles on its
// start cap, shortened here.

const managers: TaskManager[] = [];

afterEach(async () => {
  for (const m of managers) {
    for (const task of [...m.listTasks(), ...m.listArchivedTasks()]) await m.deleteTask(task.id);
  }
  managers.length = 0;
  cleanupRepos();
});

async function setup() {
  const { root } = await tempRepo();
  const db = new Database(":memory:");
  applyMigrations(db);
  const manager = new TaskManager(db);
  managers.push(manager);
  manager.setStartTimeout(200);
  const { id: projectId } = tempProject(root);
  manager.createProject(projectId, "Lifecycle pairs", root);
  return { root, manager, store: new TaskStore(db), projectId };
}

/** A live task in a checkout of its own, holding an untracked file. */
async function liveTask(manager: TaskManager, projectId: string) {
  const id = `t-${crypto.randomUUID()}`;
  const row = await manager.createTask({ id, projectId, prompt: "pairs", worktree: true, baseRef: "main" });
  fs.writeFileSync(path.join(row.worktree_path!, "scratch.txt"), "the user's work\n");
  return { id, worktree: row.worktree_path! };
}

/** The same, closed: suspended with its checkout still present, which is what
 * an eviction needs. */
async function suspendedTask(manager: TaskManager, projectId: string) {
  const task = await liveTask(manager, projectId);
  expect(await manager.closeTask(task.id)).toBe(true);
  return task;
}

/** Count the snapshots a suspend takes, through the instance, as the harvester
 * tests do. */
function countSnapshots(manager: TaskManager): () => number {
  const original = manager.snapshot.bind(manager);
  let calls = 0;
  (manager as any).snapshot = async (taskId: string) => {
    calls++;
    return original(taskId);
  };
  return () => calls;
}

describe("resume against a suspend in flight", () => {
  test("a resume started during a close waits for it, then resumes the closed task", async () => {
    const { manager, store, projectId } = await setup();
    const { id } = await liveTask(manager, projectId);
    const before = manager.primaryPty(id)!.id;

    const closing = manager.closeTask(id);
    const resuming = manager.resumeTask(id);

    expect(await closing).toBe(true);
    const resumed = (await resuming)!;
    expect(resumed.lifecycle).toBe("live");
    expect(store.get(id)!.lifecycle).toBe("live");
    // A new agent, not the one the close killed.
    const after = manager.primaryPty(id)!;
    expect(after.id).not.toBe(before);
    expect(after.exited).toBe(false);
  }, 30000);
});

describe("suspend against a suspend in flight", () => {
  test("a second close joins the first rather than snapshotting twice", async () => {
    const { manager, store, projectId } = await setup();
    const { id } = await liveTask(manager, projectId);
    const snapshots = countSnapshots(manager);

    const [a, b] = await Promise.all([manager.closeTask(id), manager.closeTask(id)]);

    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(snapshots()).toBe(1);
    expect(store.get(id)!.lifecycle).toBe("suspended");
  }, 30000);

  // The other direction from the harvester's own test: a harvest behind a
  // close gets the suspension it wanted, so it adopts the close's verdict
  // without asking its predicate.
  test("a harvest arriving during a close joins it without asking its own guard", async () => {
    const { manager, store, projectId } = await setup();
    const { id } = await liveTask(manager, projectId);
    const snapshots = countSnapshots(manager);
    let asked = 0;

    const closing = manager.closeTask(id);
    const harvesting = manager.harvestTask(id, () => {
      asked++;
      return false;
    });

    expect(await closing).toBe(true);
    expect(await harvesting).toBe(true);
    expect(asked).toBe(0);
    expect(snapshots()).toBe(1);
    expect(store.get(id)!.lifecycle).toBe("suspended");
  }, 30000);
});

describe("evict against archive and unarchive in flight", () => {
  test("an eviction refuses while an archive is in flight", async () => {
    const { manager, store, projectId } = await setup();
    const { id, worktree } = await suspendedTask(manager, projectId);

    const archiving = manager.archiveTask(id);
    expect(await manager.evictTask(id)).toBe(false);

    expect(await archiving).not.toBeNull();
    expect(store.get(id)!.lifecycle).toBe("archived");
    expect(fs.existsSync(worktree)).toBe(false);
  }, 30000);

  test("an eviction refuses while an unarchive is in flight", async () => {
    const { manager, store, projectId } = await setup();
    const { id, worktree } = await liveTask(manager, projectId);
    expect(await manager.archiveTask(id)).not.toBeNull();

    const unarchiving = manager.unarchiveTask(id);
    expect(await manager.evictTask(id)).toBe(false);

    expect((await unarchiving)!.lifecycle).toBe("live");
    expect(store.get(id)!.worktree_state).toBe("present");
    expect(fs.readFileSync(path.join(worktree, "scratch.txt"), "utf8")).toBe("the user's work\n");
  }, 30000);
});

describe("archive against an eviction or another archive in flight", () => {
  test("an archive waits for an eviction in flight, then archives the evicted task", async () => {
    const { root, manager, store, projectId } = await setup();
    const { id, worktree } = await suspendedTask(manager, projectId);

    const evicting = manager.evictTask(id);
    const archiving = manager.archiveTask(id);

    expect(await evicting).toBe(true);
    const outcome = (await archiving)!;
    expect(outcome).not.toBeNull();
    expect(store.get(id)!.lifecycle).toBe("archived");
    expect(fs.existsSync(worktree)).toBe(false);
    // The work the eviction snapshotted survives the archive.
    expect(await git(root, "show", `${wipRefFor(id)}:scratch.txt`)).toBe("the user's work");
  }, 30000);

  test("a second archive joins the first", async () => {
    const { manager, store, projectId } = await setup();
    const { id } = await liveTask(manager, projectId);

    const first = manager.archiveTask(id);
    const second = manager.archiveTask(id);

    const outcome = await first;
    expect(outcome).not.toBeNull();
    expect(await second).toBe(outcome);
    expect(store.get(id)!.lifecycle).toBe("archived");
  }, 30000);
});

describe("unarchive against an eviction or a resume in flight", () => {
  test("an unarchive during an eviction waits for it, then refuses a task that is not archived", async () => {
    const { manager, store, projectId } = await setup();
    const { id } = await suspendedTask(manager, projectId);

    const evicting = manager.evictTask(id);
    const unarchiving = manager.unarchiveTask(id);

    expect(await evicting).toBe(true);
    await expect(unarchiving).rejects.toBeInstanceOf(NotArchivedError);
    expect(store.get(id)!.lifecycle).toBe("suspended");
    expect(store.get(id)!.worktree_state).toBe("evicted");
  }, 30000);

  test("an unarchive during a resume waits for it, then refuses a task that is not archived", async () => {
    const { manager, store, projectId } = await setup();
    const { id } = await suspendedTask(manager, projectId);

    const resuming = manager.resumeTask(id);
    const unarchiving = manager.unarchiveTask(id);

    expect((await resuming)!.lifecycle).toBe("live");
    await expect(unarchiving).rejects.toBeInstanceOf(NotArchivedError);
    expect(store.get(id)!.lifecycle).toBe("live");
  }, 30000);
});
