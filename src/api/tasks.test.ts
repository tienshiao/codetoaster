import { test, expect, describe, beforeAll, afterAll, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { initDatabase } from "../lib/db";
import { taskManager } from "../lib/tasks/manager";
import { taskRoutes } from "./tasks";
import { taskDir, taskScrollbackPath, taskSettingsPath } from "../lib/agent/spawn";
import { writeSnapshot } from "../lib/tasks/snapshot";

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
