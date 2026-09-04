import { test, expect, describe, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { applyMigrations } from "../db";
import { TaskStore } from "./store";
import { TaskManager } from "./manager";
import { Harvester, SEVEN_DAYS_MS } from "./harvester";
import { gitSpawn } from "../../api/utils";
import { foreignCheckouts } from "../../../test/git-repo";
import { taskDir } from "../agent/spawn";
import { WorktreeError, readWip, setupStampPath, worktreesRoot } from "../worktree";
import { waitFor } from "../../../test/wait";

// A task's checkout, from the manager's side (docs/v2-architecture.md §5.6).
// `lib/worktree` is tested on its own against temporary repositories; this is
// about the wiring — what `createTask` decides, what reaches the row, what the
// agent is actually spawned as, and what a snapshot and a restore leave the
// row saying.
//
// Nothing here stands in an agent, and it does not have to: `test/preload.ts`
// points `CODETOASTER_AGENT_BIN` at a harmless one before every test. These
// tests cannot use `command:` the way `manager.test.ts` does — the whole point
// is what the *agent* path builds, and `options.command` skips the settings
// write and the setup wrapper along with it — so before that default existed
// this file spawned a real Claude Code session per test (TASK-62).

const managers: TaskManager[] = [];
const tempDirs: string[] = [];
const projectIds: string[] = [];
const taskIds: string[] = [];

afterEach(async () => {
  // Awaited: these tasks have real checkouts, and delete now removes them
  // (TASK-31) — a removal still running while the lines below rm the worktrees
  // root is two things clearing up after each other.
  for (const m of managers) {
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-wt-repo-"));
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

/** A stand-in agent that records its argv and then sits on the PTY, so a test
 * can see what the wrapper passed through and the task stays alive. */
function standInAgent(): { bin: string; argv: () => string[][] } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-wt-agent-"));
  tempDirs.push(dir);
  const log = path.join(dir, "argv");
  const bin = path.join(dir, "agent");
  fs.writeFileSync(bin, `#!/bin/sh\nprintf '%s\\t' "$@" >> "${log}"\nprintf '\\n' >> "${log}"\nexec cat\n`);
  fs.chmodSync(bin, 0o755);
  return {
    bin,
    argv: () =>
      fs.existsSync(log)
        ? fs.readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => l.split("\t").filter(Boolean))
        : [],
  };
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

describe("creating a task with a worktree", () => {
  test("spawns the agent inside a checkout of its own and records it on the row", async () => {
    const root = await tempRepo();
    const { manager, projectId } = await newManager(root);
    const id = taskId();

    const row = await manager.createTask({
      id, projectId, prompt: "fix the parser", worktree: true, baseRef: "release",
    });

    expect(row.worktree_state).toBe("present");
    expect(row.branch).toBe("codetoaster/fix-the-parser");
    expect(row.base_ref).toBe("release");
    // The agent runs *in* the checkout: cwd is the worktree, not the project's
    // own tree, so every route that reads the task's directory lands there.
    expect(row.cwd).toBe(row.worktree_path!);
    expect(row.worktree_path).toContain(projectId);
    expect(row.worktree_path).toContain(id);
    // A real checkout of the ref that was asked for.
    expect(await git(row.cwd, "rev-parse", "--abbrev-ref", "HEAD"))
      .toBe("codetoaster/fix-the-parser");
    // And `repo_root` resolved against it, so the git routes address the
    // worktree rather than the project.
    expect(row.repo_root).toBe(row.cwd);
  }, 20000);

  test("takes the project's worktree_default when the caller says nothing", async () => {
    const root = await tempRepo();
    const { manager, projectId } = await newManager(root, { worktreeDefault: true });

    const row = await manager.createTask({ id: taskId(), projectId, prompt: "inherited" });

    // Resolved on the server, so the HTTP API and the CLI get it without
    // having to know the project's columns.
    expect(row.worktree_state).toBe("present");
    expect(row.cwd).toBe(row.worktree_path!);
  }, 20000);

  test("takes the project's default base ref, and HEAD when there is none", async () => {
    const root = await tempRepo();
    const { manager, projectId } = await newManager(root, {
      worktreeDefault: true, defaultBaseRef: "release",
    });

    const fromDefault = await manager.createTask({ id: taskId(), projectId, prompt: "a" });
    expect(fromDefault.base_ref).toBe("release");

    // An explicit ref still wins over the project's.
    const explicit = await manager.createTask({
      id: taskId(), projectId, prompt: "b", baseRef: "main",
    });
    expect(explicit.base_ref).toBe("main");
  }, 20000);

  test("a task without one is left in the project's own checkout", async () => {
    const root = await tempRepo();
    const { manager, projectId } = await newManager(root);

    const row = await manager.createTask({ id: taskId(), projectId, prompt: "no worktree" });

    // "none" is the difference between "we made this" and "the user was
    // already working here" — which is what boot reconciliation (TASK-32) and
    // the evict tier (TASK-39) key off.
    expect(row.worktree_state).toBe("none");
    expect(row.worktree_path).toBeNull();
    expect(row.branch).toBeNull();
    expect(row.cwd).toBe(root);
  }, 20000);

  // AC #4. The worktree is made before the row precisely so this is true:
  // `createWorktree` backs its own partial state out, and there is no row yet
  // to leave behind.
  test("a base ref that names nothing leaves no task and no worktree", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root);
    const id = taskId();

    const error = await manager
      .createTask({ id, projectId, prompt: "doomed", worktree: true, baseRef: "no-such-ref" })
      .catch((e) => e);

    // git's own account of it reaches the caller, which is the difference
    // between a message the user can act on and "could not create the task".
    expect(String(error.message)).toContain("no-such-ref");
    expect(store.get(id)).toBeUndefined();
    expect(manager.listTasks().some((t) => t.id === id)).toBe(false);
    expect(fs.existsSync(path.join(worktreesRoot(), projectId, id))).toBe(false);
    expect(await git(root, "branch", "--list", "codetoaster/doomed")).toBe("");
  }, 20000);

  // The other half of AC #4, and the one the ordering does *not* give for
  // free: the checkout is made before the row, so everything after it — the
  // settings write, the spawn — can still fail with a worktree already on
  // disk. An agent binary that is not there is the ordinary way to hit it.
  test("an agent that will not spawn takes its worktree and branch with it", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root);
    const id = taskId();
    const bin = process.env.CODETOASTER_AGENT_BIN;
    process.env.CODETOASTER_AGENT_BIN = "/nonexistent/codetoaster-not-an-agent";

    try {
      await manager
        .createTask({ id, projectId, prompt: "unspawnable", worktree: true })
        .catch((e) => e);

      expect(store.get(id)).toBeUndefined();
      // Not just the row: a checkout nothing will ever look at again, and a
      // branch named off the title that would push the next attempt to `-2`.
      expect(fs.existsSync(path.join(worktreesRoot(), projectId, id))).toBe(false);
      expect(await git(root, "branch", "--list", "codetoaster/unspawnable")).toBe("");
      expect(await git(root, "worktree", "list", "--porcelain")).not.toContain(id);
    } finally {
      if (bin === undefined) delete process.env.CODETOASTER_AGENT_BIN;
      else process.env.CODETOASTER_AGENT_BIN = bin;
    }
  }, 20000);
});

