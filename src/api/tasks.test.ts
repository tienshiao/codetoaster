import { test, expect, describe, beforeAll, afterAll, afterEach, beforeEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { initDatabase } from "../lib/db";
import { taskManager, WIP_RETENTION_MS } from "../lib/tasks/manager";
import { taskRoutes } from "./tasks";
import { taskDir, taskScrollbackPath, taskSettingsPath } from "../lib/agent/spawn";
import { writeSnapshot } from "../lib/tasks/snapshot";
import { readWip } from "../lib/worktree";
import { cleanupRepos, git, tempDir, tempProject, tempRepo } from "../../test/git-repo";

// Driven through a real Bun.serve, so the params, status codes and JSON bodies
// under test are the ones a client actually gets.
let server: ReturnType<typeof Bun.serve>;
let base: string;
let dbDir: string;

// A task now starts its agent, and these tests create a lot of them — so the
// agent has to be stood in for, or the suite starts a real Claude Code session
// per test, each with a transcript on disk. This file used to write its own
// one-line script for that; `test/preload.ts` now does it for every test file
// at once (TASK-62), which is `test/fake-agent.sh` and carries the reasoning
// for why it is `exec cat` and not something that reads its argv.

beforeAll(() => {
  dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-taskroutes-"));
  initDatabase(path.join(dbDir, "codetoaster.db"));
  taskManager.loadProjects();
  server = Bun.serve({ port: 0, routes: taskRoutes as any, fetch: () => new Response("", { status: 404 }) });
  base = `http://localhost:${server.port}`;
});

afterEach(async () => {
  // `deleteTask`, not `closeTask`: close is a suspend now, and a suspended row
  // stays in `listTasks` — cleaning up with it would leave every task of every
  // test in the next test's list.
  // Awaited now that delete also removes the checkout and the task's directory
  // (TASK-31): the git in it runs after the row is gone, so a test that did not
  // wait would hand the next one a repository still being changed.
  //
  // Both lists: an archived row is out of `listTasks` but very much still in
  // the database, and `?lifecycle=archived` is now a thing tests read — so one
  // test's archive would otherwise turn up in the next one's list.
  for (const task of [...taskManager.listTasks(), ...taskManager.listArchivedTasks()]) {
    await taskManager.deleteTask(task.id);
  }
  // Delete takes `~/.codetoaster/tasks/<id>/` with it now, but this still has
  // to run: a test that archived or deleted its own task is already out of
  // `listTasks`, and one whose route 500'd never got as far as either. Cleanup
  // runs off what was created, not off what is still live.
  for (const id of created.splice(0)) {
    fs.rmSync(taskDir(id), { recursive: true, force: true });
  }
  // Killed PTYs write from onExit a tick later; let that land before the next
  // test, and before afterAll takes the database away.
  await Bun.sleep(50);
});

afterAll(() => {
  // No agent binary to put back: the preload re-establishes it before every
  // test, so leaking one out of this file is no longer something to guard.
  server.stop(true);
  fs.rmSync(dbDir, { recursive: true, force: true });
});

// Every task id the route handed back, so afterEach can clear the directories
// they left in ~/.codetoaster/tasks.
const created: string[] = [];

async function post(body: unknown, url = "/api/tasks") {
  const res = await fetch(`${base}${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  if (res.status === 201) {
    // Read off a clone: the caller still gets an unconsumed body.
    const task = await res.clone().json();
    if (typeof task?.id === "string") created.push(task.id);
  }
  return res;
}

function patch(id: string, body: unknown) {
  return fetch(`${base}/api/tasks/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/tasks", () => {
  test("creates the task and answers 201 with its info", async () => {
    const res = await post({ cols: 100, rows: 30 });
    expect(res.status).toBe(201);

    const task = await res.json();
    expect(task.id).toBeString();
    expect(task.lifecycle).toBe("live");
    expect(task.agentState).toBe("starting");
    expect(task.title.length).toBeGreaterThan(0);
    // The terminal is running and is addressed separately from the task.
    expect(task.ptyId).toBeString();
    expect(task.ptyId).not.toBe(task.id);
    expect(taskManager.primaryPty(task.id)!.id).toBe(task.ptyId);
    expect(task.size).toEqual({ cols: 100, rows: 30 });
  });

  test("records the prompt, model and permission mode on the row", async () => {
    const res = await post({
      prompt: "fix the parser\nand the tests",
      model: "opus",
      permissionMode: "acceptEdits",
      title: "Chosen",
    });
    const task = await res.json();
    const row = taskManager.getTask(task.id)!;
    // Newlines survive: the prompt is a value, not something typed at a shell.
    expect(row.initial_prompt).toBe("fix the parser\nand the tests");
    expect(row.model).toBe("opus");
    expect(row.permission_mode).toBe("acceptEdits");
    expect(row.title).toBe("Chosen");
    expect(row.title_source).toBe("manual");
  });

  // A name in the daemon's registry, never a command (TASK-89): a profile is
  // an argv template, and one arriving in a body would be the raw argv over
  // HTTP that TASK-42 closed off. So the body names, and the daemon looks up.
  test("a known profile lands on the row", async () => {
    const res = await post({ profile: "shell" });
    const task = await res.json();

    expect(res.status).toBe(201);
    expect(task.profile).toBe("shell");
    expect(taskManager.getTask(task.id)!.agent_profile).toBe("shell");
  });

  // A 400 and not a 500: it is a name the caller typed. And not a silent fall
  // back to claude either — a request that asked for something else must not
  // quietly get a real Claude Code session instead.
  test("an unknown profile is a 400 that names it, and creates nothing", async () => {
    const before = taskManager.listTasks().length;
    const res = await post({ profile: "nope" });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("nope");
    // Checked before the worktree and before the row, so there is nothing to
    // have left behind.
    expect(taskManager.listTasks().length).toBe(before);
  });

  test("a task that names no profile runs claude", async () => {
    const task = await (await post({})).json();
    expect(task.profile).toBe("claude");
  });

  test("a prompt of nothing but whitespace is refused, not reinterpreted", async () => {
    for (const prompt of ["", "   ", "  \n\t\n "]) {
      const res = await post({ prompt });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(`"prompt" cannot be blank`);
    }
    // Nothing was created on the way to saying so.
    expect(taskManager.listTasks()).toHaveLength(0);
  });

  test("a prompt keeps its shape but loses its surrounding space", async () => {
    const task = await (await post({ prompt: "  fix the parser\n\nand the tests  " })).json();
    // Trimmed at the edges only: the blank line in the middle is the user's.
    expect(taskManager.getTask(task.id)!.initial_prompt).toBe("fix the parser\n\nand the tests");
    expect(task.title).toBe("fix the parser");
  });

  // Absent and blank are two different things: a task can be started with
  // nothing to say — the sidebar's New task button — and that is not a mistake
  // the way an empty prompt field is.
  test("a task with no prompt at all is allowed", async () => {
    const task = await (await post({})).json();
    expect(taskManager.getTask(task.id)!.initial_prompt).toBe("");
  });

  test("rejects a body that isn't a JSON object", async () => {
    for (const body of ["not json", "[1,2]", '"a string"']) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Expected a JSON object body");
    }
  });

  test("rejects fields of the wrong type, naming the one at fault", async () => {
    const res = await post({ title: 42 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('"title" must be a string');

    const sizes = await post({ cols: "wide" });
    expect(sizes.status).toBe(400);
    expect((await sizes.json()).error).toContain("cols");
  });

  test("rejects an unknown project rather than quietly using General", async () => {
    const res = await post({ projectId: "no-such-project" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Unknown project "no-such-project"');
  });

  test("rejects a non-boolean worktree flag", async () => {
    const res = await post({ prompt: "x", worktree: "yes" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("worktree");
  });

  test("a blank base ref is a mistake, not a way of asking for the default", async () => {
    // Absent means "the project's default", and the route has to keep that
    // distinct from a ref named nothing, which git would refuse anyway.
    const res = await post({ prompt: "x", baseRef: "   " });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("baseRef");
  });

  // Graded off `WorktreeError.kind`, and this one is the caller's mistake. The
  // composer disables the toggle for a project with no directory, so only the
  // API and the CLI can ask for it — exactly the callers a 5xx would tell to
  // retry something that can never succeed.
  test("asking for a worktree where there is no repository is a 400, not a 500", async () => {
    const res = await post({ prompt: "x", projectId: "general", worktree: true });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("no directory");
  });

  test("404s when asked to sit after a task that isn't there", async () => {
    const res = await post({ afterTaskId: "no-such-task" });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Unknown task "no-such-task"');
  });

  test("a spawn failure is a 500 with a body, not a session that never appears", async () => {
    const bin = process.env.CODETOASTER_AGENT_BIN;
    process.env.CODETOASTER_AGENT_BIN = "/nonexistent/codetoaster-not-an-agent";
    try {
      const res = await post({});
      expect(res.status).toBe(500);
      expect((await res.json()).error).toBeString();
      // And nothing is left behind holding the id.
      expect(taskManager.listTasks()).toHaveLength(0);
    } finally {
      if (bin === undefined) delete process.env.CODETOASTER_AGENT_BIN;
      else process.env.CODETOASTER_AGENT_BIN = bin;
    }
  });
});

describe("PATCH /api/tasks/:id", () => {
  test("renames the task and stops deriving its title", async () => {
    const created = await (await post({})).json();
    const res = await patch(created.id, { title: "Renamed by hand" });

    expect(res.status).toBe(200);
    const task = await res.json();
    expect(task.title).toBe("Renamed by hand");
    expect(task.titleSource).toBe("manual");
    expect(taskManager.getTask(created.id)!.title_source).toBe("manual");
  });

  test("404s for a task that isn't there", async () => {
    const res = await patch("no-such-task", { title: "x" });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Task not found");
  });

  test("rejects a missing, wrongly typed, or blank title", async () => {
    const created = await (await post({})).json();
    for (const [body, message] of [
      [{}, '"title" is required'],
      [{ title: 7 }, '"title" must be a string'],
      [{ title: "   " }, '"title" cannot be blank'],
    ] as [unknown, string][]) {
      const res = await patch(created.id, body);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(message);
    }
    // The title it had is untouched by any of that.
    expect(taskManager.getTask(created.id)!.title_source).toBe("derived");
  });
});

// The two doors, and the whole of what separates them: §6 makes the close
// button a suspend, and leaves `DELETE` as the interim archive.
describe("POST /api/tasks/:id/close", () => {
  test("suspends the task and kills its terminal, without deleting anything", async () => {
    const created = await (await post({})).json();
    // Typed into the terminal so that there is a screen to save: the stand-in
    // agent is `exec cat`, which paints nothing of its own, and a screen with
    // nothing on it is nothing to snapshot — closing before the first paint
    // leaves whatever snapshot the task already had rather than blanking it.
    const pty = taskManager.getPty(created.ptyId)!;
    pty.write("something on the screen\r");
    for (let i = 0; i < 200 && !pty.serialize().includes("something on the screen"); i++) {
      await Bun.sleep(10);
    }

    const res = await fetch(`${base}/api/tasks/${created.id}/close`, { method: "POST" });

    expect(res.status).toBe(200);
    expect((await res.json()).lifecycle).toBe("suspended");
    expect(taskManager.getTask(created.id)).toBeDefined();
    expect(taskManager.getPty(created.ptyId)).toBeUndefined();
    // What reopening the task is built out of (AC #5).
    expect(fs.existsSync(taskSettingsPath(created.id))).toBe(true);
    expect(fs.existsSync(taskScrollbackPath(created.id))).toBe(true);
  });

  test("closing an already closed task is not an error", async () => {
    const created = await (await post({})).json();
    await fetch(`${base}/api/tasks/${created.id}/close`, { method: "POST" });
    const res = await fetch(`${base}/api/tasks/${created.id}/close`, { method: "POST" });

    expect(res.status).toBe(200);
    expect((await res.json()).lifecycle).toBe("suspended");
  });

  test("404s for a task that isn't there", async () => {
    const res = await fetch(`${base}/api/tasks/no-such-task/close`, { method: "POST" });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Unknown task "no-such-task"');
  });
});

// The first half of the two-phase reopen (§5.5): what the client paints before
// the resumed agent exists.
describe("GET /api/tasks/:id/scrollback", () => {
  function scrollback(id: string) {
    return fetch(`${base}/api/tasks/${id}/scrollback`);
  }

  test("answers the stored screen and the grid it was taken at", async () => {
    const created = await (await post({ cols: 100, rows: 30 })).json();
    // The stand-in agent echoes, so this is the closest thing to a screen the
    // task can be given: what the snapshot has to come back holding.
    taskManager.primaryPty(created.id)!.write("left off here\r");
    await Bun.sleep(100);
    await fetch(`${base}/api/tasks/${created.id}/close`, { method: "POST" });

    const res = await scrollback(created.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toContain("left off here");
    expect(body.size).toEqual({ cols: 100, rows: 30 });
  });

  test("a task with no stored screen answers data: null, not an error", async () => {
    const created = await (await post({})).json();
    const res = await scrollback(created.id);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: null, size: null });
  });

  test("404s for a task that isn't there — which is not the same answer", async () => {
    const res = await scrollback("no-such-task");
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Unknown task "no-such-task"');
  });

  test("a snapshot with no remembered size answers size: null", async () => {
    // A task never closed has no `last_size_*` on its row, so writing a
    // snapshot behind its back is the state a pre-TASK-14 suspension leaves:
    // a screen, and nothing saying what grid it was taken at. The client paints
    // it at its own measured size rather than a fabricated one.
    const created = await (await post({})).json();
    await writeSnapshot(created.id, "an old screen");

    const body = await (await scrollback(created.id)).json();
    expect(body.data).toBe("an old screen");
    expect(body.size).toBeNull();
  });
});

describe("GET /api/tasks/:id/processes", () => {
  function processes(id: string) {
    return fetch(`${base}/api/tasks/${id}/processes`);
  }

  test("a live task answers its agent's tree with the agent at the root", async () => {
    const created = await (await post({})).json();
    const res = await processes(created.id);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.live).toBe(true);
    expect(body.processes[0]).toMatchObject({
      pid: taskManager.primaryPty(created.id)!.pid,
      depth: 0,
      terminal: "agent",
    });
    expect(Array.isArray(body.processes[0].ports)).toBe(true);
  });

  test("a suspended task answers live: false rather than an empty tree or an error", async () => {
    const created = await (await post({})).json();
    await fetch(`${base}/api/tasks/${created.id}/close`, { method: "POST" });

    const res = await processes(created.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ live: false, processes: [], portsKnown: true });
  });

  test("404s for a task that isn't there", async () => {
    const res = await processes("no-such-task");
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Unknown task "no-such-task"');
  });
});

describe("DELETE /api/tasks/:id", () => {
  test("deletes the task and its terminal outright", async () => {
    const created = await (await post({})).json();
    const res = await fetch(`${base}/api/tasks/${created.id}`, { method: "DELETE" });

    expect(res.status).toBe(200);
    expect(taskManager.getTask(created.id)).toBeUndefined();
    expect(taskManager.getPty(created.ptyId)).toBeUndefined();
    expect((await fetch(`${base}/api/tasks/${created.id}`, { method: "DELETE" })).status).toBe(404);
  });
});

describe("POST /api/tasks/:id/delete", () => {
  // The browser's door onto the same removal, and the flag is the whole reason
  // it is a second door: `DELETE` is a verb somebody typed at a shell, while a
  // fetch can be replayed, mis-routed or fired by a shortcut nobody meant to
  // press — and this is the operation with no way back.
  test("refuses to delete without an explicit confirmation", async () => {
    const task = await (await post({})).json();

    expect((await post({}, `/api/tasks/${task.id}/delete`)).status).toBe(400);
    expect((await post({ confirm: "yes" }, `/api/tasks/${task.id}/delete`)).status).toBe(400);
    // And the task is still there, which is the point of refusing.
    expect(taskManager.getTask(task.id)).toBeDefined();
  });

  test("deletes the task when the request says so", async () => {
    const task = await (await post({})).json();

    const res = await post({ confirm: true }, `/api/tasks/${task.id}/delete`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ deleted: true });
    expect(taskManager.getTask(task.id)).toBeUndefined();
    expect(taskManager.getPty(task.ptyId)).toBeUndefined();
  });

  test("404s for a task that isn't there", async () => {
    expect((await post({ confirm: true }, "/api/tasks/nope/delete")).status).toBe(404);
  });
});

describe("/api/tasks/:id/archive", () => {
  // A task with no checkout of its own is the case where archive has nothing to
  // destroy but itself — no branch to weigh, no worktree to remove — and it is
  // the one every task in this file is, since none of them asks for a worktree.
  // What it proves is the lifecycle half: the row is kept and the task leaves.
  test("archives the task, keeps the row, and takes it out of the list", async () => {
    const task = await (await post({})).json();

    const res = await post({}, `/api/tasks/${task.id}/archive`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.archived).toBe(true);
    // Null rather than an invented zero: there is no branch of ours to describe.
    expect(body.status).toBeNull();
    expect(body.branch).toBeNull();

    expect(taskManager.getTask(task.id)?.lifecycle).toBe("archived");
    expect(taskManager.listTasks().map((t) => t.id)).not.toContain(task.id);
    expect(taskManager.getPty(task.ptyId)).toBeUndefined();
  });

  // Not an error: two browsers can be showing the same confirmation, and the
  // row is in the state that was asked for either way. `archived: false` is the
  // honest answer — this request did not do it.
  test("archiving twice reports that the second one did nothing", async () => {
    const task = await (await post({})).json();
    await post({}, `/api/tasks/${task.id}/archive`);

    const res = await post({}, `/api/tasks/${task.id}/archive`);
    expect(res.status).toBe(200);
    expect((await res.json()).archived).toBe(false);
  });

  test("the preview answers without archiving anything", async () => {
    const task = await (await post({})).json();

    const res = await fetch(`${base}/api/tasks/${task.id}/archive`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: null, branch: null, branchWouldBeDeleted: false, wipRetentionDays: 30,
    });
    // Still live: reading what an archive would cost must not cost it.
    expect(taskManager.getTask(task.id)?.lifecycle).toBe("live");
  });

  test("404s for a task that isn't there, either way round", async () => {
    expect((await fetch(`${base}/api/tasks/nope/archive`)).status).toBe(404);
    expect((await post({}, "/api/tasks/nope/archive")).status).toBe(404);
  });
});

describe("/api/tasks/:id/unarchive", () => {
  // Real repositories, because every interesting case is a fact about git: a
  // branch the archive deleted, a snapshot the sweep dropped, a remote that
  // still holds what the local branch did. The worktrees land under the real
  // `~/.codetoaster/worktrees/<projectId>`, which `cleanupRepos` takes away.
  const projectIds: string[] = [];

  beforeEach(() => {
    // The resume ladder waits this long for an agent that sends no hooks —
    // the fake one never does — before calling it up. Four seconds per
    // unarchive is the production cap and nothing here is asking about it.
    taskManager.setStartTimeout(200);
  });

  afterEach(async () => {
    // Before the outer hook, and before the repositories go: `deleteTask`'s
    // purge runs git in them.
    for (const task of [...taskManager.listTasks(), ...taskManager.listArchivedTasks()]) {
      await taskManager.deleteTask(task.id);
    }
    for (const id of projectIds.splice(0)) taskManager.deleteProject(id);
    cleanupRepos();
    taskManager.setStartTimeout(4_000);
  });

  async function repoProject(): Promise<{ root: string; projectId: string }> {
    const { root } = await tempRepo();
    const { id } = tempProject(root);
    projectIds.push(id);
    taskManager.createProject(id, "Unarchive repo", root);
    return { root, projectId: id };
  }

  /** A task with a checkout of its own, branched from `main`. */
  async function worktreeTask(projectId: string) {
    const res = await post({ projectId, prompt: "unarchive me", worktree: true, baseRef: "main" });
    expect(res.status).toBe(201);
    const task = await res.json();
    const row = taskManager.getTask(task.id)!;
    return { id: task.id as string, branch: row.branch!, worktree: row.worktree_path! };
  }

  /** One commit on the task's branch, so the archive keeps it: an unmerged,
   * unpushed branch is the one archive never deletes. */
  async function commitOnBranch(worktree: string) {
    fs.writeFileSync(path.join(worktree, "feature.txt"), "committed\n");
    await git(worktree, "add", "-A");
    await git(worktree, "commit", "-qm", "the task's commit");
  }

  async function archive(id: string) {
    const res = await post({}, `/api/tasks/${id}/archive`);
    expect(res.status).toBe(200);
    expect(taskManager.getTask(id)!.lifecycle).toBe("archived");
  }

  /** The retention sweep, run the way boot runs it, against a snapshot dated
   * past its window. */
  async function expireSnapshot(id: string) {
    const row = taskManager.getTask(id)!;
    // Through the store's own update, the way `archive.test.ts` dates one.
    (taskManager as any).store.update(id, { wip_at: row.wip_at! - WIP_RETENTION_MS - 1 });
    expect(await taskManager.expireArchivedWip()).toBe(1);
  }

  function preview(id: string) {
    return fetch(`${base}/api/tasks/${id}/unarchive`);
  }

  // AC #2: the whole round trip, for the ordinary case — a branch with work on
  // it, which archive keeps, and uncommitted files, which only the snapshot has.
  test("brings the checkout back on its branch with the uncommitted work, and resumes", async () => {
    const { root, projectId } = await repoProject();
    const { id, branch, worktree } = await worktreeTask(projectId);
    await commitOnBranch(worktree);
    fs.writeFileSync(path.join(worktree, "README.md"), "modified, not committed\n");
    fs.writeFileSync(path.join(worktree, "scratch.txt"), "untracked\n");
    await archive(id);
    expect(fs.existsSync(worktree)).toBe(false);

    const shown = await preview(id);
    expect(shown.status).toBe(200);
    const body = await shown.json();
    expect(body.checkout).toBe("restore");
    expect(body.branch).toBe(branch);
    expect(body.baseRef).toBe("main");
    expect(body.snapshot.state).toBe("kept");
    expect(body.snapshot.stale).toBe(false);
    expect(body.snapshot.expiresAt).toBe(taskManager.getTask(id)!.wip_at! + WIP_RETENTION_MS);
    // Reading what unarchiving restores must not do it.
    expect(taskManager.getTask(id)!.lifecycle).toBe("archived");

    const res = await post({ cols: 100, rows: 30 }, `/api/tasks/${id}/unarchive`);
    expect(res.status).toBe(200);
    const { task } = await res.json();
    expect(task.id).toBe(id);
    expect(task.lifecycle).toBe("live");
    expect(task.worktreeState).toBe("present");
    expect(task.ptyId).toBeString();
    expect(taskManager.listTasks().map((t) => t.id)).toContain(id);
    expect(taskManager.listArchivedTasks().map((t) => t.id)).not.toContain(id);

    // The work, as it was left: committed, modified, untracked.
    expect(fs.readFileSync(path.join(worktree, "feature.txt"), "utf8")).toBe("committed\n");
    expect(fs.readFileSync(path.join(worktree, "README.md"), "utf8")).toBe("modified, not committed\n");
    expect(fs.readFileSync(path.join(worktree, "scratch.txt"), "utf8")).toBe("untracked\n");
    const status = await git(worktree, "status", "--porcelain");
    // Modified in the tree and not staged: the snapshot comes back as dirt.
    expect(status.split("\n")).toContain("M README.md");
    expect(status).toContain("?? scratch.txt");
    expect(await git(worktree, "rev-parse", "--abbrev-ref", "HEAD")).toBe(branch);
    // Consumed: the ref is gone and the row no longer names it.
    expect(await readWip(root, id)).toBeNull();
    expect(taskManager.getTask(id)!.wip_ref).toBeNull();
    // What archive removed comes back with the spawn.
    expect(fs.existsSync(taskSettingsPath(id))).toBe(true);
  }, 30000);

  // Archive deletes a merged branch — and a branch with no commits of its own
  // is merged by definition — so this is the commonest way back, not an edge.
  test("a branch the archive deleted is recreated where the snapshot was taken", async () => {
    const { root, projectId } = await repoProject();
    const { id, branch, worktree } = await worktreeTask(projectId);
    fs.writeFileSync(path.join(worktree, "scratch.txt"), "only in the snapshot\n");
    await archive(id);
    expect(await git(root, "branch", "--list", branch)).toBe("");
    const parent = (await readWip(root, id))!.parent;

    const body = await (await preview(id)).json();
    expect(body.checkout).toBe("from-snapshot");
    expect(body.snapshot.state).toBe("kept");

    const res = await post({}, `/api/tasks/${id}/unarchive`);
    expect(res.status).toBe(200);
    expect((await res.json()).task.lifecycle).toBe("live");
    expect(await git(root, "rev-parse", `refs/heads/${branch}`)).toBe(parent);
    expect(fs.readFileSync(path.join(worktree, "scratch.txt"), "utf8")).toBe("only in the snapshot\n");
  }, 30000);

  // AC #4 and #6: the snapshot is gone, and the dialog has to be able to say so
  // before anything happens — then the unarchive restores what is left.
  test("an expired snapshot is reported, and the unarchive still restores the branch", async () => {
    const { root, projectId } = await repoProject();
    const { id, branch, worktree } = await worktreeTask(projectId);
    await commitOnBranch(worktree);
    fs.writeFileSync(path.join(worktree, "scratch.txt"), "lost with the snapshot\n");
    await archive(id);
    await expireSnapshot(id);
    expect(await readWip(root, id)).toBeNull();

    const body = await (await preview(id)).json();
    // The branch survived — it held an unpushed commit — so the checkout comes
    // back; the dirt does not.
    expect(body.checkout).toBe("restore");
    expect(body.snapshot.state).toBe("expired");
    expect(typeof body.snapshot.expiredAt).toBe("number");

    const res = await post({}, `/api/tasks/${id}/unarchive`);
    expect(res.status).toBe(200);
    expect((await res.json()).task.lifecycle).toBe("live");
    expect(await git(worktree, "rev-parse", "--abbrev-ref", "HEAD")).toBe(branch);
    expect(fs.existsSync(path.join(worktree, "feature.txt"))).toBe(true);
    expect(fs.existsSync(path.join(worktree, "scratch.txt"))).toBe(false);
  }, 30000);

  test("with the snapshot expired and the branch gone, it says the work is lost and branches from base", async () => {
    const { root, projectId } = await repoProject();
    const mainSha = await git(root, "rev-parse", "main");
    const { id, branch, worktree } = await worktreeTask(projectId);
    fs.writeFileSync(path.join(worktree, "scratch.txt"), "lost\n");
    await archive(id);
    await expireSnapshot(id);
    expect(await git(root, "branch", "--list", branch)).toBe("");

    const body = await (await preview(id)).json();
    expect(body.checkout).toBe("from-base");
    expect(body.snapshot.state).toBe("expired");

    const res = await post({}, `/api/tasks/${id}/unarchive`);
    expect(res.status).toBe(200);
    expect((await res.json()).task.lifecycle).toBe("live");
    expect(await git(root, "rev-parse", `refs/heads/${branch}`)).toBe(mainSha);
    expect(fs.existsSync(worktree)).toBe(true);
    expect(fs.existsSync(path.join(worktree, "scratch.txt"))).toBe(false);
  }, 30000);

  test("with the snapshot expired and the branch pushed, it comes back from the remote", async () => {
    const { root, projectId } = await repoProject();
    const remote = tempDir("codetoaster-unarchive-remote-");
    await git(remote, "init", "--bare", "-q", "-b", "main");
    await git(root, "remote", "add", "origin", remote);
    const { id, branch, worktree } = await worktreeTask(projectId);
    await commitOnBranch(worktree);
    await git(worktree, "push", "-q", "origin", branch);
    await git(root, "fetch", "-q", "origin");
    const pushed = await git(root, "rev-parse", `refs/remotes/origin/${branch}`);
    // Pushed is expendable, so the archive deletes the local branch.
    await archive(id);
    expect(await git(root, "branch", "--list", branch)).toBe("");
    await expireSnapshot(id);

    const body = await (await preview(id)).json();
    expect(body.checkout).toBe("from-remote");
    expect(body.snapshot.state).toBe("expired");

    const res = await post({}, `/api/tasks/${id}/unarchive`);
    expect(res.status).toBe(200);
    expect(await git(root, "rev-parse", `refs/heads/${branch}`)).toBe(pushed);
    expect(fs.readFileSync(path.join(worktree, "feature.txt"), "utf8")).toBe("committed\n");
  }, 30000);

  // AC #3: nothing of ours on disk to rebuild, so unarchiving is a resume.
  test("a task that ran in the project's directory unarchives by resuming", async () => {
    // The `shell` profile, because its ladder is a restart and always has a
    // rung. A `claude` task in a shared directory with no transcript — which is
    // every one the fake agent makes — has no rung it may safely take there
    // (TASK-43), and lands `could_not_resume` from `/resume` just the same.
    const task = await (await post({ profile: "shell" })).json();
    await archive(task.id);

    const shown = await preview(task.id);
    expect(shown.status).toBe(200);
    expect(await shown.json()).toEqual({
      checkout: "none",
      snapshot: { state: "none" },
      branch: null,
      baseRef: null,
    });

    const res = await post({}, `/api/tasks/${task.id}/unarchive`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.task.lifecycle).toBe("live");
    expect(body.task.worktreeState).toBe("none");
    expect(body.task.cwd).toBe(process.cwd());
    expect(taskManager.listTasks().map((t) => t.id)).toContain(task.id);
  }, 30000);

  test("404s for a task that isn't there, either way round", async () => {
    const shown = await preview("nope");
    expect(shown.status).toBe(404);
    expect((await shown.json()).error).toContain("nope");
    const res = await post({}, "/api/tasks/nope/unarchive");
    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain("nope");
  });

  test("409s for a task that is not archived, and leaves it alone", async () => {
    const task = await (await post({})).json();

    const shown = await preview(task.id);
    expect(shown.status).toBe(409);
    expect((await shown.json()).error).toBe("Task is not archived");

    const res = await post({}, `/api/tasks/${task.id}/unarchive`);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("not archived");
    expect(taskManager.getTask(task.id)!.lifecycle).toBe("live");
    expect(taskManager.primaryPty(task.id)!.id).toBe(task.ptyId);
  });

  test("a size that is not a number is a 400", async () => {
    const task = await (await post({})).json();
    await archive(task.id);

    const res = await post({ cols: "wide" }, `/api/tasks/${task.id}/unarchive`);
    expect(res.status).toBe(400);
    expect(taskManager.getTask(task.id)!.lifecycle).toBe("archived");
  });

  // Resume keeps refusing an archived row: unarchive is the only door.
  test("resume still refuses an archived task", async () => {
    const task = await (await post({})).json();
    await archive(task.id);

    const res = await post({}, `/api/tasks/${task.id}/resume`);
    expect(res.status).toBe(409);
    expect(taskManager.getTask(task.id)!.lifecycle).toBe("archived");
  });
});

describe("GET /api/tasks", () => {
  test("lists live tasks with their directories", async () => {
    const created = await (await post({})).json();
    const list = await (await fetch(`${base}/api/tasks`)).json();
    expect(list.map((t: any) => t.id)).toEqual([created.id]);
    expect(list[0].cwd).toBe(process.cwd());
  });

  // The sidebar's archived toggle (§7.5). The two lists are disjoint, and that
  // is the whole contract: the live list is what the socket broadcasts and the
  // archived one only ever grows, which is why it is fetched rather than
  // pushed.
  test("?lifecycle=archived answers with exactly the rows the live list drops", async () => {
    const kept = await (await post({})).json();
    const gone = await (await post({})).json();
    await post({}, `/api/tasks/${gone.id}/archive`);

    const live = await (await fetch(`${base}/api/tasks`)).json();
    expect(live.map((t: any) => t.id)).toEqual([kept.id]);

    const archived = await (await fetch(`${base}/api/tasks?lifecycle=archived`)).json();
    expect(archived.map((t: any) => t.id)).toEqual([gone.id]);
    expect(archived[0].lifecycle).toBe("archived");
  });

  test("?lifecycle=active is the default, spelled out", async () => {
    const created = await (await post({})).json();
    const list = await (await fetch(`${base}/api/tasks?lifecycle=active`)).json();
    expect(list.map((t: any) => t.id)).toEqual([created.id]);
  });

  // Refused rather than quietly answered with the live list: a caller that
  // misspelled `archived` would otherwise get the opposite set of rows and no
  // sign that it had asked for the wrong thing.
  test("an unknown lifecycle is a 400, not the live list", async () => {
    const res = await fetch(`${base}/api/tasks?lifecycle=archvied`);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBeString();
  });
});

describe("POST /api/tasks/:id/shell", () => {
  test("opens a shell beside the agent and hands back both", async () => {
    const created = await (await post({})).json();

    const res = await fetch(`${base}/api/tasks/${created.id}/shell`, { method: "POST" });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ptyId).toBeString();
    expect(body.ptyId).not.toBe(created.ptyId);
    // The agent is unmoved: what the task's agent tab attaches to has not
    // become the shell.
    expect(body.task.ptyId).toBe(created.ptyId);
    // And the response carries the reconciliation the client needs, so the tab
    // and the fact that its PTY is live arrive together rather than racing over
    // two transports.
    expect(body.task.shellPtyIds).toEqual([body.ptyId]);
    expect(taskManager.getPty(body.ptyId)).toBeDefined();
    expect(taskManager.taskIdForPty(body.ptyId)).toBe(created.id);
  });

  test("answers 404 for a task that does not exist", async () => {
    const res = await fetch(`${base}/api/tasks/nope/shell`, { method: "POST" });
    expect(res.status).toBe(404);
  });

  test("refuses a suspended task rather than resuming it", async () => {
    const created = await (await post({})).json();
    await fetch(`${base}/api/tasks/${created.id}/close`, { method: "POST" });

    const res = await fetch(`${base}/api/tasks/${created.id}/shell`, { method: "POST" });

    // Reopening a task is the agent's affair (§5.5's two phases), and a click
    // on `+` is not a request to restart a conversation.
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBeString();
    expect(taskManager.taskInfo(created.id)!.shellPtyIds).toEqual([]);
  });
});

