import { test, expect, describe, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { applyMigrations } from "../db";
import { TaskStore } from "./store";
import { TaskManager, WIP_RETENTION_MS } from "./manager";
import { gitSpawn } from "../../api/utils";
import { taskDir } from "../agent/spawn";
import { readWip, wipRefFor, worktreesRoot } from "../worktree";
import { waitFor } from "../../../test/wait";

// The only way a task leaves (docs/v2-architecture.md §5.6, TASK-31 AC #7).
//
// `status.ts` and `wip.ts` are tested on their own against bare temporary
// repositories; what is left here is the sequence, which is the part that can
// only be wrong once: archive reads the branch facts while there is still a
// checkout to read them from, snapshots unconditionally, removes the directory,
// and only then decides about the branch. Every assertion below is about
// something that no longer exists by the time the call returns, so it is asked
// of git and of the disk rather than of the outcome object alone.
//
// Nothing stands in an agent: `test/preload.ts` points `CODETOASTER_AGENT_BIN`
// at a harmless one before every test, and these tests deliberately do not use
// `command:` — a task created that way writes no settings.json, so AC #8's
// claim about `~/.codetoaster/tasks/<id>/` would be about an empty directory.

const managers: TaskManager[] = [];
const tempDirs: string[] = [];
const projectIds: string[] = [];
const taskIds: string[] = [];

afterEach(async () => {
  for (const m of managers) {
    // `deleteTask` is the destructive path this file is partly about, and the
    // promise it answers with is the git — so it is awaited here rather than
    // dropped, or the `rm`s below race a `git worktree remove` still running.
    for (const task of m.listTasks()) await m.deleteTask(task.id);
  }
  managers.length = 0;
  // The worktrees land under the real `~/.codetoaster`, as they will at run
  // time, so every project invented here takes its tree with it.
  for (const id of projectIds.splice(0)) {
    fs.rmSync(path.join(worktreesRoot(), id), { recursive: true, force: true });
  }
  for (const id of taskIds.splice(0)) fs.rmSync(taskDir(id), { recursive: true, force: true });
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

async function git(dir: string, ...args: string[]): Promise<string> {
  const { stdout, stderr, exitCode } = await gitSpawn(dir, args, { captureStderr: true });
  if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
  return stdout.trim();
}

/** A repository with `main` and a second branch, so "branched from the ref we
 * asked for" is distinguishable from "branched from HEAD". */
async function tempRepo(): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-archive-repo-"));
  tempDirs.push(root);
  await git(root, "init", "-b", "main");
  await git(root, "config", "user.email", "t@example.com");
  await git(root, "config", "user.name", "T");
  fs.writeFileSync(path.join(root, "README.md"), "main\n");
  await git(root, "add", "-A");
  await git(root, "commit", "-m", "first");
  await git(root, "branch", "release");
  return root;
}

/** Somewhere to push to. Bare, because the only question asked of it is
 * whether it still holds the branch after the archive (AC #4), and a
 * non-bare remote refuses a push to its checked-out branch for reasons that
 * have nothing to do with what is under test. */
async function bareRemote(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-archive-remote-"));
  tempDirs.push(dir);
  await git(dir, "init", "--bare", "-b", "main");
  return dir;
}

interface Settings {
  worktreeDefault?: boolean;
  defaultBaseRef?: string | null;
  setupCommand?: string | null;
  worktreeCopy?: string | null;
}

async function newManager(root: string, settings: Settings = {}) {
  const db = new Database(":memory:");
  applyMigrations(db);
  const manager = new TaskManager(db);
  managers.push(manager);
  const projectId = `proj-${crypto.randomUUID()}`;
  projectIds.push(projectId);
  manager.createProject(projectId, "Test project", root);
  if (Object.keys(settings).length > 0) {
    manager.updateProject(projectId, "Test project", root, settings);
  }
  return { manager, store: new TaskStore(db), projectId };
}

function taskId(): string {
  const id = `t-${crypto.randomUUID()}`;
  taskIds.push(id);
  return id;
}

/** A task with a checkout of its own, branched from `main` so `merged` has a
 * base ref to be an ancestor of. */
async function worktreeTask(manager: TaskManager, projectId: string, prompt = "do a thing") {
  const id = taskId();
  const row = await manager.createTask({ id, projectId, prompt, worktree: true, baseRef: "main" });
  return { id, row, branch: row.branch!, worktree: row.worktree_path! };
}

/** Commit in the *checkout*, which is where a task's work happens — committing
 * the same content from the repo root would move the branch without ever
 * putting the file in front of the code under test. */
async function commitInWorktree(dir: string, file: string, content: string, message: string) {
  fs.writeFileSync(path.join(dir, file), content);
  await git(dir, "add", "-A");
  await git(dir, "commit", "-qm", message);
}

describe("archiving a task whose commits are already safe", () => {
  // AC #1, #2, #3 and #8 in one pass, because they are one pass: everything
  // asserted here is about state that exists only until the call returns.
  test("takes the checkout, the branch and the task's files, and keeps the row", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root);
    const { id, row, branch, worktree } = await worktreeTask(manager, projectId, "merged work");
    await commitInWorktree(worktree, "feature.txt", "done\n", "the work");
    // A genuine ancestor of the base ref, which is the only thing that makes
    // the branch expendable — not the archive's own opinion of it.
    await git(root, "merge", "--no-ff", "-q", "-m", "merge the task", branch);
    expect(fs.existsSync(taskDir(id))).toBe(true);

    const outcome = (await manager.archiveTask(id))!;

    expect(outcome.status!.merged).toBe(true);
    expect(outcome.branchDeleted).toBe(true);
    expect(outcome.branchKept).toBeNull();
    expect(await git(root, "branch", "--list", branch)).toBe("");
    expect(fs.existsSync(worktree)).toBe(false);
    // Not only the directory: git's registration under `.git/worktrees` is what
    // makes a repository accumulate checkouts nothing will ever name again.
    expect(await git(root, "worktree", "list", "--porcelain")).not.toContain(id);

    const after = store.get(id)!;
    expect(after.lifecycle).toBe("archived");
    // `evicted`, not `none`: the path is remembered and the directory is gone,
    // which is exactly what that state means. `none` would read as a task there
    // was never anything to clean up for.
    expect(after.worktree_state).toBe("evicted");
    expect(manager.listTasks().some((t) => t.id === id)).toBe(false);
    // AC #8. `closeTask` leaves this standing on purpose; archive is where it
    // finally goes, and nothing resumes an archived task.
    expect(fs.existsSync(taskDir(id))).toBe(false);

    // AC #1's second half. The tree was clean — everything was committed and
    // merged — and there is a snapshot anyway, because a ref written only for a
    // dirty tree would collapse "nothing to save" and "we never got to it".
    expect(outcome.wipRef).toBe(wipRefFor(id));
    expect(await readWip(root, id)).not.toBeNull();
    expect(row.base_ref).toBe("main");
  }, 20000);

  // AC #1's first half. Archive is every other operation in sequence, and the
  // first of them is the ordinary close: a live task has an agent inside the
  // directory about to be removed.
  test("closes a live task on the way through", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root);
    const { id } = await worktreeTask(manager, projectId, "still working");
    expect(await waitFor(() => manager.taskPtyList(id).length > 0, 5000)).toBe(true);
    expect(store.get(id)!.lifecycle).toBe("live");

    await manager.archiveTask(id);

    // Suspended through `suspendTask` rather than by the archive's own hand, so
    // every terminal the task held is gone, not just the agent's.
    expect(manager.taskPtyList(id)).toHaveLength(0);
    expect(store.get(id)!.lifecycle).toBe("archived");
  }, 20000);

  // Two browsers can be showing the same confirmation. The second answer has
  // nothing left to describe and nothing left to destroy, and null says so
  // without a throw the caller would have to distinguish from a real failure.
  test("archiving twice answers null and changes nothing", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root);
    const { id, branch, worktree } = await worktreeTask(manager, projectId, "twice over");
    await commitInWorktree(worktree, "feature.txt", "unmerged\n", "the work");

    expect(await manager.archiveTask(id)).not.toBeNull();
    const branchAfterFirst = await git(root, "rev-parse", branch);

    expect(await manager.archiveTask(id)).toBeNull();
    expect(await git(root, "rev-parse", branch)).toBe(branchAfterFirst);
    expect(store.get(id)!.lifecycle).toBe("archived");
  }, 20000);
});

