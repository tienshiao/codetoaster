import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileRoutes, serializeFileContent } from "./files";
import { initDatabase } from "../lib/db";
import { taskManager } from "../lib/tasks/manager";
import { cleanupRepos, tempDir, tempRepo } from "../../test/git-repo";
import type { Frontmatter } from "../types/frontmatter";

/**
 * What the file routes say about a markdown file's frontmatter (TASK-87).
 *
 * The serializer is shared by `GET /api/tasks/:id/file` and the git file route,
 * so these cover both; going through the real function rather than the shaping
 * helper is deliberate, since the field being *absent* — not null, not empty —
 * is half of what the client keys off.
 */
function buffer(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

type TextResult = Awaited<ReturnType<typeof serializeFileContent>> & {
  lines?: { lineNum: number; content: string }[];
  frontmatter?: Frontmatter;
};

const EVERY_KIND = `---
id: TASK-1
title: >-
  A folded title that
  wraps
ordinal: 87000
done: false
labels:
  - frontend
  - server
assignee: []
priority: null
meta:
  owner: tma
  phase: 4
steps:
  - name: one
  - name: two
---
# Title

Body text.
`;

test("every value kind is shaped for the header, in the file's key order", async () => {
  const result = (await serializeFileContent(buffer(EVERY_KIND), "backlog/tasks/task-1.md")) as TextResult;

  expect(result.frontmatter?.entries).toEqual([
    { key: "id", value: { kind: "text", text: "TASK-1" } },
    // A folded scalar arrives from the parser already joined; it is a string
    // like any other by the time it is shaped.
    { key: "title", value: { kind: "text", text: "A folded title that wraps" } },
    { key: "ordinal", value: { kind: "scalar", text: "87000" } },
    { key: "done", value: { kind: "scalar", text: "false" } },
    { key: "labels", value: { kind: "list", items: ["frontend", "server"] } },
    { key: "assignee", value: { kind: "empty" } },
    { key: "priority", value: { kind: "empty" } },
    { key: "meta", value: { kind: "block", yaml: "owner: tma\nphase: 4" } },
    { key: "steps", value: { kind: "block", yaml: "- name: one\n- name: two" } },
  ]);
});

test("lineCount spans the block including both fences", async () => {
  const result = (await serializeFileContent(buffer(EVERY_KIND), "task.md")) as TextResult;

  expect(result.frontmatter?.lineCount).toBe(19);
  // What the preview renders after the slice — the body, starting at its title.
  expect(result.lines?.[19]?.content).toBe("# Title");
  // And the raw block is still in `lines`, because the source view shows it.
  expect(result.lines?.[1]?.content).toBe("id: TASK-1");
});

test("a block that will not parse leaves the field off and the lines intact", async () => {
  const source = "---\ntitle: [unclosed\n---\n# Title\n";
  const result = (await serializeFileContent(buffer(source), "task.md")) as TextResult;

  expect("frontmatter" in result).toBe(false);
  expect(result.lines?.map((l) => l.content)).toEqual(["---", "title: [unclosed", "---", "# Title", ""]);
});

test("a block that parses to a list is not a mapping, so there is no field", async () => {
  const result = (await serializeFileContent(buffer("---\n- a\n- b\n---\n# Title\n"), "task.md")) as TextResult;

  expect("frontmatter" in result).toBe(false);
});

test("a scalar block is not a mapping either", async () => {
  const result = (await serializeFileContent(buffer("---\njust a string\n---\nbody\n"), "task.md")) as TextResult;

  expect("frontmatter" in result).toBe(false);
});

test("a leading --- in a non-markdown file is code, not frontmatter", async () => {
  const source = "---\nid: TASK-1\n---\nconst x = 1;\n";
  const result = (await serializeFileContent(buffer(source), "src/thing.ts")) as TextResult;

  expect("frontmatter" in result).toBe(false);
});

test(".markdown and .mdx are markdown too, whatever the case of the extension", async () => {
  for (const name of ["notes.markdown", "page.mdx", "README.MD"]) {
    const result = (await serializeFileContent(buffer("---\nid: TASK-1\n---\n# Hi\n"), name)) as TextResult;
    expect(result.frontmatter?.entries).toEqual([{ key: "id", value: { kind: "text", text: "TASK-1" } }]);
  }
});

test("a markdown file with no block carries no field", async () => {
  const result = (await serializeFileContent(buffer("# Title\n\nBody.\n"), "task.md")) as TextResult;

  expect("frontmatter" in result).toBe(false);
});

/**
 * The project-scoped file search (TASK-100).
 *
 * The composer completes `@` before any task exists, so it cannot go through
 * `resolveTaskRoot` — it names a project instead, and the three answers that
 * are *about the project* rather than about the query are what these cover.
 * Driven through a real `Bun.serve`, so the params and status codes are the
 * ones a client gets.
 */
describe("GET /api/projects/:id/files/search", () => {
  let server: ReturnType<typeof Bun.serve>;
  let base: string;
  let dbDir: string;
  let repoRoot: string;

  beforeAll(async () => {
    dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-projfiles-"));
    initDatabase(path.join(dbDir, "codetoaster.db"));
    taskManager.loadProjects();

    const repo = await tempRepo();
    repoRoot = repo.root;
    fs.mkdirSync(path.join(repoRoot, "src"));
    fs.writeFileSync(path.join(repoRoot, "src", "parser.ts"), "export const x = 1;\n");

    taskManager.createProject("web", "web", repoRoot);
    taskManager.createProject("nodir", "No directory", "");
    taskManager.createProject("notrepo", "Not a repo", tempDir("codetoaster-notrepo-"));

    server = Bun.serve({
      port: 0,
      routes: fileRoutes as any,
      fetch: () => new Response("", { status: 404 }),
    });
    base = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    cleanupRepos();
    fs.rmSync(dbDir, { recursive: true, force: true });
  });

  function search(id: string, q: string) {
    return fetch(`${base}/api/projects/${id}/files/search?q=${encodeURIComponent(q)}`);
  }

  test("finds the project's files, best match first", async () => {
    const res = await search("web", "parser");
    expect(res.status).toBe(200);

    const { results } = (await res.json()) as { results: { path: string; name: string }[] };
    expect(results[0]).toMatchObject({ path: "src/parser.ts", name: "parser.ts" });
    // Relative to the project's directory, which is what the composer writes
    // into the prompt.
    expect(results.every((r) => !r.path.startsWith("/"))).toBe(true);
  });

  test("an empty query is an empty list, not every file", async () => {
    const res = await search("web", "");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [] });
  });

  test("a project nobody has heard of is a 404", async () => {
    const res = await search("nope", "parser");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Unknown project "nope"' });
  });

  test("a project with no directory has nowhere to look", async () => {
    // "General" in practice: a task in it runs wherever the daemon does, and
    // there is no repository to list.
    const res = await search("nodir", "parser");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Project has no directory" });
  });

  test("a directory that is not a repository says so in the usual words", async () => {
    const res = await search("notrepo", "parser");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Not a git repository" });
  });
});
