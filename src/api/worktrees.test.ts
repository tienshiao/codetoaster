import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { initDatabase, getDatabase } from "../lib/db";
import { TaskStore } from "../lib/tasks/store";
import { taskManager } from "../lib/tasks/manager";
import { encodeWorktreeToken } from "../lib/worktree-token";
import { cleanupRepos, git, tempDir, tempRepo } from "../../test/git-repo";
import { parseWorktreeList } from "./utils";
import { fileRoutes } from "./files";
import { diffRoutes } from "./diff";
import { worktreeRoutes } from "./worktrees";

// A task's repository can have other worktrees — a subagent's, most often —
// and the Explorer browses them through `/api/worktrees/<token>/…` (TASK-138.2).
// The token names a base root and a path; these cover that the routes serve a
// path only when it is one of that root's repository's live worktrees.

let dbDir: string;
let repoRoot: string;
let toplevel: string;
/** A second worktree of the same repository, on branch `side`. */
let sideReal: string;
/** A worktree that the "removed" test takes away. */
let doomedPath: string;
let server: ReturnType<typeof Bun.serve>;
let base: string;

beforeAll(async () => {
  dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-worktrees-"));
  initDatabase(path.join(dbDir, "codetoaster.db"));
  const store = new TaskStore(getDatabase());
  taskManager.loadProjects();

  const repo = await tempRepo();
  repoRoot = repo.root;
  toplevel = fs.realpathSync(repoRoot);

  // git creates a worktree's directory itself, so the reserved path is freed
  // first; it stays registered for cleanup.
  const sidePath = tempDir("codetoaster-side-");
  fs.rmSync(sidePath, { recursive: true, force: true });
  await git(repoRoot, "worktree", "add", "-q", "-b", "side", sidePath);
  sideReal = fs.realpathSync(sidePath);
  fs.writeFileSync(path.join(sidePath, "README.md"), "on side\n");
  fs.writeFileSync(path.join(sidePath, "only-side.txt"), "side only\n");

  doomedPath = tempDir("codetoaster-doomed-");
  fs.rmSync(doomedPath, { recursive: true, force: true });
  await git(repoRoot, "worktree", "add", "-q", "--detach", doomedPath);

  taskManager.createProject("wt-web", "web", repoRoot);
  store.create({
    id: "wt-task",
    project_id: "general",
    title: "wt-task",
    initial_prompt: "",
    repo_root: repoRoot,
    cwd: repoRoot,
  });

  server = Bun.serve({
    port: 0,
    routes: { ...fileRoutes, ...diffRoutes, ...worktreeRoutes } as any,
    fetch: () => new Response("", { status: 404 }),
  });
  base = `http://localhost:${server.port}`;
});

afterAll(() => {
  server.stop(true);
  cleanupRepos();
  fs.rmSync(dbDir, { recursive: true, force: true });
});

const get = (p: string) => fetch(`${base}${p}`);
const token = (scope: "tasks" | "projects", id: string, p: string) =>
  encodeWorktreeToken({ scope, id, path: p });

describe("parseWorktreeList", () => {
  test("reads each record's path, HEAD and branch, and flags bare and prunable ones", () => {
    const porcelain = [
      "worktree /repo",
      "HEAD 1111111111111111111111111111111111111111",
      "branch refs/heads/main",
      "",
      "worktree /repo-side",
      "HEAD 2222222222222222222222222222222222222222",
      "branch refs/heads/feature/x",
      "",
      "worktree /repo-detached",
      "HEAD 3333333333333333333333333333333333333333",
      "detached",
      "",
      "worktree /repo.git",
      "bare",
      "",
      "worktree /gone",
      "HEAD 4444444444444444444444444444444444444444",
      "branch refs/heads/gone",
      "locked",
      "prunable gitdir file points to non-existent location",
      "",
    ].join("\n");
    expect(parseWorktreeList(porcelain)).toEqual([
      { path: "/repo", head: "1".repeat(40), branch: "main", bare: false, prunable: false },
      { path: "/repo-side", head: "2".repeat(40), branch: "feature/x", bare: false, prunable: false },
      { path: "/repo-detached", head: "3".repeat(40), branch: null, bare: false, prunable: false },
      { path: "/repo.git", head: "", branch: null, bare: true, prunable: false },
      { path: "/gone", head: "4".repeat(40), branch: "gone", bare: false, prunable: true },
    ]);
  });

  test("empty output is no worktrees", () => {
    expect(parseWorktreeList("")).toEqual([]);
  });
});