describe("setup_command", () => {
  test("runs in the agent's terminal, ahead of an agent whose argv survives it", async () => {
    const root = await tempRepo();
    const { manager, projectId } = await newManager(root, {
      setupCommand: `printf 'installing\\n' > setup-ran`,
    });
    const agent = standInAgent();
    process.env.CODETOASTER_AGENT_BIN = agent.bin;
    const id = taskId();

    try {
      const row = await manager.createTask({
        id, projectId, prompt: "--- a prompt that opens with dashes", worktree: true,
      });

      // Setup ran, and it ran *in the worktree*.
      expect(await waitFor(() => fs.existsSync(path.join(row.cwd, "setup-ran")), 5000)).toBe(true);
      expect(await waitFor(() => agent.argv().length > 0, 5000)).toBe(true);

      // And the agent got its argv through `exec "$@"` unflattened — the
      // prompt is one entry, dashes and all, behind the `--` separator.
      const argv = agent.argv()[0]!;
      expect(argv).toContain("--");
      expect(argv[argv.indexOf("--") + 1]).toBe("--- a prompt that opens with dashes");
    } finally {
      delete process.env.CODETOASTER_AGENT_BIN;
    }
  }, 20000);

  test("its duration lands on the row when the task's first hook arrives", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root, { setupCommand: "true" });
    const agent = standInAgent();
    process.env.CODETOASTER_AGENT_BIN = agent.bin;
    const id = taskId();

    try {
      await manager.createTask({ id, projectId, prompt: "timed", worktree: true });
      // The wrapper writes the stamp before it execs, so an agent that has
      // reported anything is proof it is there — which is why the read is hung
      // on the hook rather than on a timer.
      expect(await waitFor(() => fs.existsSync(setupStampPath(id)), 5000)).toBe(true);

      manager.applyHook(id, { hook_event_name: "SessionStart", session_id: "s1" } as any);

      expect(await waitFor(() => store.get(id)?.setup_duration_ms !== null, 5000)).toBe(true);
      const duration = store.get(id)!.setup_duration_ms!;
      expect(duration).toBeGreaterThanOrEqual(0);
      expect(duration).toBeLessThan(20_000);
    } finally {
      delete process.env.CODETOASTER_AGENT_BIN;
    }
  }, 20000);

  test("a task with no setup command records no duration", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root);
    const id = taskId();

    await manager.createTask({ id, projectId, prompt: "unwrapped", worktree: true });
    manager.applyHook(id, { hook_event_name: "SessionStart", session_id: "s1" } as any);
    await new Promise((r) => setTimeout(r, 200));

    // Nothing was measured because nothing was run, and null says that where a
    // zero would claim an instant install.
    expect(store.get(id)!.setup_duration_ms).toBeNull();
  }, 20000);
});

describe("project settings", () => {
  test("round-trip through updateProject, with blank meaning unset", async () => {
    const root = await tempRepo();
    const { manager, projectId } = await newManager(root);

    manager.updateProject(projectId, "Renamed", root, {
      defaultModel: "opus",
      defaultBaseRef: "release",
      setupCommand: "bun install",
      worktreeCopy: ".env\n.config",
      worktreeDefault: true,
    });
    let project = manager.getProjects().find((p) => p.id === projectId)!;
    expect(project.name).toBe("Renamed");
    expect(project).toMatchObject({
      defaultModel: "opus",
      defaultBaseRef: "release",
      setupCommand: "bun install",
      worktreeCopy: ".env\n.config",
      worktreeDefault: true,
    });

    // A patch, so a rename that names no settings keeps them all: the rename
    // dialog must not clear a setup command it never showed the user.
    manager.updateProject(projectId, "Renamed again", root);
    project = manager.getProjects().find((p) => p.id === projectId)!;
    expect(project.setupCommand).toBe("bun install");
    expect(project.worktreeDefault).toBe(true);

    // And a cleared text field is unset, not the empty string — a project
    // storing "" would put an empty `--model` on the agent's argv.
    manager.updateProject(projectId, "Renamed again", root, {
      defaultModel: "", setupCommand: "   ", worktreeDefault: false,
    });
    project = manager.getProjects().find((p) => p.id === projectId)!;
    expect(project.defaultModel).toBeNull();
    expect(project.setupCommand).toBeNull();
    expect(project.worktreeDefault).toBe(false);
  }, 20000);
});