describe("archiving a branch that still holds commits", () => {
  // AC #3. The default leans towards keeping: a ref costs nothing next to
  // losing commits, and the sentence is the point — "kept" on its own reads as
  // a failure to clean up.
  test("keeps the branch, removes the checkout anyway, and says why", async () => {
    const root = await tempRepo();
    const { manager, projectId } = await newManager(root);
    const { id, branch, worktree } = await worktreeTask(manager, projectId, "unfinished");
    await commitInWorktree(worktree, "one.txt", "1\n", "first");
    await commitInWorktree(worktree, "two.txt", "2\n", "second");

    const outcome = (await manager.archiveTask(id))!;

    expect(outcome.status!.merged).toBe(false);
    expect(outcome.status!.pushed).toBe(false);
    // Bounded by the base ref, so a repository with no remote reports the two
    // commits on the branch rather than its whole history.
    expect(outcome.status!.unpushed).toBe(2);
    expect(outcome.branchDeleted).toBe(false);
    expect(outcome.branchKept).toContain(branch);
    // The count is what tells the user what to do next.
    expect(outcome.branchKept).toContain("2 commits");
    expect(await git(root, "rev-parse", "--verify", branch)).toBeTruthy();
    // The branch decision does not reach the directory: the checkout is a
    // materialized cache either way, and the branch is what was kept.
    expect(fs.existsSync(worktree)).toBe(false);
  }, 20000);

  // AC #3's other half and AC #4 together. Pushed is not merged, and it is
  // still enough — the commits have somewhere else to live — but "somewhere
  // else" is a remote this code is never allowed to touch.
  test("deletes an unmerged branch that is on a remote, and leaves the remote alone", async () => {
    const root = await tempRepo();
    const remote = await bareRemote();
    const { manager, projectId } = await newManager(root);
    await git(root, "remote", "add", "origin", remote);
    const { id, branch, worktree } = await worktreeTask(manager, projectId, "pushed work");
    await commitInWorktree(worktree, "feature.txt", "shared\n", "the work");
    await git(worktree, "push", "-q", "origin", branch);
    // So there is a `refs/remotes/origin/*` to be contained in: `isPushed` asks
    // about remote-tracking refs and not about `@{u}`, since a branch we made
    // has no upstream unless the user configured one themselves.
    await git(root, "fetch", "-q", "origin");

    const outcome = (await manager.archiveTask(id))!;

    expect(outcome.status!.merged).toBe(false);
    expect(outcome.status!.pushed).toBe(true);
    expect(outcome.branchDeleted).toBe(true);
    expect(await git(root, "branch", "--list", branch)).toBe("");
    // AC #4. The local ref is ours to delete; the remote's is the user's, and
    // deleting it is not something an archive is ever asked to do.
    expect(await git(root, "ls-remote", remote, `refs/heads/${branch}`)).not.toBe("");
  }, 20000);
});