describe("DELETE /api/tasks/:id/shell/:ptyId", () => {
  test("kills that shell and leaves the conversation running", async () => {
    const created = await (await post({})).json();
    const { ptyId } = await (
      await fetch(`${base}/api/tasks/${created.id}/shell`, { method: "POST" })
    ).json();

    const res = await fetch(`${base}/api/tasks/${created.id}/shell/${ptyId}`, { method: "DELETE" });

    expect(res.status).toBe(200);
    expect((await res.json()).task.shellPtyIds).toEqual([]);
    expect(taskManager.getPty(ptyId)).toBeUndefined();
    // The task is still live, and still has its agent.
    expect(taskManager.getTask(created.id)!.lifecycle).toBe("live");
    expect(taskManager.getPty(created.ptyId)).toBeDefined();
  });

  test("will not take the agent's terminal down by the wrong door", async () => {
    const created = await (await post({})).json();

    const res = await fetch(`${base}/api/tasks/${created.id}/shell/${created.ptyId}`, {
      method: "DELETE",
    });

    // The agent tab is not closable (§7.2); a client that asked anyway gets a
    // 404 rather than a suspended task with no snapshot taken.
    expect(res.status).toBe(404);
    expect(taskManager.getPty(created.ptyId)).toBeDefined();
    expect(taskManager.getTask(created.id)!.lifecycle).toBe("live");
  });

  test("answers 404 for a PTY the task does not hold", async () => {
    const created = await (await post({})).json();
    const other = await (await post({})).json();
    const { ptyId } = await (
      await fetch(`${base}/api/tasks/${other.id}/shell`, { method: "POST" })
    ).json();

    // Another task's shell is not this task's to close.
    const res = await fetch(`${base}/api/tasks/${created.id}/shell/${ptyId}`, { method: "DELETE" });
    expect(res.status).toBe(404);
    expect(taskManager.getPty(ptyId)).toBeDefined();

    expect(
      (await fetch(`${base}/api/tasks/nope/shell/${ptyId}`, { method: "DELETE" })).status,
    ).toBe(404);
  });
});