// Evicting and restoring, from the row's side (§5.6, TASK-38). The git of it —
// what a snapshot captures and what a restore refuses — is `wip.test.ts`; what
// is left here is the part the UI reads: which columns say the checkout is
// back, and which say it owes the user a decision.
describe("snapshot and restore", () => {
  /** A task with a checkout, suspended, dirty, snapshotted and evicted — the
   * state the evict tier leaves behind (TASK-39), assembled by hand because
   * the tier itself does not exist yet. */
  async function evicted(manager: TaskManager, store: TaskStore, projectId: string, root: string) {
    const id = taskId();
    const row = await manager.createTask({ id, projectId, prompt: "do a thing", worktree: true });
    fs.writeFileSync(path.join(row.worktree_path!, "README.md"), "dirty\n");
    fs.writeFileSync(path.join(row.worktree_path!, "new.txt"), "untracked\n");
    await manager.closeTask(id);

    const snapshot = await manager.snapshotTaskWip(id);
    await git(root, "worktree", "remove", "--force", row.worktree_path!);
    store.update(id, { worktree_state: "evicted" });
    return { id, row, snapshot };
  }

  test("a snapshot lands on the row", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root, { worktreeDefault: true });
    const id = taskId();
    const row = await manager.createTask({ id, projectId, prompt: "do a thing" });
    fs.writeFileSync(path.join(row.worktree_path!, "README.md"), "dirty\n");

    const snapshot = await manager.snapshotTaskWip(id);

    expect(snapshot).not.toBeNull();
    expect(store.get(id)?.wip_ref).toBe(`refs/codetoaster/wip/${id}`);
    expect(store.get(id)?.wip_at).toBe(snapshot!.at);
    expect(await git(root, "rev-parse", snapshot!.ref)).toBe(snapshot!.commit);
  }, 20000);

  // Not a failure: a task without a checkout of its own is running in the
  // project's directory, where the working state is the user's and not ours to
  // commit — and neither is a task whose checkout is already gone.
  test("a task with no checkout of its own has nothing to snapshot", async () => {
    const root = await tempRepo();
    const { manager, projectId } = await newManager(root);
    const id = taskId();
    await manager.createTask({ id, projectId, prompt: "no worktree", command: ["cat"] });

    expect(await manager.snapshotTaskWip(id)).toBeNull();
    expect(await manager.restoreTaskWorktree(id)).toBeNull();
  }, 20000);

  test("restoring brings the checkout and the dirt back, and clears the ref", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root, { worktreeDefault: true });
    const { id, row } = await evicted(manager, store, projectId, root);

    const restored = await manager.restoreTaskWorktree(id);

    expect(restored?.wip).toBe("applied");
    expect(fs.readFileSync(path.join(row.worktree_path!, "README.md"), "utf8")).toBe("dirty\n");
    expect(fs.existsSync(path.join(row.worktree_path!, "new.txt"))).toBe(true);
    const after = store.get(id)!;
    expect(after.worktree_state).toBe("present");
    expect(after.cwd).toBe(row.worktree_path!);
    // Cleared, and that is what makes the column below mean something: with the
    // work on disk there is no decision outstanding.
    expect(after.wip_ref).toBeNull();
    expect(after.wip_at).toBeNull();
    // And cleared in git too, not only on the row. `restoreWorktree` reads the
    // ref rather than the columns, so a ref left behind would be applied again
    // by the next restore of this task — work the row says was already handed
    // back, put on top of whatever the user did with it since.
    expect(await readWip(root, id)).toBeNull();
  }, 20000);

  // The needs-decision state, spelled without a column of its own: a checkout
  // that is present while a WIP ref is still set is a task whose snapshot was
  // refused, and it reads the same way after a daemon restart.
  test("a snapshot the branch outran is kept, not applied", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root, { worktreeDefault: true });
    const { id, row } = await evicted(manager, store, projectId, root);

    // The user commits to the task's branch from their own checkout while the
    // task is evicted.
    await git(root, "checkout", "-q", row.branch!);
    fs.writeFileSync(path.join(root, "README.md"), "committed elsewhere\n");
    await git(root, "commit", "-qam", "work outside the task");
    await git(root, "checkout", "-q", "main");

    const restored = await manager.restoreTaskWorktree(id);

    expect(restored?.wip).toBe("stale");
    // The newer commit survived, which is the only thing that matters.
    expect(fs.readFileSync(path.join(row.worktree_path!, "README.md"), "utf8"))
      .toBe("committed elsewhere\n");
    const after = store.get(id)!;
    expect(after.worktree_state).toBe("present");
    expect(after.wip_ref).toBe(`refs/codetoaster/wip/${id}`);
    expect(after.wip_at).not.toBeNull();
  }, 20000);

  // A task owing a decision must not have it answered by the next eviction: a
  // task has one WIP ref, so a second snapshot would move it off the commit the
  // user was being offered and leave that commit unreachable.
  test("a task still owing a decision is not snapshotted over", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root, { worktreeDefault: true });
    const { id, row, snapshot } = await evicted(manager, store, projectId, root);

    await git(root, "checkout", "-q", row.branch!);
    fs.writeFileSync(path.join(root, "README.md"), "committed elsewhere\n");
    await git(root, "commit", "-qam", "work outside the task");
    await git(root, "checkout", "-q", "main");
    expect((await manager.restoreTaskWorktree(id))?.wip).toBe("stale");

    // The task is dirty again and the evict tier comes back around.
    fs.writeFileSync(path.join(row.worktree_path!, "README.md"), "dirty again\n");

    expect(await manager.snapshotTaskWip(id)).toBeNull();
    expect(store.get(id)?.wip_ref).toBe(`refs/codetoaster/wip/${id}`);
    expect(await git(root, "rev-parse", `refs/codetoaster/wip/${id}`)).toBe(snapshot!.commit);
  }, 20000);

  // `worktree_state` is a claim about a directory, and a directory can be
  // removed by someone who never told us. Trusting the column would answer
  // "nothing to do" for exactly the task about to open on a path that is gone.
  test("restores a checkout removed behind our back, and not one that is there", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root, { worktreeDefault: true });
    const id = taskId();
    const row = await manager.createTask({ id, projectId, prompt: "do a thing" });
    await manager.closeTask(id);

    // Still on disk, so there is nothing to do.
    expect(await manager.restoreTaskWorktree(id)).toBeNull();

    fs.rmSync(row.worktree_path!, { recursive: true, force: true });
    const restored = await manager.restoreTaskWorktree(id);

    expect(restored?.wip).toBe("none");
    expect(fs.existsSync(path.join(row.worktree_path!, "README.md"))).toBe(true);
    expect(store.get(id)?.worktree_state).toBe("present");
  }, 20000);
});

// The evict tier and the reopen that undoes it (§5.6, TASK-39). The arithmetic
// of the grace period is `harvester.test.ts`; this is the round trip, against a
// real repository, through the doors a user actually goes through.
describe("the evict tier", () => {
  /** A suspended task with a checkout, dirty, and last touched `agoMs` ago —
   * the only three facts the tier's guards read. */
  async function resting(
    manager: TaskManager,
    store: TaskStore,
    projectId: string,
    agoMs: number,
  ) {
    const id = taskId();
    const row = await manager.createTask({ id, projectId, prompt: "do a thing" });
    fs.writeFileSync(path.join(row.worktree_path!, "README.md"), "dirty\n");
    await manager.closeTask(id);
    store.update(id, { last_active_at: Date.now() - agoMs });
    return { id, row };
  }

  function harvesterFor(manager: TaskManager): Harvester {
    const harvester = new Harvester(manager);
    // Idle harvesting off, so nothing this file asserts can be the other tier's
    // doing — and, incidentally, the shipped proof that turning one off leaves
    // the other running.
    harvester.setHarvestAfter(0);
    return harvester;
  }

  // AC #1.
  test("evicts a suspended task past its grace, keeping the branch and the work", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root, { worktreeDefault: true });
    const { id, row } = await resting(manager, store, projectId, 8 * 24 * 60 * 60_000);

    await harvesterFor(manager).tick();

    const after = store.get(id)!;
    expect(after.worktree_state).toBe("evicted");
    expect(fs.existsSync(row.worktree_path!)).toBe(false);
    // Everything that makes it restorable is still there: the branch, the WIP
    // ref, and the path the rebuild will land on.
    expect(after.worktree_path).toBe(row.worktree_path);
    expect(after.wip_ref).toBe(`refs/codetoaster/wip/${id}`);
    expect(await git(root, "rev-parse", "--verify", row.branch!)).toBeTruthy();
  }, 20000);

  test("leaves a task whose grace has not elapsed", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root, { worktreeDefault: true });
    const { id, row } = await resting(manager, store, projectId, 60_000);

    await harvesterFor(manager).tick();

    expect(store.get(id)!.worktree_state).toBe("present");
    expect(fs.existsSync(row.worktree_path!)).toBe(true);
  }, 20000);

  // AC #2.
  test("never evicts a pinned task, however long it has rested", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root, { worktreeDefault: true });
    const { id, row } = await resting(manager, store, projectId, 365 * 24 * 60 * 60_000);
    store.update(id, { pinned: 1 });

    await harvesterFor(manager).tick();

    expect(store.get(id)!.worktree_state).toBe("present");
    expect(fs.existsSync(row.worktree_path!)).toBe(true);
  }, 20000);

  test("a base grace of zero turns the tier off", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root, { worktreeDefault: true });
    const { id } = await resting(manager, store, projectId, 365 * 24 * 60 * 60_000);
    const harvester = harvesterFor(manager);
    harvester.setEvictAfter(0);

    await harvester.tick();

    expect(store.get(id)!.worktree_state).toBe("present");
  }, 20000);

  // The tier is priced in restore cost, not in age: an expensive checkout is
  // worth keeping longer, because what the user pays for its eviction is the
  // wait when they come back.
  test("scales the grace by what the task's last restore cost", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root, { worktreeDefault: true });
    // Eight days each: past a plain seven-day grace, and short of the fourteen
    // a thirty-second install earns.
    const eightDays = 8 * 24 * 60 * 60_000;
    const cheap = await resting(manager, store, projectId, eightDays);
    const expensive = await resting(manager, store, projectId, eightDays);
    store.update(expensive.id, { setup_duration_ms: 30_000 });

    await harvesterFor(manager).tick();

    // Same age, same project, same tick: the only difference is what each one
    // costs to rebuild.
    expect(store.get(cheap.id)!.worktree_state).toBe("evicted");
    expect(store.get(expensive.id)!.worktree_state).toBe("present");
    expect(SEVEN_DAYS_MS).toBe(7 * 24 * 60 * 60_000);
  }, 30000);

  // A live task has processes in that directory. It is not in the list the tier
  // walks at all, and that is the guard: everything §5.5 asks about running
  // processes was already discharged on the way to `suspended`.
  test("never evicts a task that is still live", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root, { worktreeDefault: true });
    const id = taskId();
    const row = await manager.createTask({ id, projectId, prompt: "still working" });
    store.update(id, { last_active_at: Date.now() - 365 * 24 * 60 * 60_000 });

    await harvesterFor(manager).tick();

    expect(store.get(id)!.worktree_state).toBe("present");
    expect(fs.existsSync(row.worktree_path!)).toBe(true);
    // And the manual door refuses it too, rather than closing it on the
    // caller's behalf.
    expect(await manager.evictTask(id)).toBe(false);
  }, 20000);

  // AC #3.
  test("a manual evict works on one task and on a whole project", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root, { worktreeDefault: true });
    const one = await resting(manager, store, projectId, 0);
    const two = await resting(manager, store, projectId, 0);
    const three = await resting(manager, store, projectId, 0);

    expect(await manager.evictTask(one.id)).toBe(true);
    expect(store.get(one.id)!.worktree_state).toBe("evicted");
    // Untouched: nothing about one task's eviction reaches its neighbours.
    expect(store.get(two.id)!.worktree_state).toBe("present");

    // Two left, and the one already evicted is not counted again.
    expect(await manager.evictProject(projectId)).toBe(2);
    expect(store.get(two.id)!.worktree_state).toBe("evicted");
    expect(store.get(three.id)!.worktree_state).toBe("evicted");
    expect(fs.existsSync(three.row.worktree_path!)).toBe(false);
  }, 30000);
});