describe("the work an archive takes with it", () => {
  // AC #5. `dirty` is a `git status` in a directory the archive is about to
  // delete, so the number has to be taken on the way past or not at all — and
  // it is the number a confirmation prints back to the user.
  test("reports the dirt it found and puts it in a commit that outlives the checkout", async () => {
    const root = await tempRepo();
    const { manager, projectId } = await newManager(root);
    const { id, worktree } = await worktreeTask(manager, projectId, "dirty work");
    fs.writeFileSync(path.join(worktree, "README.md"), "modified\n");
    fs.writeFileSync(path.join(worktree, "scratch.txt"), "untracked\n");

    const outcome = (await manager.archiveTask(id))!;

    expect(outcome.status!.dirty).toBe(2);
    expect(fs.existsSync(worktree)).toBe(false);

    // A ref existing proves only that something was written. What makes the
    // archive recoverable is that the *files* are in the commit it points at —
    // the modification and the untracked file both, since `git add -A` into a
    // throwaway index is what stages the second one.
    const wip = (await readWip(root, id))!;
    expect(wip).not.toBeNull();
    expect(await git(root, "show", `${wip.commit}:README.md`)).toBe("modified");
    expect(await git(root, "show", `${wip.commit}:scratch.txt`)).toBe("untracked");
    expect(await git(root, "rev-parse", wipRefFor(id))).toBe(wip.commit);
  }, 20000);

  // A task can already be holding a snapshot when it is archived: a restore
  // that refused to apply one leaves the ref set on a *present* checkout, which
  // is the user's outstanding apply/keep/discard. Snapshotting over it would
  // answer that question by destroying the commit it was about.
  test("a snapshot the task already owed a decision on is the archive's snapshot", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root);
    const { id, worktree } = await worktreeTask(manager, projectId, "owes a decision");
    fs.writeFileSync(path.join(worktree, "README.md"), "the user's work\n");
    await manager.closeTask(id);
    expect(await manager.snapshotTaskWip(id)).not.toBeNull();
    const owed = (await readWip(root, id))!.commit;
    expect(store.get(id)!.worktree_state).toBe("present");
    // The tree moves on after the snapshot, so a second one would be a
    // different commit and this test could not pass by coincidence.
    fs.writeFileSync(path.join(worktree, "README.md"), "written afterwards\n");

    const outcome = (await manager.archiveTask(id))!;

    expect(outcome.wipRef).toBe(wipRefFor(id));
    expect((await readWip(root, id))!.commit).toBe(owed);
    // Restamped even so: retention runs from the archive, because that is when
    // the user was told they had N days.
    expect(store.get(id)!.wip_at).not.toBeNull();
  }, 20000);
});