describe("GET <root>/worktrees", () => {
  test("lists every worktree of a task's repository, the task's own checkout marked", async () => {
    const res = await get("/api/tasks/wt-task/worktrees");
    expect(res.status).toBe(200);
    const { worktrees } = (await res.json()) as {
      worktrees: { path: string; branch: string | null; head: string; current: boolean }[];
    };
    const byPath = new Map(worktrees.map((w) => [w.path, w]));
    expect(byPath.get(toplevel)).toMatchObject({ branch: "main", current: true });
    expect(byPath.get(sideReal)).toMatchObject({ branch: "side", current: false });
    expect(byPath.get(sideReal)!.head).toMatch(/^[0-9a-f]{40}$/);
    expect(worktrees.filter((w) => w.current)).toHaveLength(1);
  });

  test("answers for a project as well", async () => {
    const res = await get("/api/projects/wt-web/worktrees");
    expect(res.status).toBe(200);
    const { worktrees } = (await res.json()) as { worktrees: { path: string }[] };
    expect(worktrees.map((w) => w.path)).toContain(sideReal);
  });

  test("an unknown task is a 404", async () => {
    expect((await get("/api/tasks/nope/worktrees")).status).toBe(404);
  });
});

describe("/api/worktrees/:token", () => {
  test("files lists the worktree's own tree", async () => {
    const res = await get(`/api/worktrees/${token("tasks", "wt-task", sideReal)}/files`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { files: { path: string }[]; directory: string };
    expect(body.directory).toBe(sideReal);
    expect(body.files.map((f) => f.path)).toContain("only-side.txt");

    const own = (await (await get("/api/tasks/wt-task/files")).json()) as { files: { path: string }[] };
    expect(own.files.map((f) => f.path)).not.toContain("only-side.txt");
  });

  test("file reads the worktree's copy, not the task's", async () => {
    const res = await get(`/api/worktrees/${token("tasks", "wt-task", sideReal)}/file?file=README.md`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { lines: { content: string }[] };
    expect(body.lines[0]!.content).toBe("on side");
  });

  test("diff is the worktree's working-tree diff", async () => {
    const res = await get(`/api/worktrees/${token("projects", "wt-web", sideReal)}/diff`);
    expect(res.status).toBe(200);
    const { diff } = (await res.json()) as { diff: string };
    expect(diff).toContain("+on side");
  });

  test("the base checkout is itself one of the worktrees", async () => {
    const res = await get(`/api/worktrees/${token("tasks", "wt-task", repoRoot)}/file?file=README.md`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { lines: { content: string }[] };
    expect(body.lines[0]!.content).toBe("on main");
  });

  test("a path that is another repository is refused", async () => {
    const other = await tempRepo();
    const res = await get(`/api/worktrees/${token("tasks", "wt-task", other.root)}/files`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Worktree not found" });
  });

  test("a directory inside a worktree is not a worktree", async () => {
    fs.mkdirSync(path.join(sideReal, "sub"), { recursive: true });
    const res = await get(`/api/worktrees/${token("tasks", "wt-task", path.join(sideReal, "sub"))}/files`);
    expect(res.status).toBe(404);
  });

  test("the filesystem root is refused", async () => {
    const res = await get(`/api/worktrees/${token("tasks", "wt-task", "/")}/file?file=etc/hosts`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Worktree not found" });
  });

  test("an unknown base task or project is a 404 from its own resolver", async () => {
    const task = await get(`/api/worktrees/${token("tasks", "nope", sideReal)}/files`);
    expect(task.status).toBe(404);
    expect(await task.json()).toEqual({ error: "Task not found" });

    const project = await get(`/api/worktrees/${token("projects", "nope", sideReal)}/files`);
    expect(project.status).toBe(404);
    expect(await project.json()).toEqual({ error: 'Unknown project "nope"' });
  });

  test("a malformed token is a 400", async () => {
    for (const bad of ["not*base64", "bm90LWpzb24", encodeURIComponent(btoa('{"scope":"x"}'))]) {
      const res = await get(`/api/worktrees/${bad}/files`);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Invalid worktree token" });
    }
  });

  test("a worktree removed after it was listed is a 404, and drops out of the list", async () => {
    const doomedReal = fs.realpathSync(doomedPath);
    const doomed = token("tasks", "wt-task", doomedReal);
    expect((await get(`/api/worktrees/${doomed}/files`)).status).toBe(200);
    const before = (await (await get("/api/tasks/wt-task/worktrees")).json()) as { worktrees: { path: string }[] };
    expect(before.worktrees.map((w) => w.path)).toContain(doomedReal);

    await git(repoRoot, "worktree", "remove", "--force", doomedPath);

    // Inside the listing's cache window: the directory check is what refuses it.
    const res = await get(`/api/worktrees/${doomed}/files`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Worktree not found" });
    const after = (await (await get("/api/tasks/wt-task/worktrees")).json()) as { worktrees: { path: string }[] };
    expect(after.worktrees.map((w) => w.path)).not.toContain(doomedReal);
  });
});