describe("reopening an evicted task", () => {
  // AC #4, the round trip the tier is only safe because of.
  test("restores the checkout and its dirt before the agent comes back", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root, { worktreeDefault: true });
    const id = taskId();
    const row = await manager.createTask({ id, projectId, prompt: "do a thing" });
    fs.writeFileSync(path.join(row.worktree_path!, "README.md"), "dirty\n");
    fs.writeFileSync(path.join(row.worktree_path!, "new.txt"), "untracked\n");
    await manager.closeTask(id);
    expect(await manager.evictTask(id)).toBe(true);
    expect(fs.existsSync(row.worktree_path!)).toBe(false);

    manager.setStartTimeout(200);
    await manager.resumeTask(id);

    const after = store.get(id)!;
    expect(after.worktree_state).toBe("present");
    expect(after.lifecycle).toBe("live");
    // The work is back, as work rather than as a commit.
    expect(fs.readFileSync(path.join(row.worktree_path!, "README.md"), "utf8")).toBe("dirty\n");
    expect(fs.existsSync(path.join(row.worktree_path!, "new.txt"))).toBe(true);
    // And the agent is running *in* it — the row's cwd moved with the restore,
    // which is what a resume that read a stale row would have got wrong.
    expect(after.cwd).toBe(row.worktree_path!);
    expect(await manager.primaryPty(id)?.getCwd()).toBe(row.worktree_path!);
  }, 30000);

  // The other half of AC #4, and the gap TASK-38 left open: `git add -A`
  // honours `.gitignore`, so nothing ignored survives a snapshot. Setup and
  // `worktree_copy` are the only things that put it back.
  test("re-runs setup and re-copies the project's files", async () => {
    const root = await tempRepo();
    // Both markers are *ignored*, and that is what makes this a test rather
    // than a tautology. `git add -A` honours `.gitignore`, so neither can reach
    // the snapshot — an untracked-but-visible file would come back through the
    // WIP and prove nothing about setup having run at all.
    fs.writeFileSync(path.join(root, ".gitignore"), ".env\ninstalled.txt\n");
    fs.writeFileSync(path.join(root, ".env"), "SECRET=1\n");
    await git(root, "add", ".gitignore");
    await git(root, "commit", "-qm", "ignore the generated files");
    const { manager, store, projectId } = await newManager(root, {
      worktreeDefault: true,
      worktreeCopy: ".env",
      setupCommand: "echo installed > installed.txt",
    });
    const id = taskId();
    const row = await manager.createTask({ id, projectId, prompt: "do a thing" });
    const installed = path.join(row.worktree_path!, "installed.txt");
    expect(await waitFor(() => fs.existsSync(installed), 5000)).toBe(true);
    await manager.closeTask(id);
    await manager.evictTask(id);
    expect(fs.existsSync(installed)).toBe(false);

    manager.setStartTimeout(200);
    await manager.resumeTask(id);

    // Neither could have come out of git.
    expect(await waitFor(() => fs.existsSync(installed), 5000)).toBe(true);
    expect(fs.readFileSync(path.join(row.worktree_path!, ".env"), "utf8")).toBe("SECRET=1\n");

    // And the restore times *itself*: the grace the next eviction uses is
    // scaled by what this restore cost, not by a number measured when the task
    // was new. Recorded on the first hook, because the wrapper only execs the
    // agent once setup has exited — so an agent that has reported anything is
    // proof the stamp is already on disk.
    expect(await waitFor(() => fs.existsSync(setupStampPath(id)), 5000)).toBe(true);
    manager.applyHook(id, { hook_event_name: "SessionStart", session_id: "s1" } as any);
    expect(await waitFor(() => store.get(id)!.setup_duration_ms !== null, 5000)).toBe(true);
  }, 30000);

  // TASK-65, both halves in one round trip. A project's directory need not be
  // the repository's toplevel, and a worktree is a checkout of the whole
  // repository — so the agent belongs in the matching subdirectory, and the
  // copied files belong beside it. The restore has to reach the same answer
  // from the row alone: it resolves the repository from `worktree_repo` and
  // never asks the project where the checkout works.
  test("a project below the toplevel works in the matching subdirectory", async () => {
    const root = await tempRepo();
    const sub = path.join(root, "sub");
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(sub, "package.json"), "{}\n");
    // Ignored, so the snapshot cannot carry it: the copy is the only thing
    // that can put it back, which is what makes the second half a test.
    fs.writeFileSync(path.join(root, ".gitignore"), ".env\n");
    await git(root, "add", "-A");
    await git(root, "commit", "-qm", "a project below the toplevel");
    // Beside the project, and not at the toplevel — where the copy used to
    // look, silently finding nothing.
    fs.writeFileSync(path.join(sub, ".env"), "SECRET=1\n");
    const { manager, store, projectId } = await newManager(sub, {
      worktreeDefault: true,
      worktreeCopy: ".env",
    });
    const id = taskId();

    const row = await manager.createTask({ id, projectId, prompt: "do a thing" });

    const cwd = path.join(row.worktree_path!, "sub");
    expect(row.worktree_subdir).toBe("sub");
    expect(row.cwd).toBe(cwd);
    expect(fs.readFileSync(path.join(cwd, ".env"), "utf8")).toBe("SECRET=1\n");
    expect(fs.existsSync(path.join(row.worktree_path!, ".env"))).toBe(false);

    await manager.closeTask(id);
    expect(await manager.evictTask(id)).toBe(true);
    manager.setStartTimeout(200);
    await manager.resumeTask(id);

    const after = store.get(id)!;
    expect(after.cwd).toBe(cwd);
    expect(fs.readFileSync(path.join(cwd, ".env"), "utf8")).toBe("SECRET=1\n");
    // And the agent is actually in it, which is the thing the user chose.
    expect(await manager.primaryPty(id)?.getCwd()).toBe(cwd);
  }, 30000);

  // AC #5's first half. Not a resume that failed — the work is safe in the WIP
  // ref — but a workspace with nowhere to go, which the caller has to be told
  // about rather than handed a dead terminal.
  test("a branch deleted while the task was evicted is its own failure", async () => {
    const root = await tempRepo();
    const { manager, projectId } = await newManager(root, { worktreeDefault: true });
    const id = taskId();
    const row = await manager.createTask({ id, projectId, prompt: "do a thing" });
    await manager.closeTask(id);
    await manager.evictTask(id);
    await git(root, "branch", "-D", row.branch!);

    const error = await manager.resumeTask(id).catch((e) => e);

    expect(error).toBeInstanceOf(WorktreeError);
    expect(error.kind).toBe("branch-missing");
    // Nothing was spawned into a directory that does not exist.
    expect(manager.primaryPty(id)).toBeUndefined();
  }, 30000);
});