describe("archiving a task with no checkout of its own", () => {
  // The case where nothing is ours to destroy. A task without a worktree runs
  // in the project's own directory, where the branch is the user's, the working
  // state is the user's, and the only thing archive owns is the row and
  // `~/.codetoaster/tasks/<id>/`.
  test("leaves the project's directory alone and still archives the row", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root);
    const id = taskId();
    const row = await manager.createTask({ id, projectId, prompt: "in the project" });
    expect(row.worktree_state).toBe("none");
    expect(row.cwd).toBe(root);

    const outcome = (await manager.archiveTask(id))!;

    expect(outcome.status).toBeNull();
    expect(outcome.branch).toBeNull();
    expect(outcome.branchDeleted).toBe(false);
    expect(outcome.wipRef).toBeNull();

    const after = store.get(id)!;
    expect(after.lifecycle).toBe("archived");
    // Deliberately *not* rewritten to `evicted`. There was never a checkout, so
    // saying one was evicted would claim a directory had been reclaimed that
    // never existed — and would make this row indistinguishable from a task
    // whose worktree really was removed.
    expect(after.worktree_state).toBe("none");

    // Nothing of the user's was touched, and no snapshot was taken of a tree
    // that is not ours to commit.
    expect(fs.existsSync(root)).toBe(true);
    expect(fs.readFileSync(path.join(root, "README.md"), "utf8")).toBe("main\n");
    expect(await git(root, "status", "--porcelain")).toBe("");
    expect(await readWip(root, id)).toBeNull();
    // The one thing that is ours goes anyway (AC #8).
    expect(fs.existsSync(taskDir(id))).toBe(false);
  }, 20000);
});

