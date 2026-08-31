import { test, expect, describe, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { applyMigrations } from "../db";
import { TaskStore } from "./store";
import { TaskManager } from "./manager";
import { gitSpawn } from "../../api/utils";
import { taskDir } from "../agent/spawn";
import { setupStampPath, worktreesRoot } from "../worktree";

// Giving a task a checkout of its own (docs/v2-architecture.md §5.6, TASK-30).
// `lib/worktree` is tested on its own against temporary repositories; this is
// about the wiring — what `createTask` decides, what reaches the row, and what
// the agent is actually spawned as.
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

afterEach(() => {
  for (const m of managers) {
    for (const task of m.listTasks()) m.deleteTask(task.id);
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

async function waitFor(predicate: () => boolean, ms = 5000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return predicate();
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
      expect(await waitFor(() => fs.existsSync(path.join(row.cwd, "setup-ran")))).toBe(true);
      expect(await waitFor(() => agent.argv().length > 0)).toBe(true);

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
      expect(await waitFor(() => fs.existsSync(setupStampPath(id)))).toBe(true);

      manager.applyHook(id, { hook_event_name: "SessionStart", session_id: "s1" } as any);

      expect(await waitFor(() => store.get(id)?.setup_duration_ms !== null)).toBe(true);
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