// The evict tier and the reopen path both act on one directory, and the row
// says `suspended` throughout a resume — the ladder only writes `live` on the
// rung that works. So "is it suspended?" is not enough to tell a resting task
// from one being reopened this instant, which is the collision these two guard.
//
// Deterministic without any hooks into the implementation: both `evictTask` and
// `resumeTask` register themselves before their first await, so the call that
// starts second always sees the first.
describe("evicting and reopening cannot collide", () => {
  async function evictable(manager: TaskManager, projectId: string) {
    const id = taskId();
    const row = await manager.createTask({ id, projectId, prompt: "do a thing" });
    fs.writeFileSync(path.join(row.worktree_path!, "README.md"), "dirty\n");
    await manager.closeTask(id);
    manager.setStartTimeout(200);
    return { id, row };
  }

  // The damaging order. Without the wait, the ladder restores the checkout and
  // spawns an agent into it while the eviction — which read the row before any
  // of that — goes on to `git worktree remove --force` the directory out from
  // under the running agent.
  test("a resume waits for an eviction already in flight, then rebuilds", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root, { worktreeDefault: true });
    const { id, row } = await evictable(manager, projectId);

    const evicting = manager.evictTask(id);
    const resuming = manager.resumeTask(id);
    expect(await evicting).toBe(true);
    await resuming;

    const after = store.get(id)!;
    expect(after.lifecycle).toBe("live");
    // The end state is the resume's, not the eviction's: the checkout is back,
    // with the work in it, and the agent has a directory to be running in.
    expect(after.worktree_state).toBe("present");
    expect(fs.existsSync(row.worktree_path!)).toBe(true);
    expect(fs.readFileSync(path.join(row.worktree_path!, "README.md"), "utf8")).toBe("dirty\n");
  }, 30000);

  // The other direction refuses rather than waiting, and that asymmetry is what
  // keeps the two from waiting on each other. Nothing is lost by refusing: the
  // tier is a sweep on a timer, and the next tick judges the task the resume
  // produced — a live one, which it will not touch.
  test("an eviction refuses while a resume is in flight", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root, { worktreeDefault: true });
    const { id, row } = await evictable(manager, projectId);

    const resuming = manager.resumeTask(id);
    expect(await manager.evictTask(id)).toBe(false);
    await resuming;

    expect(store.get(id)!.worktree_state).toBe("present");
    expect(fs.existsSync(row.worktree_path!)).toBe(true);
    // And no snapshot was stamped on the way: a `wip_ref` on a present checkout
    // is the encoding for "this task owes the user a decision", and one written
    // by a refused eviction would be a decision about nothing — and would block
    // the task from ever being evicted again.
    expect(store.get(id)!.wip_ref).toBeNull();
  }, 30000);

  // Two callers, one checkout. The manual route and the tier can easily arrive
  // together, and snapshotting and removing the same directory twice is at best
  // wasted work and at worst a second `worktree remove` racing the first.
  test("a second eviction joins the first rather than repeating it", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root, { worktreeDefault: true });
    const { id, row } = await evictable(manager, projectId);

    const [first, second] = await Promise.all([manager.evictTask(id), manager.evictTask(id)]);

    expect([first, second]).toEqual([true, true]);
    expect(store.get(id)!.worktree_state).toBe("evicted");
    expect(fs.existsSync(row.worktree_path!)).toBe(false);
  }, 30000);
});

// The decision a refused snapshot leaves behind (§5.6, TASK-63). The state is
// two columns and no third thing: a *present* checkout that still has a WIP ref
// is a snapshot the restore would not apply, and it reads the same after a
// daemon restart because nothing about it lives in memory.
describe("a snapshot the branch outran", () => {
  /** A task whose restore refused its snapshot: evicted dirty, then committed
   * to from the user's own checkout while it was away. */
  async function owingADecision(manager: TaskManager, projectId: string, root: string) {
    const id = taskId();
    const row = await manager.createTask({ id, projectId, prompt: "do a thing" });
    fs.writeFileSync(path.join(row.worktree_path!, "README.md"), "the user's work\n");
    await manager.closeTask(id);
    await manager.evictTask(id);

    await git(root, "checkout", "-q", row.branch!);
    fs.writeFileSync(path.join(root, "README.md"), "committed elsewhere\n");
    await git(root, "commit", "-qam", "work done outside the task");
    await git(root, "checkout", "-q", "main");

    manager.setStartTimeout(200);
    await manager.resumeTask(id);
    return { id, row };
  }

  // AC #1.
  test("is what wipPending reports, and only that", async () => {
    const root = await tempRepo();
    const { manager, projectId } = await newManager(root, { worktreeDefault: true });
    const { id } = await owingADecision(manager, projectId, root);

    expect(manager.taskInfo(id)!.wipPending).toBe(true);
    expect(manager.taskInfo(id)!.worktreeState).toBe("present");

    // A task whose restore applied cleanly owes nothing, and neither does one
    // that was never evicted at all.
    const clean = taskId();
    const cleanRow = await manager.createTask({ id: clean, projectId, prompt: "clean" });
    fs.writeFileSync(path.join(cleanRow.worktree_path!, "README.md"), "dirty\n");
    await manager.closeTask(clean);
    await manager.evictTask(clean);
    // An *evicted* task has a ref too — that is simply how it is stored — and
    // it is not a decision anybody owes.
    expect(manager.taskInfo(clean)!.wipPending).toBe(false);
    await manager.resumeTask(clean);
    expect(manager.taskInfo(clean)!.wipPending).toBe(false);
  }, 30000);

  // AC #3.
  test("apply writes it into the live checkout and stops asking", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root, { worktreeDefault: true });
    const { id, row } = await owingADecision(manager, projectId, root);
    // The restore left the newer commit standing, which is what made this a
    // decision rather than a silent overwrite.
    expect(fs.readFileSync(path.join(row.worktree_path!, "README.md"), "utf8"))
      .toBe("committed elsewhere\n");

    expect(await manager.applyTaskWip(id)).toBe(true);

    expect(fs.readFileSync(path.join(row.worktree_path!, "README.md"), "utf8"))
      .toBe("the user's work\n");
    expect(store.get(id)!.wip_ref).toBeNull();
    expect(store.get(id)!.wip_at).toBeNull();
    expect(manager.taskInfo(id)!.wipPending).toBe(false);
    // The ref goes with the columns: one that survived the decision would ask
    // the same question forever.
    expect(await readWip(root, id)).toBeNull();
  }, 30000);

  // AC #5.
  test("discard drops the ref and does not come back", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root, { worktreeDefault: true });
    const { id, row } = await owingADecision(manager, projectId, root);

    expect(await manager.discardTaskWip(id)).toBe(true);

    // The checkout is untouched — discarding is about the snapshot, not about
    // the tree the user is looking at.
    expect(fs.readFileSync(path.join(row.worktree_path!, "README.md"), "utf8"))
      .toBe("committed elsewhere\n");
    expect(store.get(id)!.wip_ref).toBeNull();
    expect(await readWip(root, id)).toBeNull();
    expect(manager.taskInfo(id)!.wipPending).toBe(false);
    // And a second answer is a no-op rather than an error: two browsers can
    // both be showing the banner.
    expect(await manager.discardTaskWip(id)).toBe(false);
    expect(await manager.applyTaskWip(id)).toBe(false);
  }, 30000);

  // AC #4. "Keep" is the absence of a request, which is the whole reason it
  // needs no endpoint and no fourth column: nothing is written, so the next
  // client to load the task is told the same thing.
  test("keeping means the row still says so", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root, { worktreeDefault: true });
    const { id } = await owingADecision(manager, projectId, root);

    const ref = store.get(id)!.wip_ref;
    expect(ref).not.toBeNull();
    // Whatever the client does with its banner, the server has been asked
    // nothing — so a fresh reader sees the decision still outstanding.
    expect(manager.taskInfo(id)!.wipPending).toBe(true);
    expect(store.get(id)!.wip_ref).toBe(ref!);
    expect(await readWip(root, id)).not.toBeNull();
  }, 30000);
});