describe("previewing an archive", () => {
  // The dialog states what the button will do, and the two are the same code
  // over the same row precisely so they cannot disagree for any reason except
  // time passing between them.
  test("says what archive then does about the branch", async () => {
    const root = await tempRepo();
    const { manager, projectId } = await newManager(root);
    const { id, worktree } = await worktreeTask(manager, projectId, "not merged yet");
    await commitInWorktree(worktree, "one.txt", "1\n", "first");

    const preview = (await manager.archivePreview(id))!;
    expect(preview.branchWouldBeDeleted).toBe(false);
    expect(preview.status!.merged).toBe(false);
    expect(preview.status!.unpushed).toBe(1);
    // Read-only: a preview that removed the checkout it was describing would be
    // the confirmation performing the thing it is asking about.
    expect(fs.existsSync(worktree)).toBe(true);

    const outcome = (await manager.archiveTask(id))!;
    expect(outcome.branchDeleted).toBe(preview.branchWouldBeDeleted);
    expect(outcome.status!.merged).toBe(preview.status!.merged);
    expect(outcome.status!.unpushed).toBe(preview.status!.unpushed);
  }, 20000);

  test("and says so when the branch is expendable", async () => {
    const root = await tempRepo();
    const { manager, projectId } = await newManager(root);
    const { id, branch, worktree } = await worktreeTask(manager, projectId, "merged already");
    await commitInWorktree(worktree, "one.txt", "1\n", "first");
    await git(root, "merge", "--no-ff", "-q", "-m", "merge the task", branch);

    const preview = (await manager.archivePreview(id))!;

    expect(preview.branch).toBe(branch);
    expect(preview.status!.merged).toBe(true);
    expect(preview.branchWouldBeDeleted).toBe(true);
    expect(fs.existsSync(worktree)).toBe(true);
    expect((await manager.archiveTask(id))!.branchDeleted).toBe(true);
  }, 20000);

  test("a task that is not there has nothing to preview", async () => {
    const root = await tempRepo();
    const { manager } = await newManager(root);

    expect(await manager.archivePreview("t-nobody")).toBeNull();
  }, 20000);
});

// The irreversible one (§5.6). Everything archive keeps — the row, the
// snapshot, the retention window — is what a hard delete is for getting rid of.
describe("hard delete", () => {
  test("takes the row, the checkout, the branch, the ref and the task's files", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root);
    const { id, branch, worktree } = await worktreeTask(manager, projectId, "delete me");
    await commitInWorktree(worktree, "feature.txt", "done\n", "the work");
    await git(root, "merge", "--no-ff", "-q", "-m", "merge the task", branch);
    await manager.closeTask(id);
    // So the ref assertion below is about a ref that existed: a task that was
    // never evicted has nothing under `refs/codetoaster/wip/` to begin with.
    expect(await manager.snapshotTaskWip(id)).not.toBeNull();
    expect(await readWip(root, id)).not.toBeNull();

    const outcome = (await manager.deleteTask(id))!;

    expect(outcome.branchDeleted).toBe(true);
    expect(store.get(id)).toBeUndefined();
    expect(fs.existsSync(worktree)).toBe(false);
    expect(await git(root, "branch", "--list", branch)).toBe("");
    expect(await git(root, "worktree", "list", "--porcelain")).not.toContain(id);
    expect(await readWip(root, id)).toBeNull();
    expect(fs.existsSync(taskDir(id))).toBe(false);
  }, 20000);

  // The rule the whole of `purge` turns on: "the user asked to forget this
  // task" is not the same statement as "the user asked to lose these commits".
  // A ref left under `codetoaster/` costs nothing and is one refspec to remove.
  test("keeps a branch whose commits would go with it, and takes everything else", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root);
    const { id, branch, worktree } = await worktreeTask(manager, projectId, "unmerged delete");
    await commitInWorktree(worktree, "one.txt", "1\n", "the only copy");

    const outcome = (await manager.deleteTask(id))!;

    expect(outcome.branchDeleted).toBe(false);
    expect(outcome.branchKept).toContain(branch);
    expect(outcome.branchKept).toContain("1 commit");
    expect(await git(root, "rev-parse", "--verify", branch)).toBeTruthy();
    // Everything that is not a commit still goes.
    expect(store.get(id)).toBeUndefined();
    expect(fs.existsSync(worktree)).toBe(false);
    expect(fs.existsSync(taskDir(id))).toBe(false);
  }, 20000);

  test("a task that is not there answers null", async () => {
    const root = await tempRepo();
    const { manager } = await newManager(root);

    expect(await manager.deleteTask("t-nobody")).toBeNull();
  }, 20000);
});

