import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { initDatabase, getDatabase } from "../lib/db";
import { TaskStore } from "../lib/tasks/store";
import { taskManager } from "../lib/tasks/manager";
import { cleanupRepos, git, tempDir, tempRepo } from "../../test/git-repo";
import { resolveProjectRoot, type TaskRoot } from "./utils";
import { fileRoutes } from "./files";
import { diffRoutes } from "./diff";
import { backlogRoutes } from "./backlog";
import { gitRoutes } from "./git";

// The composer's Explorer reads a *project* before any task exists (TASK-106),
// so every repository-reading route is served under both scopes by one
// handler. These cover the project resolver and that the shared route table
// answers under both prefixes.

let dbDir: string;
let store: TaskStore;
let repoRoot: string;
/** What git reports as the toplevel — the realpath, which on macOS is not the
 * tmpdir spelling (`/var` is a symlink to `/private/var`). */
let toplevel: string;
let server: ReturnType<typeof Bun.serve>;
let base: string;

beforeAll(async () => {
  dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-projroot-"));
  initDatabase(path.join(dbDir, "codetoaster.db"));
  store = new TaskStore(getDatabase());
  taskManager.loadProjects();

  const repo = await tempRepo();
  repoRoot = repo.root;
  toplevel = fs.realpathSync(repoRoot);
  fs.mkdirSync(path.join(repoRoot, "src"));
  fs.writeFileSync(path.join(repoRoot, "src", "parser.ts"), "export const x = 1;\n");
  await git(repoRoot, "add", "-A");
  await git(repoRoot, "commit", "-qm", "parser");

  const gone = tempDir("codetoaster-gone-");
  fs.rmSync(gone, { recursive: true, force: true });

  taskManager.createProject("pr-web", "web", repoRoot);
  taskManager.createProject("pr-sub", "sub", path.join(repoRoot, "src"));
  taskManager.createProject("pr-nodir", "No directory", "");
  taskManager.createProject("pr-gone", "Gone", gone);
  taskManager.createProject("pr-notrepo", "Not a repo", tempDir("codetoaster-notrepo-"));

  store.create({
    id: "pr-task",
    project_id: "general",
    title: "pr-task",
    initial_prompt: "",
    repo_root: repoRoot,
    cwd: repoRoot,
  });

  server = Bun.serve({
    port: 0,
    routes: { ...fileRoutes, ...diffRoutes, ...backlogRoutes, ...gitRoutes } as any,
    fetch: () => new Response("", { status: 404 }),
  });
  base = `http://localhost:${server.port}`;
});

afterAll(() => {
  server.stop(true);
  cleanupRepos();
  fs.rmSync(dbDir, { recursive: true, force: true });
});

async function resolveError(id: string): Promise<{ status: number; body: unknown }> {
  const result = await resolveProjectRoot(id);
  if (!("error" in result)) throw new Error(`expected ${id} not to resolve`);
  return { status: result.error.status, body: await result.error.json() };
}

describe("resolveProjectRoot", () => {
  test("an unknown project is a 404", async () => {
    expect(await resolveError("nope")).toEqual({ status: 404, body: { error: 'Unknown project "nope"' } });
  });

  test("a project with no directory is a 400", async () => {
    expect(await resolveError("pr-nodir")).toEqual({ status: 400, body: { error: "Project has no directory" } });
  });

  test("a project whose directory is gone says so", async () => {
    expect(await resolveError("pr-gone")).toEqual({
      status: 400,
      body: { error: "Project directory does not exist" },
    });
  });

  test("a directory that is not a repository is a 400", async () => {
    expect(await resolveError("pr-notrepo")).toEqual({ status: 400, body: { error: "Not a git repository" } });
  });

  test("a project at the top of its repository resolves to it", async () => {
    const root = (await resolveProjectRoot("pr-web")) as TaskRoot;
    expect(root).toEqual({ repoRoot: toplevel, cwd: repoRoot });
  });

  test("a project in a subdirectory resolves the repository to its toplevel", async () => {
    const root = (await resolveProjectRoot("pr-sub")) as TaskRoot;
    expect(root).toEqual({ repoRoot: toplevel, cwd: path.join(repoRoot, "src") });
  });
});