// A task has to be able to find its own repository (§5.6, TASK-64). Everything
// worktree used to resolve one through the *project*, and deleting a project
// reassigns its tasks to General — whose path is empty — so a task with a
// checkout was left able to be neither reopened nor evicted, its branch and its
// snapshot sitting in a repository nothing could name.
describe("a task outliving its project", () => {
  /** Whether two paths name the same repository.
   *
   * String equality is the wrong question, and macOS makes that unmissable: a
   * temp directory is `/var/...` while `rev-parse --show-toplevel` answers
   * `/private/var/...` through the symlink. The two writers here honestly
   * differ — a create stores the toplevel git resolved, while `deleteProject`
   * stamps the project's own directory to stay synchronous — and the column is
   * documented as *a directory inside the repository* precisely because that is
   * all any consumer needs. So the assertion asks git, the way the consumers
   * do. */
  async function sameRepo(a: string, b: string): Promise<boolean> {
    return (await git(a, "rev-parse", "--show-toplevel"))
      === (await git(b, "rev-parse", "--show-toplevel"));
  }

  test("records the repository it was branched from", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root, { worktreeDefault: true });
    const id = taskId();
    await manager.createTask({ id, projectId, prompt: "do a thing" });

    // The repository, not the checkout: `repo_root` is resolved from the task's
    // cwd, so for a worktree task it names the worktree and dies with it.
    expect(await sameRepo(store.get(id)!.worktree_repo!, root)).toBe(true);
    expect(store.get(id)!.repo_root).toBe(store.get(id)!.worktree_path);
  }, 20000);

  // The headline case. Before the column, this resume failed with a 409 for
  // good — through every door, forever.
  test("can still be reopened after its project is deleted", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root, { worktreeDefault: true });
    const id = taskId();
    const row = await manager.createTask({ id, projectId, prompt: "do a thing" });
    fs.writeFileSync(path.join(row.worktree_path!, "README.md"), "dirty\n");
    await manager.closeTask(id);
    await manager.evictTask(id);

    expect(manager.deleteProject(projectId)).toBe(true);
    expect(store.get(id)!.project_id).toBe("general");

    manager.setStartTimeout(200);
    await manager.resumeTask(id);

    expect(store.get(id)!.worktree_state).toBe("present");
    // Rebuilt where it was evicted from, not at a path recomputed from the
    // project it now belongs to — which would be a different directory, so the
    // restore would land beside the work rather than onto it.
    expect(store.get(id)!.worktree_path).toBe(row.worktree_path!);
    expect(fs.readFileSync(path.join(row.worktree_path!, "README.md"), "utf8")).toBe("dirty\n");
  }, 30000);

  test("can still be evicted after its project is deleted", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root, { worktreeDefault: true });
    const id = taskId();
    const row = await manager.createTask({ id, projectId, prompt: "do a thing" });
    await manager.closeTask(id);

    manager.deleteProject(projectId);

    expect(await manager.evictTask(id)).toBe(true);
    expect(store.get(id)!.worktree_state).toBe("evicted");
    expect(fs.existsSync(row.worktree_path!)).toBe(false);
  }, 30000);

  // A task created before the column existed has a null and a project that can
  // still answer, so the answer is resolved once and written back.
  test("a row with no record of its repository heals from the project", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root, { worktreeDefault: true });
    const id = taskId();
    await manager.createTask({ id, projectId, prompt: "do a thing" });
    await manager.closeTask(id);
    // What an older row looks like.
    store.update(id, { worktree_repo: null });

    expect(await manager.evictTask(id)).toBe(true);

    expect(store.get(id)!.worktree_repo).not.toBeNull();
    expect(await sameRepo(store.get(id)!.worktree_repo!, root)).toBe(true);
  }, 30000);

  // Deleting a project is the moment a task is stranded, so the stamp happens
  // there — which is what makes this fix reach the tasks that already exist
  // rather than only the ones made after it.
  test("deleting a project stamps the repository on the way out", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root, { worktreeDefault: true });
    const id = taskId();
    await manager.createTask({ id, projectId, prompt: "do a thing" });
    await manager.closeTask(id);
    store.update(id, { worktree_repo: null });

    manager.deleteProject(projectId);

    expect(store.get(id)!.worktree_repo).not.toBeNull();
    expect(await sameRepo(store.get(id)!.worktree_repo!, root)).toBe(true);
  }, 30000);

  // Only a row stranded *before* any of this shipped can get here: no record of
  // its own, and no project left to ask. It is the one unrecoverable case, so
  // it says what happened and where the work still is rather than answering
  // with a generic "not a repository".
  test("says so plainly when nothing can name the repository", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root, { worktreeDefault: true });
    const id = taskId();
    const row = await manager.createTask({ id, projectId, prompt: "do a thing" });
    await manager.closeTask(id);
    await manager.evictTask(id);
    manager.deleteProject(projectId);
    store.update(id, { worktree_repo: null });

    const error = await manager.resumeTask(id).catch((e) => e);

    expect(error).toBeInstanceOf(WorktreeError);
    expect(error.kind).toBe("repo-unknown");
    // The work is not lost, and the message has to say where it is.
    expect(error.message).toContain(row.branch!);
  }, 30000);
});