// AC #6's second half: the snapshot that makes archiving recoverable is kept
// for a window and then swept, once, on the boot path.
describe("the retention window", () => {
  test("expires an archived task's snapshot once the window has passed", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root);
    const { id } = await worktreeTask(manager, projectId, "long archived");
    await manager.archiveTask(id);
    store.update(id, { wip_at: Date.now() - WIP_RETENTION_MS - 1 });

    expect(await manager.expireArchivedWip()).toBe(1);

    // The ref is the only thing keeping the snapshot's objects reachable, so
    // dropping it is the whole of the expiry — and the columns go with it, or
    // the row would keep naming a ref that is not there.
    expect(await readWip(root, id)).toBeNull();
    expect(store.get(id)!.wip_ref).toBeNull();
    expect(store.get(id)!.wip_at).toBeNull();
  }, 20000);

  test("leaves one still inside it", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root);
    const { id } = await worktreeTask(manager, projectId, "just archived");
    await manager.archiveTask(id);

    expect(await manager.expireArchivedWip()).toBe(0);

    expect(await readWip(root, id)).not.toBeNull();
    expect(store.get(id)!.wip_ref).toBe(wipRefFor(id));
  }, 20000);

  // The most important one in this file. A suspended task's `wip_ref` is not a
  // grace period, it is where its uncommitted work is *stored* — the evict tier
  // removed the directory on the strength of it. Sweeping by age without asking
  // the lifecycle would delete a user's work on a timer, which is the one thing
  // this design exists never to do.
  test("never expires a suspended task's snapshot, however old", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root);
    const { id, worktree } = await worktreeTask(manager, projectId, "resting");
    fs.writeFileSync(path.join(worktree, "README.md"), "uncommitted\n");
    await manager.closeTask(id);
    expect(await manager.evictTask(id)).toBe(true);
    expect(store.get(id)!.lifecycle).toBe("suspended");
    expect(store.get(id)!.worktree_state).toBe("evicted");
    // A year past any retention window, and the checkout is already gone: the
    // ref is all there is.
    store.update(id, { wip_at: Date.now() - 365 * 24 * 60 * 60_000 });

    expect(await manager.expireArchivedWip()).toBe(0);

    expect(store.get(id)!.wip_ref).toBe(wipRefFor(id));
    expect(await readWip(root, id)).not.toBeNull();
    expect(await git(root, "show", `${wipRefFor(id)}:README.md`)).toBe("uncommitted");
  }, 20000);

  // Off, the way the harvester's two tiers are turned off — same argument, so
  // the same sentinel rather than a second convention to remember.
  test("a retention of zero keeps every snapshot forever", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root);
    const { id } = await worktreeTask(manager, projectId, "kept forever");
    await manager.archiveTask(id);
    store.update(id, { wip_at: Date.now() - WIP_RETENTION_MS - 1 });

    expect(await manager.expireArchivedWip(0)).toBe(0);

    expect(await readWip(root, id)).not.toBeNull();
    expect(store.get(id)!.wip_ref).toBe(wipRefFor(id));
  }, 20000);
});

