import { test, expect, describe, beforeAll, afterAll, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { initDatabase } from "../lib/db";
import { taskDir } from "../lib/agent/spawn";
import { taskManager } from "../lib/tasks/manager";
import type { Pty } from "../lib/xtmux/pty";
import { uploadsDir } from "../lib/uploads";
import { uploadRoutes } from "./uploads";
import { waitFor } from "../../test/wait";

// Through a real Bun.serve, like the route tests beside it, so the status and
// the JSON body under test are the ones a client gets. What `saveUploads`
// itself does with a name is `lib/uploads.test.ts`.
let server: ReturnType<typeof Bun.serve>;
let base: string;
// Everything the route wrote. The root handed to the route is `uploadsDir()`,
// so what keeps this off the developer's own ~/.codetoaster/uploads is
// `test/uploads.ts` pinning CODETOASTER_UPLOADS_DIR at a temporary one before
// every test. Removed after each test anyway, so a long `bun test` does not
// accumulate them.
const written: string[] = [];

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    routes: uploadRoutes(uploadsDir()) as any,
    fetch: () => new Response("", { status: 404 }),
  });
  base = `http://localhost:${server.port}`;
});

afterEach(() => {
  while (written.length) fs.rmSync(written.pop()!, { recursive: true, force: true });
});

afterAll(() => server.stop(true));

async function post(form: FormData): Promise<Response> {
  const res = await fetch(`${base}/api/uploads`, { method: "POST", body: form });
  if (res.status === 200) {
    const { paths } = (await res.clone().json()) as { paths: string[] };
    for (const p of paths) written.push(path.dirname(p));
  }
  return res;
}

describe("POST /api/uploads", () => {
  test("writes the files and answers with their paths", async () => {
    const form = new FormData();
    form.append("files", new File(["png-bytes"], "shot.png"));
    form.append("files", new File(["lines"], "run.log"));
    const res = await post(form);

    expect(res.status).toBe(200);
    const { paths } = (await res.json()) as { paths: string[] };
    expect(paths).toHaveLength(2);
    expect(paths.every((p) => p.startsWith(uploadsDir() + path.sep))).toBe(true);
    expect(paths.map((p) => path.basename(p))).toEqual(["shot.png", "run.log"]);
    expect(fs.readFileSync(paths[0]!, "utf8")).toBe("png-bytes");
    expect(fs.readFileSync(paths[1]!, "utf8")).toBe("lines");
  });

  test("a body with no file parts is a 400, not an empty success", async () => {
    const form = new FormData();
    form.append("files", "not-a-file");
    const res = await post(form);
    expect(res.status).toBe(400);
  });
});

// The task-scoped route needs a task with terminals, which needs a database.
// A shell-profile task rather than an agent one: its primary PTY is a real
// shell that echoes what is typed at it, which is how the test reads back
// *where* a path landed — and `test/preload.ts`'s fake agent is `cat`, which
// would do the same, but a shell task also answers `openShell` without an
// agent having to be stood in for at all.
describe("POST /api/tasks/:id/upload", () => {
  let dbDir: string;

  beforeAll(() => {
    dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-uploadroute-"));
    initDatabase(path.join(dbDir, "codetoaster.db"));
    taskManager.loadProjects();
  });

  afterEach(async () => {
    for (const row of [...taskManager.listTasks(), ...taskManager.listArchivedTasks()]) {
      await taskManager.deleteTask(row.id);
      fs.rmSync(taskDir(row.id), { recursive: true, force: true });
    }
    // Killed PTYs write from onExit a tick later; let that land before the
    // database goes away.
    await Bun.sleep(50);
  });

  afterAll(() => fs.rmSync(dbDir, { recursive: true, force: true }));

  async function shellTask(): Promise<{ id: string; agent: Pty; shell: Pty }> {
    const id = crypto.randomUUID();
    await taskManager.createTask({ id, profile: "shell", cols: 120, rows: 30 });
    const agent = taskManager.primaryPty(id)!;
    const shell = taskManager.openShell(id, { cols: 120, rows: 30 })!;
    return { id, agent, shell };
  }

  async function upload(id: string, query = ""): Promise<Response> {
    const form = new FormData();
    form.append("files", new File(["png-bytes"], "Screenshot 2026-09-07.png"));
    const res = await fetch(`${base}/api/tasks/${id}/upload${query}`, { method: "POST", body: form });
    if (res.status === 200) {
      const { paths } = (await res.clone().json()) as { paths: string[] };
      for (const p of paths) written.push(path.dirname(p));
    }
    return res;
  }

  /** The grid once the shell has echoed the typed path, or as it stands after a
   * wait long enough that it would have. */
  async function screenOf(pty: Pty, expecting: string): Promise<string> {
    await waitFor(() => pty.serialize().includes(expecting));
    return pty.serialize();
  }

  test("with no terminal named, the paths are typed into the agent's", async () => {
    const { id, agent, shell } = await shellTask();
    const res = await upload(id);
    expect(res.status).toBe(200);
    const { paths } = (await res.json()) as { paths: string[] };
    expect(paths.map((p) => path.basename(p))).toEqual(["Screenshot 2026-09-07.png"]);

    expect(await screenOf(agent, "Screenshot")).toContain(`'${paths[0]}'`);
    expect(shell.serialize()).not.toContain("Screenshot");
  });

  test("naming one of the task's shells types them into that shell instead", async () => {
    const { id, agent, shell } = await shellTask();
    const res = await upload(id, `?pty=${encodeURIComponent(shell.id)}`);
    expect(res.status).toBe(200);
    const { paths } = (await res.json()) as { paths: string[] };

    expect(await screenOf(shell, "Screenshot")).toContain(`'${paths[0]}'`);
    expect(agent.serialize()).not.toContain("Screenshot");
  });

  test("a terminal that is not this task's is a 404, and nothing is written", async () => {
    const { id, agent, shell } = await shellTask();
    const other = await shellTask();
    const res = await upload(id, `?pty=${encodeURIComponent(other.shell.id)}`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe("That terminal is gone");

    await Bun.sleep(100);
    for (const pty of [agent, shell, other.agent, other.shell]) {
      expect(pty.serialize()).not.toContain("Screenshot");
    }
  });

  test("a terminal that died while the upload was in flight is a 404", async () => {
    // The multipart read and the disk write both take time, and `Pty.write`
    // silently no-ops on an exited PTY — so without the second check this would
    // answer 200 with paths that were typed nowhere.
    const { id, shell } = await shellTask();
    shell.kill();
    expect(await waitFor(() => shell.exited)).toBe(true);

    const res = await upload(id, `?pty=${encodeURIComponent(shell.id)}`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe("That terminal is gone");
  });

  test("a task with no live terminal is a 404", async () => {
    const res = await upload(crypto.randomUUID());
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe("Task has no live terminal");
  });
});