// The three ways the refused-snapshot state can be wrong about itself. All
// three are the same underlying hazard: `worktree_state = present` with a
// `wip_ref` is a *decision*, and anything that produces that pair without one
// being owed either asks the user a question about nothing or, worse, offers
// them a button that destroys work.
describe("the refused-snapshot state says only what is true", () => {
  async function evictedTask(manager: TaskManager, projectId: string) {
    const id = taskId();
    const row = await manager.createTask({ id, projectId, prompt: "do a thing" });
    fs.writeFileSync(path.join(row.worktree_path!, "README.md"), "the user's work\n");
    await manager.closeTask(id);
    return { id, row };
  }

  // A restore that found no snapshot used to leave the row still naming one:
  // `applied` cleared the columns and everything else kept them. The task then
  // showed the notice forever, Apply failed on the missing ref, and
  // `snapshotTaskWip` refuses a row that already has one — so it could never be
  // evicted again either.
  test("a restore that found no snapshot clears the columns", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root, { worktreeDefault: true });
    const { id, row } = await evictedTask(manager, projectId);
    await manager.evictTask(id);
    // The ref disappearing out from under the row: a daemon killed between the
    // snapshot and the removal, then a cleanup by hand.
    await git(root, "update-ref", "-d", `refs/codetoaster/wip/${id}`);
    expect(store.get(id)!.wip_ref).not.toBeNull();

    manager.setStartTimeout(200);
    await manager.resumeTask(id);

    expect(store.get(id)!.wip_ref).toBeNull();
    expect(manager.taskInfo(id)!.wipPending).toBe(false);
    expect(fs.existsSync(row.worktree_path!)).toBe(true);
  }, 30000);

  // The one way this design can lose work. `doEvict` writes the ref and
  // broadcasts before it removes the checkout, so for the whole of that removal
  // the row reads like a refused snapshot — and a discard landing there would
  // drop the very commit the eviction is relying on, leaving neither.
  //
  // The window is widened rather than raced. Calling `discardTaskWip` straight
  // after starting the eviction proves nothing: the ref has not been written
  // yet at that point, so the discard is refused for having nothing to drop
  // rather than for the reason under test — which is exactly how the first
  // version of this test passed with the guard removed. Delaying inside the
  // snapshot puts a real, bounded gap between "the ref exists" and "the
  // checkout is gone", which is the window itself, held open.
  test("a discard cannot land in the middle of an eviction", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root, { worktreeDefault: true });
    const { id, row } = await evictedTask(manager, projectId);

    const snapshot = manager.snapshotTaskWip.bind(manager);
    (manager as any).snapshotTaskWip = async (taskId: string) => {
      const result = await snapshot(taskId);
      await Bun.sleep(300);
      return result;
    };

    const evicting = manager.evictTask(id);
    // Inside the window by construction: the ref is on the row and the checkout
    // is still there.
    expect(await waitFor(() => store.get(id)!.wip_ref !== null, 5000)).toBe(true);
    expect(fs.existsSync(row.worktree_path!)).toBe(true);

    expect(await manager.discardTaskWip(id)).toBe(false);
    expect(await evicting).toBe(true);

    // The snapshot survived, which is the whole point: the checkout is gone and
    // the work is still recoverable.
    expect(fs.existsSync(row.worktree_path!)).toBe(false);
    expect(await readWip(root, id)).not.toBeNull();
    expect(store.get(id)!.wip_ref).not.toBeNull();
  }, 30000);

  // And nothing asks the question while the eviction is running, rather than
  // asking it and refusing every answer. Same widened window, for the same
  // reason: before the ref is written there is nothing to report either way.
  test("no decision is reported while an eviction is running", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root, { worktreeDefault: true });
    const { id } = await evictedTask(manager, projectId);

    const snapshot = manager.snapshotTaskWip.bind(manager);
    (manager as any).snapshotTaskWip = async (taskId: string) => {
      const result = await snapshot(taskId);
      await Bun.sleep(300);
      return result;
    };

    const evicting = manager.evictTask(id);
    expect(await waitFor(() => store.get(id)!.wip_ref !== null, 5000)).toBe(true);
    // The row says what a refused snapshot says, and the task still reports no
    // decision outstanding.
    expect(store.get(id)!.worktree_state).toBe("present");
    expect(manager.taskInfo(id)!.wipPending).toBe(false);

    await evicting;
    expect(manager.taskInfo(id)!.wipPending).toBe(false);
  }, 30000);

  // Dropping a ref needs the repository, not the checkout — which the row can
  // name for itself now. Without that, a task whose directory was removed by
  // hand showed a notice neither button could clear.
  test("a discard works even when the checkout is gone", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root, { worktreeDefault: true });
    const { id, row } = await evictedTask(manager, projectId);
    await manager.evictTask(id);
    await git(root, "checkout", "-q", row.branch!);
    fs.writeFileSync(path.join(root, "README.md"), "committed elsewhere\n");
    await git(root, "commit", "-qam", "work outside the task");
    await git(root, "checkout", "-q", "main");
    manager.setStartTimeout(200);
    await manager.resumeTask(id);
    expect(manager.taskInfo(id)!.wipPending).toBe(true);

    // Someone removes the checkout behind our back while the question is open.
    fs.rmSync(row.worktree_path!, { recursive: true, force: true });

    expect(await manager.discardTaskWip(id)).toBe(true);
    expect(store.get(id)!.wip_ref).toBeNull();
    expect(await readWip(root, id)).toBeNull();
  }, 30000);
});