// The two ways archive can collide with something else holding the same
// checkout. Neither is reachable by reading the row: `worktree_state` and
// `lifecycle` both say, for a whole operation, what they say at rest.
//
// The first pair is deterministic without any hook into the implementation —
// `resumeTask` and `archiveTask` each register themselves before their first
// await, so the call that starts second always sees the first. The second pair
// widens the window instead, for the reason worktree.test.ts's eviction pair
// gives: a discard fired the instant the archive starts is refused for having
// no ref to drop yet, not for the reason under test, which is how a version of
// this test passes with the guard taken out.
describe("archiving cannot collide with what is holding the checkout", () => {
  /** A task at rest with its checkout off disk, and the restore that brings it
   * back held open — so a resume started here is unambiguously mid-ladder for
   * long enough to answer the question, rather than for however long git takes
   * on the day. Widened for the reason the snapshot pair below is: an archive
   * fired the instant the resume starts settles the race by whoever wins it,
   * and a test that asserts the winner is asserting the schedule. */
  async function restingTask(manager: TaskManager, projectId: string) {
    const { id, branch, worktree } = await worktreeTask(manager, projectId, "resting");
    fs.writeFileSync(path.join(worktree, "README.md"), "the user's work\n");
    await manager.closeTask(id);
    expect(await manager.evictTask(id)).toBe(true);
    expect(fs.existsSync(worktree)).toBe(false);
    manager.setStartTimeout(200);
    const restore = manager.restoreTaskWorktree.bind(manager);
    (manager as any).restoreTaskWorktree = async (taskId: string) => {
      const result = await restore(taskId);
      await Bun.sleep(500);
      return result;
    };
    return { id, branch, worktree };
  }

  // The damaging order, and the ladder's own state is what hides it: the row
  // says `suspended` for the entire run of a resume and only becomes `live` on
  // the rung that works, so step 1's "is this task live?" answers no for a task
  // somebody is halfway through reopening. Without the wait the archive skips
  // the suspend, removes the directory the restore has just rebuilt and deletes
  // the branch out from under it — and the ladder, still running, writes `live`
  // back over the `archived` this wrote, putting a task with no checkout and no
  // settings directory back in the sidebar.
  test("an archive waits for a resume already in flight, then takes what it produced", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root);
    const { id, worktree } = await restingTask(manager, projectId);

    const resuming = manager.resumeTask(id);
    const archiving = manager.archiveTask(id);

    // The resume ran to completion against a checkout nothing removed under it,
    // which is the whole of what the wait buys: the archive is behind it, not
    // beside it. This is the assertion the bug fails — with the archive running
    // concurrently the directory and the branch are both gone by the time the
    // ladder spawns, so it walks its rungs into nothing and comes back
    // `suspended` with `could_not_resume` on it.
    const resumed = (await resuming)!;
    expect(resumed.lifecycle).toBe("live");
    expect(resumed.worktree_state).toBe("present");
    expect(resumed.agent_state).not.toBe("could_not_resume");

    const outcome = (await archiving)!;
    expect(outcome).not.toBeNull();
    // And what it archived was the *live* task the resume produced — so the
    // checkout was there to be snapshotted, rather than a row that had been
    // evicted since before any of this started.
    expect(outcome.wipRef).toBe(wipRefFor(id));
    expect(await git(root, "show", `${wipRefFor(id)}:README.md`)).toBe("the user's work");

    const after = store.get(id)!;
    // The archive's end state, not the ladder's — `archived`, not the `live`
    // the resume had just written.
    expect(after.lifecycle).toBe("archived");
    expect(manager.listTasks().some((t) => t.id === id)).toBe(false);
    // And the agent the resume spawned went out through `suspendTask`, rather
    // than being left running in a directory that is no longer there.
    expect(manager.taskPtyList(id)).toHaveLength(0);
    expect(fs.existsSync(worktree)).toBe(false);
    expect(fs.existsSync(taskDir(id))).toBe(false);
  }, 30000);

  // The other order, which is the hazard the wait above introduces rather than
  // a second bug: both sides wait, so if either registered itself before
  // looking, the two would wait on each other forever. Neither does — each
  // consults the other's map before entering its own — so whichever starts
  // second finds the first and settles behind it.
  test("a resume started against an archive in flight finds nothing to resume", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root);
    const { id, branch, worktree } = await restingTask(manager, projectId);

    const archiving = manager.archiveTask(id);
    const resuming = manager.resumeTask(id);

    expect(await archiving).not.toBeNull();
    // Undefined rather than a throw: it started over against the row the
    // archive left, and an archived task is not resumable.
    expect(await resuming).toBeUndefined();
    expect(store.get(id)!.lifecycle).toBe("archived");
    // Nothing was rebuilt on the way to finding that out. A resume that ran
    // beside the archive instead of behind it would put the directory back
    // after the removal and spawn an agent into a task nothing can reach.
    expect(fs.existsSync(worktree)).toBe(false);
    expect(manager.taskPtyList(id)).toHaveLength(0);
    expect(await git(root, "branch", "--list", branch)).toBe("");
  }, 30000);

  /** A suspended task with a dirty checkout, and the archive's snapshot held
   * open afterwards — so the row sits in the state that is indistinguishable
   * from a refused snapshot (`present`, with a `wip_ref`) for long enough to
   * ask it something. That is the window itself, not a simulation of it. */
  async function halfArchived(manager: TaskManager, projectId: string) {
    const { id, worktree } = await worktreeTask(manager, projectId, "half archived");
    fs.writeFileSync(path.join(worktree, "README.md"), "the user's work\n");
    await manager.closeTask(id);
    const snapshot = manager.snapshotTaskWip.bind(manager);
    (manager as any).snapshotTaskWip = async (taskId: string) => {
      const result = await snapshot(taskId);
      await Bun.sleep(300);
      return result;
    };
    return { id, worktree };
  }

  // The same loss the eviction guard exists to prevent, reached from the other
  // end and with more riding on it: `doArchive` writes the ref through
  // `snapshotTaskWip` and only then removes the checkout, so for the whole of
  // that removal a discard would drop the one commit the archive's whole
  // recoverability rests on — moments before the directory holding the other
  // copy goes. Neither would be left.
  test("a discard cannot land in the middle of an archive", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root);
    const { id, worktree } = await halfArchived(manager, projectId);

    const archiving = manager.archiveTask(id);
    // Inside the window by construction: the ref is on the row and the checkout
    // it was taken from is still there.
    expect(await waitFor(() => store.get(id)!.wip_ref !== null, 5000)).toBe(true);
    expect(store.get(id)!.worktree_state).toBe("present");
    expect(fs.existsSync(worktree)).toBe(true);

    expect(await manager.discardTaskWip(id)).toBe(false);
    expect(await archiving).not.toBeNull();

    // What the confirmation dialog promised: the checkout is gone and the work
    // that was in it is still there to be recovered from.
    expect(fs.existsSync(worktree)).toBe(false);
    expect(store.get(id)!.wip_ref).toBe(wipRefFor(id));
    expect(await readWip(root, id)).not.toBeNull();
    expect(await git(root, "show", `${wipRefFor(id)}:README.md`)).toBe("the user's work");
  }, 30000);

  // And the question is not asked while the archive runs, rather than asked and
  // then refused on every answer. Otherwise every attached client draws the
  // apply/keep/discard notice for the length of a `worktree remove`, over a
  // decision nobody is being asked to make and which resolves itself in a
  // moment.
  test("no decision is reported while an archive is running", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root);
    const { id } = await halfArchived(manager, projectId);

    const archiving = manager.archiveTask(id);
    expect(await waitFor(() => store.get(id)!.wip_ref !== null, 5000)).toBe(true);

    // The row says exactly what a refused snapshot says, and the task reports
    // no decision outstanding anyway — so the notice and the buttons behind it
    // agree about what is being asked.
    expect(store.get(id)!.worktree_state).toBe("present");
    expect(manager.taskInfo(id)!.wipPending).toBe(false);
    expect(await manager.applyTaskWip(id)).toBe(false);

    await archiving;
    expect(manager.taskInfo(id)!.wipPending).toBe(false);
  }, 30000);
});
