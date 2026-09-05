import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { initDatabase } from "../lib/db";
import { taskManager } from "../lib/tasks/manager";
import { ProfileRegistry } from "../lib/agent/profiles";
import { builtinProfiles } from "../lib/agent/profile";
import { profileRoutes } from "./profiles";

// Through a real Bun.serve, like the task routes beside it, so the status and
// the JSON body under test are the ones a client gets.
let server: ReturnType<typeof Bun.serve>;
let base: string;
let dbDir: string;

beforeAll(() => {
  dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-profileroutes-"));
  initDatabase(path.join(dbDir, "codetoaster.db"));
  taskManager.loadProjects();
  server = Bun.serve({
    port: 0,
    routes: profileRoutes as any,
    fetch: () => new Response("", { status: 404 }),
  });
  base = `http://localhost:${server.port}`;
});

afterAll(() => {
  // The registry is process-wide, and this file replaces it. Put the built-ins
  // back, or every later file in the run is choosing agents from this one's
  // list.
  taskManager.setProfiles(new ProfileRegistry(builtinProfiles()));
  server.stop(true);
  fs.rmSync(dbDir, { recursive: true, force: true });
});

interface Row {
  name: string;
  label: string;
  capabilities: Record<string, boolean>;
}

async function list(): Promise<Row[]> {
  const res = await fetch(`${base}/api/profiles`);
  expect(res.status).toBe(200);
  return res.json();
}

describe("GET /api/profiles", () => {
  test("lists the built-ins with their labels and capabilities", async () => {
    const rows = await list();
    const byName = new Map(rows.map((r) => [r.name, r]));

    // Built-in order, which is the order the composer offers.
    expect(rows.map((r) => r.name)).toEqual(["claude", "shell", "pi"]);
    expect(byName.get("claude")!.label).toBe("Claude Code");

    // Capabilities, not templates: the argv stays the daemon's business, and
    // what a client needs is which controls beside a profile still mean
    // anything. claude takes everything; the shell takes nothing at all.
    expect(byName.get("claude")!.capabilities).toMatchObject({
      sessionId: true, resume: true, hooks: true, model: true, permissionMode: true, prompt: true,
    });
    expect(byName.get("shell")!.capabilities).toMatchObject({
      resume: false, hooks: false, model: false, prompt: false,
    });
    // pi resumes and takes a model, but has no hooks and no permission mode —
    // which is exactly what the composer disables a control on.
    expect(byName.get("pi")!.capabilities).toMatchObject({
      sessionId: true, resume: true, hooks: false, model: true, permissionMode: false,
    });
  });

  test("no templates reach the client, only what it has to render", async () => {
    for (const row of await list()) {
      expect(Object.keys(row).sort()).toEqual(["capabilities", "label", "name"]);
    }
  });

  test("a user-defined profile is listed too, which is the reason this route exists", async () => {
    // The point of serving the list rather than compiling it in: `profiles.json`
    // can add one (TASK-89.2), and a client with a hard-coded list could never
    // offer it.
    taskManager.setProfiles(
      new ProfileRegistry(
        [...builtinProfiles(), { name: "mine", label: "My agent", bin: "x", start: [] }],
        ["mine"],
      ),
    );

    const rows = await list();
    expect(rows.map((r) => r.name)).toEqual(["claude", "shell", "pi", "mine"]);
    expect(rows.at(-1)!.label).toBe("My agent");
  });
});