// The boot reconciliation, from the manager's side (§5.6, Risk 5, TASK-32).
// The sweep itself is `reconcile.test.ts`, against temporary repositories; what
// is left here is the wiring — which rows count as claiming a checkout, which
// column a vanished directory writes, and what the user is then offered.
describe("reconciling worktrees on boot", () => {
  /** Run `fn` with every foreign checkout under the real worktrees root held by
   * a row of its own, so the sweep leaves it alone.
   *
   * `reconcileWorktreesOnBoot` builds its `claimed` set out of this manager's
   * database and then walks `~/.codetoaster/worktrees`, which is the user's
   * actual one — there is no other. Against an in-memory database, *every*
   * checkout a developer has is unclaimed, and a clean one is what the sweep
   * removes without asking. So the foreign directories are given rows here for
   * the duration of the call, which is the only lever a caller has: the set is
   * derived, not injected.
   *
   * Torn down in a `finally` and not in `afterEach`, and that is the whole
   * safety of it: the file's `afterEach` deletes every task the manager lists,
   * and `deleteTask` removes a task's checkout (TASK-31) — so a claim row that
   * outlived the test body would hand the cleanup somebody's real work to
   * delete. `finally` runs on the failure path too, which is the path that
   * matters. */
  async function sparingForeignCheckouts<T>(
    store: TaskStore,
    projectId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const claims = foreignCheckouts(projectIds).map((dir) => {
      const id = `claim-${crypto.randomUUID()}`;
      store.create({
        id,
        project_id: projectId,
        title: "not this suite's",
        initial_prompt: "",
        repo_root: null,
        cwd: dir,
        worktree_path: dir,
        worktree_state: "present",
        lifecycle: "suspended",
      });
      return id;
    });
    try {
      return await fn();
    } finally {
      for (const id of claims) store.delete(id);
    }
  }

  /** A task with a checkout of its own, suspended so nothing is running in it. */
  async function withCheckout(manager: TaskManager, projectId: string) {
    const id = taskId();
    const row = await manager.createTask({ id, projectId, prompt: "do a thing" });
    await manager.closeTask(id);
    return { id, row };
  }

  // Direction (b). `worktree_state` is a claim about a directory, and the
  // directory can be removed by someone who never told us — a `rm -rf` between
  // two daemon runs. `missing` is what makes the next open rebuild it, where a
  // stale `present` would have the restore decide there was nothing to do and
  // then spawn an agent into a path that is not there.
  test("flips a row to missing when its checkout has gone", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root, { worktreeDefault: true });
    const { id, row } = await withCheckout(manager, projectId);
    expect(store.get(id)!.worktree_state).toBe("present");

    fs.rmSync(row.worktree_path!, { recursive: true, force: true });
    await sparingForeignCheckouts(store, projectId, () => manager.reconcileWorktreesOnBoot());

    expect(store.get(id)!.worktree_state).toBe("missing");
    // Everything that makes it rebuildable is still on the row — the sweep
    // corrects what we believe about the disk and takes nothing else with it.
    expect(store.get(id)!.worktree_path).toBe(row.worktree_path);
    expect(store.get(id)!.branch).toBe(row.branch);
    // And git's registration of the directory was pruned on the way past,
    // which is what lets that rebuild reuse the path at all.
    expect(await git(root, "worktree", "list", "--porcelain")).not.toContain(row.worktree_path!);
  }, 30000);

  // Direction (a) reaching a row that exists. Archived rows are deliberately
  // left out of `claimed`: archive removes the checkout and keeps the branch
  // and the snapshot (TASK-31), so a directory still standing for one is the
  // residue of a removal that did not finish, and removing it now is finishing
  // the job rather than second-guessing it.
  test("treats an archived task's leftover checkout as an orphan", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root, { worktreeDefault: true });
    const { id, row } = await withCheckout(manager, projectId);
    // What a half-finished archive leaves: the lifecycle written, the directory
    // still there.
    store.update(id, { lifecycle: "archived" });

    const report = await sparingForeignCheckouts(
      store, projectId, () => manager.reconcileWorktreesOnBoot(),
    );

    expect(report.removed).toEqual([row.worktree_path!]);
    expect(fs.existsSync(row.worktree_path!)).toBe(false);
    // The branch and the snapshot are what an archived task *is*, and neither
    // is on the disk the sweep is reclaiming.
    expect(await git(root, "branch", "--list", row.branch!)).toContain(row.branch!);
    expect(store.get(id)!.lifecycle).toBe("archived");
  }, 30000);

  // AC #2 all the way through to the client. The checkouts the sweep refused to
  // delete belong to no task, so there is nowhere for them to live but the
  // manager — and the only thing that can decide their fate is the user.
  test("holds the checkouts it would not delete, until the user says", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root, { worktreeDefault: true });
    const { id, row } = await withCheckout(manager, projectId);
    fs.writeFileSync(path.join(row.worktree_path!, "an-hours-work.txt"), "unsaved\n");
    store.update(id, { lifecycle: "archived" });

    // Empty before the sweep, and that is the honest answer rather than a
    // placeholder: the boot path fires the sweep and moves on, so "we have not
    // looked yet" and "there are none" read the same to a client either way.
    expect(manager.getUnclaimedWorktrees()).toEqual([]);

    await sparingForeignCheckouts(store, projectId, () => manager.reconcileWorktreesOnBoot());

    expect(manager.getUnclaimedWorktrees()).toEqual([{
      path: row.worktree_path!,
      repoRoot: expect.any(String),
      branch: row.branch,
      dirty: 1,
    }]);
    expect(fs.existsSync(row.worktree_path!)).toBe(true);

    expect(await manager.deleteUnclaimedWorktree(row.worktree_path!)).toBe(true);

    expect(fs.existsSync(row.worktree_path!)).toBe(false);
    // Dropped from the list as well as from the disk, or the card would come
    // back on the next broadcast pointing at nothing.
    expect(manager.getUnclaimedWorktrees()).toEqual([]);
    // And the registration went with it, the same as an eviction's.
    expect(await git(root, "worktree", "list", "--porcelain")).not.toContain(row.worktree_path!);
  }, 30000);

  // The guard that matters, because this path arrives from a client: the list
  // is ours, but the request is a string on the wire, and nothing about a path
  // having been reported once makes an arbitrary path safe to recursively
  // delete now.
  test("refuses to delete a path the sweep never named", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root, { worktreeDefault: true });
    const { id, row } = await withCheckout(manager, projectId);
    const orphan = await withCheckout(manager, projectId);
    fs.writeFileSync(path.join(orphan.row.worktree_path!, "unsaved.txt"), "work\n");
    store.update(orphan.id, { lifecycle: "archived" });

    await sparingForeignCheckouts(store, projectId, () => manager.reconcileWorktreesOnBoot());
    expect(manager.getUnclaimedWorktrees().map((w) => w.path)).toEqual([orphan.row.worktree_path!]);

    // A live task's checkout: under the worktrees root, shaped exactly like the
    // one that *is* on the list, and belonging to someone.
    expect(await manager.deleteUnclaimedWorktree(row.worktree_path!)).toBe(false);
    expect(fs.existsSync(row.worktree_path!)).toBe(true);
    expect(store.get(id)!.worktree_state).toBe("present");

    // A path outside the root entirely — the user's own repository.
    expect(await manager.deleteUnclaimedWorktree(root)).toBe(false);
    expect(fs.existsSync(path.join(root, "README.md"))).toBe(true);

    // And one that spells its way back out of the root through a directory the
    // list *does* hold, which is what a prefix check rather than a resolved one
    // would have let through.
    const escape = path.join(orphan.row.worktree_path!, "..", "..", "..", "tasks");
    expect(await manager.deleteUnclaimedWorktree(escape)).toBe(false);
    expect(fs.existsSync(taskDir(id))).toBe(true);

    // Nothing was refused *instead of* the real answer: the card is still
    // there, and still deletable.
    expect(manager.getUnclaimedWorktrees().map((w) => w.path)).toEqual([orphan.row.worktree_path!]);
  }, 30000);

  // The blast radius if this method ever reads the wrong database. Every real
  // checkout is unclaimed by an empty one, and "no rows" is far likelier to
  // mean a daemon pointed at the wrong `--db` than it is to mean the user has
  // no tasks and a root full of orphans — so the sweep must decline rather than
  // act on the reading that deletes the most.
  //
  // Written against a directory that would otherwise be removed: it is clean,
  // it is under the root, and nothing claims it. The only thing standing
  // between it and deletion is the guard.
  test("a database with no tasks at all sweeps nothing", async () => {
    const root = await tempRepo();
    const { manager, store, projectId } = await newManager(root, { worktreeDefault: true });
    const stranded = path.join(worktreesRoot(), projectId, `task-${crypto.randomUUID()}`);
    fs.mkdirSync(path.dirname(stranded), { recursive: true });
    await git(root, "worktree", "add", "-b", "ct/stranded", stranded, "main");

    expect(store.list()).toHaveLength(0);
    const report = await manager.reconcileWorktreesOnBoot();

    expect(report).toEqual({ removed: [], unclaimed: [] });
    // Not merely unreported — still there. A guard that only kept it out of the
    // log would be worse than none.
    expect(fs.existsSync(stranded)).toBe(true);
    expect(manager.getUnclaimedWorktrees()).toEqual([]);
  }, 30000);
});