describe("repository routes under /api/projects/:id", () => {
  const get = (p: string) => fetch(`${base}${p}`);

  test("files lists the repository, rooted at the toplevel", async () => {
    const res = await get("/api/projects/pr-sub/files");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { files: { path: string }[]; directory: string };
    expect(body.directory).toBe(toplevel);
    const paths = body.files.map((f) => f.path);
    expect(paths).toContain("README.md");
    expect(paths).toContain("src/parser.ts");
  });

  test("file returns the file's lines", async () => {
    const res = await get("/api/projects/pr-web/file?file=README.md");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { lines: { content: string }[] };
    expect(body.lines[0]!.content).toBe("on main");
  });

  test("files/search resolves the project before looking at the query", async () => {
    expect((await get("/api/projects/nope/files/search?q=")).status).toBe(404);
    const res = await get("/api/projects/pr-web/files/search?q=parser");
    expect(res.status).toBe(200);
    const { results } = (await res.json()) as { results: { path: string }[] };
    expect(results[0]!.path).toBe("src/parser.ts");
  });

  test("a subdirectory project searches from its own directory, but lists from the toplevel", async () => {
    // The composer writes these paths into a prompt for an agent that starts
    // in the project's directory, so they are relative to it.
    const res = await get("/api/projects/pr-sub/files/search?q=parser");
    expect(res.status).toBe(200);
    const { results } = (await res.json()) as { results: { path: string }[] };
    expect(results[0]!.path).toBe("parser.ts");

    const files = (await (await get("/api/projects/pr-sub/files")).json()) as { files: { path: string }[] };
    expect(files.files.map((f) => f.path)).toContain("src/parser.ts");
  });

  test("git/log returns commits", async () => {
    const res = await get("/api/projects/pr-web/git/log");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { commits: unknown[] };
    expect(body.commits.length).toBeGreaterThan(0);
  });

  test("git/refs answers", async () => {
    const res = await get("/api/projects/pr-web/git/refs");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { head: { ref: string | null }; branches: { name: string }[] };
    expect(body.head.ref).toBe("main");
    expect(body.branches.map((b) => b.name)).toContain("other");
  });

  test("diff is empty on a clean tree and shows a change once there is one", async () => {
    const clean = await get("/api/projects/pr-web/diff");
    expect(clean.status).toBe(200);
    expect(((await clean.json()) as { diff: string }).diff).toBe("");

    fs.writeFileSync(path.join(repoRoot, "README.md"), "changed\n");
    try {
      const res = await get("/api/projects/pr-web/diff");
      expect(res.status).toBe(200);
      const { diff } = (await res.json()) as { diff: string };
      expect(diff).toContain("README.md");
      expect(diff).toContain("+changed");
    } finally {
      fs.writeFileSync(path.join(repoRoot, "README.md"), "on main\n");
    }
  });

  test("backlog answers detected: false for a repository with none", async () => {
    const res = await get("/api/projects/pr-web/backlog");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ detected: false });
  });

  test("backlog answers detected: false for a project with no directory", async () => {
    const res = await get("/api/projects/pr-nodir/backlog");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ detected: false });
  });

  test("backlog for an unknown project is a 404", async () => {
    const res = await get("/api/projects/nope/backlog");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Unknown project "nope"' });
  });
});

describe("repository routes under /api/tasks/:id", () => {
  test("still resolve through the task row", async () => {
    const res = await fetch(`${base}/api/tasks/pr-task/files`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { files: { path: string }[]; directory: string };
    expect(body.directory).toBe(repoRoot);
    expect(body.files.map((f) => f.path)).toContain("src/parser.ts");

    const log = await fetch(`${base}/api/tasks/pr-task/git/log`);
    expect(log.status).toBe(200);
  });

  test("an unknown task is still a 404", async () => {
    const res = await fetch(`${base}/api/tasks/nope/files`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Task not found" });
  });
});
