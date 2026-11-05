import { test, expect, describe, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import * as fs from "fs";
import * as path from "path";
import { applyMigrations } from "../db";
import { TaskStore } from "./store";
import { NotArchivedError, TaskManager } from "./manager";
import { readWip, wipRefFor } from "../worktree";
import { cleanupRepos, git, tempProject, tempRepo } from "../../../test/git-repo";

// Archive's way back (TASK-139), at the manager: the parts the route tests in
// `api/tasks.test.ts` cannot reach — the serialization against archive, and
// what is left behind when the restore fails after the row has been flipped.
//
// The fake agent from `test/preload.ts` stands in for every task. It sends no
// hooks, so the resume ladder settles on its start cap, shortened here.

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
  manager.createProject(projectId, "Unarchive project", root);
  return { root, manager, store: new TaskStore(db), projectId };
}

/** An archived task whose snapshot holds an untracked file. No commits of its
 * own, so its branch is merged into `main` and the archive deletes it — the
 * case where unarchive has the most to do. */
async function archivedTask(manager: TaskManager, projectId: string) {
  const id = `t-${crypto.randomUUID()}`;
  const row = await manager.createTask({ id, projectId, prompt: "come back", worktree: true, baseRef: "main" });
  const worktree = row.worktree_path!;
  fs.writeFileSync(path.join(worktree, "scratch.txt"), "the user's work\n");
  expect(await manager.archiveTask(id)).not.toBeNull();
  return { id, branch: row.branch!, worktree };
}

describe("unarchiving", () => {
  test("a task that is not there answers null, and one that is not archived refuses", async () => {
    const { manager, projectId } = await setup();
    expect(await manager.unarchivePreview("t-nobody")).toBeNull();
    expect(await manager.unarchiveTask("t-nobody")).toBeNull();

    const id = `t-${crypto.randomUUID()}`;
    await manager.createTask({ id, projectId, prompt: "still live" });
    expect(await manager.unarchivePreview(id)).toBeNull();
    await expect(manager.unarchiveTask(id)).rejects.toBeInstanceOf(NotArchivedError);
  }, 20000);

  // Two browsers confirming one dialog. Racing would have both see the branch
  // missing and both try to recreate it, and both walk a ladder.
  test("a second unarchive joins the first", async () => {
    const { root, manager, store, projectId } = await setup();
    const { id, branch, worktree } = await archivedTask(manager, projectId);

    const first = manager.unarchiveTask(id);
    const second = manager.unarchiveTask(id);

    const [a, b] = await Promise.all([first, second]);
    expect(a!.lifecycle).toBe("live");
    expect(b!.lifecycle).toBe("live");
    expect(store.get(id)!.lifecycle).toBe("live");
    expect(manager.taskPtyList(id)).toHaveLength(1);
    expect(await git(root, "branch", "--list", branch)).toContain(branch);
    expect(fs.readFileSync(path.join(worktree, "scratch.txt"), "utf8")).toBe("the user's work\n");
  }, 30000);

  // The damaging order: an archive between the lifecycle flip and the resume
  // would remove the checkout the ladder is about to rebuild, and the ladder
  // would then write `live` back over the `archived`.
  test("an archive started during an unarchive waits, then archives what it produced", async () => {
    const { root, manager, store, projectId } = await setup();
    const { id, worktree } = await archivedTask(manager, projectId);

    const unarchiving = manager.unarchiveTask(id);
    const archiving = manager.archiveTask(id);

    const resumed = (await unarchiving)!;
    expect(resumed.lifecycle).toBe("live");
    expect(resumed.worktree_state).toBe("present");

    const outcome = (await archiving)!;
    expect(outcome).not.toBeNull();
    expect(store.get(id)!.lifecycle).toBe("archived");
    expect(manager.taskPtyList(id)).toHaveLength(0);
    expect(fs.existsSync(worktree)).toBe(false);
    // And the work went back into a snapshot on the way out, not lost between
    // the two.
    expect(outcome.wipRef).toBe(wipRefFor(id));
    expect(await git(root, "show", `${wipRefFor(id)}:scratch.txt`)).toBe("the user's work");
  }, 30000);

  test("an unarchive started during an archive waits, then unarchives", async () => {
    const { manager, store, projectId } = await setup();
    const id = `t-${crypto.randomUUID()}`;
    const row = await manager.createTask({ id, projectId, prompt: "both ways", worktree: true, baseRef: "main" });
    fs.writeFileSync(path.join(row.worktree_path!, "scratch.txt"), "kept\n");

    const archiving = manager.archiveTask(id);
    const unarchiving = manager.unarchiveTask(id);

    expect(await archiving).not.toBeNull();
    expect((await unarchiving)!.lifecycle).toBe("live");
    expect(store.get(id)!.worktree_state).toBe("present");
    expect(fs.readFileSync(path.join(row.worktree_path!, "scratch.txt"), "utf8")).toBe("kept\n");
  }, 30000);

  // A failure after the flip leaves the task where an evicted task rests, with
  // everything needed to try again: the branch recreated, the snapshot kept.
  // Not flipped back to archived — that is what would put the work back on the
  // retention sweep's timer.
  test("a restore that fails leaves the task suspended and evicted, with its work kept", async () => {
    const { root, manager, store, projectId } = await setup();
    const { id, branch, worktree } = await archivedTask(manager, projectId);
    // Something in the way at the task's fixed path: the restore stops at
    // `assertPathFree`, after the unarchive has recreated the branch.
    fs.mkdirSync(worktree, { recursive: true });
    fs.writeFileSync(path.join(worktree, "squatter.txt"), "not ours\n");
    const rankBefore = store.get(id)!.rank_at;
    const asked = Date.now();

    await expect(manager.unarchiveTask(id)).rejects.toMatchObject({ kind: "path-occupied" });

    const after = store.get(id)!;
    expect(after.lifecycle).toBe("suspended");
    // Ranked at the flip, not left at its pre-archive place: the resume that
    // would have ranked it never got that far.
    expect(after.rank_at).toBeGreaterThanOrEqual(asked);
    expect(after.rank_at).toBeGreaterThanOrEqual(rankBefore);
    expect(after.worktree_state).toBe("evicted");
    expect(after.wip_ref).toBe(wipRefFor(id));
    expect(await readWip(root, id)).not.toBeNull();
    expect(await git(root, "branch", "--list", branch)).toContain(branch);
    expect(manager.listTasks().some((t) => t.id === id)).toBe(true);

    // And it really is just an evicted task: clear the way and open it.
    fs.rmSync(worktree, { recursive: true, force: true });
    expect((await manager.resumeTask(id))!.lifecycle).toBe("live");
    expect(fs.readFileSync(path.join(worktree, "scratch.txt"), "utf8")).toBe("the user's work\n");
  }, 30000);

  // The restore's own guard, read ahead of time: the user committed to the
  // branch after the archive, so the snapshot's parent is stale and applying
  // it would write old files over the new commit.
  test("a branch that moved since the archive is reported stale, and the snapshot is held back", async () => {
    const { root, manager, store, projectId } = await setup();
    const id = `t-${crypto.randomUUID()}`;
    const row = await manager.createTask({ id, projectId, prompt: "moved", worktree: true, baseRef: "main" });
    const worktree = row.worktree_path!;
    fs.writeFileSync(path.join(worktree, "one.txt"), "1\n");
    await git(worktree, "add", "-A");
    await git(worktree, "commit", "-qm", "keeps the branch");
    fs.writeFileSync(path.join(worktree, "scratch.txt"), "dirt\n");
    await manager.archiveTask(id);
    // Moved from the repository's own checkout, the way a user would.
    await git(root, "branch", "-f", row.branch!, "main");

    const preview = (await manager.unarchivePreview(id))!;
    expect(preview.checkout).toBe("restore");
    expect(preview.snapshot).toMatchObject({ state: "kept", stale: true });

    expect((await manager.unarchiveTask(id))!.lifecycle).toBe("live");
    // Held back, and owed a decision — the ordinary stale-snapshot state.
    expect(fs.existsSync(path.join(worktree, "scratch.txt"))).toBe(false);
    expect(store.get(id)!.wip_ref).toBe(wipRefFor(id));
    expect(manager.taskInfo(id)!.wipPending).toBe(true);
  }, 30000);
});
