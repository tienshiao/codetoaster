import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileRoutes, isLoopbackAddress, MAX_DIR_ENTRIES, revealCommand, serializeFileContent } from "./files";
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

  /**
   * Show in Finder (TASK-120). Only the refusals are driven through the route:
   * a request that passes them opens a real Finder window, which is no thing
   * for a test run to do. Which platforms get a command is `revealCommand`'s,
   * covered below.
   */
  function reveal(id: string, body: unknown) {
    return fetch(`${base}/api/projects/${id}/reveal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  test("reveal refuses a body with no file", async () => {
    const res = await reveal("web", {});
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Missing file parameter" });
  });

  test("reveal refuses a body that is not JSON", async () => {
    const res = await reveal("web", "not json");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON body" });
  });

  test("reveal refuses a path that climbs out of the repository", async () => {
    const res = await reveal("web", { file: "../outside.txt" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid file path" });
  });

  test("reveal of a file that is not there is a 404", async () => {
    const res = await reveal("web", { file: "src/missing.ts" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "File not found" });
  });

  test("reveal on an unknown project is a 404 before the body is read", async () => {
    const res = await reveal("nope", { file: "src/parser.ts" });
    expect(res.status).toBe(404);
  });

  test("reveal refuses a symlink that leads out of the repository", async () => {
    // Lexically inside, so `safePath` alone would pass it and Finder would
    // follow the link.
    const outside = tempDir("codetoaster-outside-");
    fs.writeFileSync(path.join(outside, "secret.txt"), "x");
    fs.symlinkSync(outside, path.join(repoRoot, "escape"));
    const res = await reveal("web", { file: "escape/secret.txt" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid file path" });
  });

  test("reveal refuses a peer that is not on this machine", async () => {
    // Called directly, since every request a test can make arrives over
    // loopback: the server stand-in reports a LAN address instead.
    const handler = (fileRoutes as any)["/api/projects/:id/reveal"].POST;
    const req = Object.assign(
      new Request(`${base}/api/projects/web/reveal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: "src/parser.ts" }),
      }),
      { params: { id: "web" } },
    );
    const res: Response = await handler(req, { requestIP: () => ({ address: "192.168.1.20" }) });
    expect(res.status).toBe(403);
  });
});

/**
 * What the listing routes say about files the repository ignores (TASK-130).
 *
 * The tree lists an ignored directory as one entry and asks for its children
 * when it is opened, so the two routes are covered together: what the first
 * leaves for the second, and every way the second refuses.
 */
describe("ignored files in the listing routes", () => {
  let server: ReturnType<typeof Bun.serve>;
  let base: string;
  let dbDir: string;
  let repoRoot: string;

  function write(file: string, content = "x\n"): void {
    fs.mkdirSync(path.dirname(path.join(repoRoot, file)), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, file), content);
  }

  beforeAll(async () => {
    dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-ignored-"));
    initDatabase(path.join(dbDir, "codetoaster.db"));
    taskManager.loadProjects();

    repoRoot = fs.realpathSync((await tempRepo()).root);
    write(".gitignore", "dist/\n.env\nmany/\nlinked/\n");
    write(".env", "SECRET=1\n");
    write("src/parser.ts");
    write("src/inner/x.ts");
    write("dist/bundle.js", "built\n");
    write("dist/deep/chunk.js");
    for (let i = 0; i < MAX_DIR_ENTRIES + 5; i++) write(`many/f${String(i).padStart(4, "0")}.txt`);
    const outside = tempDir("codetoaster-outside-");
    fs.writeFileSync(path.join(outside, "secret.txt"), "x");
    fs.symlinkSync(outside, path.join(repoRoot, "dist", "escape"));
    // The shape a package manager leaves: the package is a link into a store
    // beside it, and what the reader opens next is a directory beyond the link.
    write("linked/store/pkg/lib/a.js");
    fs.symlinkSync(path.join("store", "pkg"), path.join(repoRoot, "linked", "pkg"));
    // And a link the repository does not ignore, to a directory it does not.
    fs.symlinkSync("src", path.join(repoRoot, "alias"));

    taskManager.createProject("ign", "ign", repoRoot);

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

  type Entry = { path: string; name: string; isDirectory: boolean; depth: number; size?: number; ignored?: true };

  function children(id: string, dir?: string) {
    const query = dir === undefined ? "" : `?dir=${encodeURIComponent(dir)}`;
    return fetch(`${base}/api/projects/${id}/files/children${query}`);
  }

  test("the listing flags an ignored file and stops at an ignored directory", async () => {
    const res = await fetch(`${base}/api/projects/ign/files`);
    expect(res.status).toBe(200);
    const { files } = (await res.json()) as { files: Entry[] };
    const byPath = new Map(files.map((f) => [f.path, f]));

    expect(byPath.get(".env")).toEqual({
      path: ".env",
      name: ".env",
      isDirectory: false,
      depth: 0,
      ignored: true,
      size: 9,
    });
    expect(byPath.get("dist")).toEqual({ path: "dist", name: "dist", isDirectory: true, depth: 0, ignored: true });
    expect(files.some((f) => f.path.startsWith("dist/"))).toBe(false);
    // What was listed before still is, and is not flagged.
    expect(byPath.get("src/parser.ts")?.ignored).toBeUndefined();
  });

  test("children are one level of an ignored directory, flagged, with sizes", async () => {
    const res = await children("ign", "dist");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      entries: [
        { path: "dist/bundle.js", name: "bundle.js", isDirectory: false, depth: 1, ignored: true, size: 6 },
        { path: "dist/deep", name: "deep", isDirectory: true, depth: 1, ignored: true },
        // A link to a directory is one: it opens like any other, and where it
        // leads is checked when it does.
        { path: "dist/escape", name: "escape", isDirectory: true, depth: 1, ignored: true },
      ],
      truncated: 0,
    });
  });

  test("a directory inside an ignored one is asked for the same way", async () => {
    const res = await children("ign", "dist/deep");
    expect(res.status).toBe(200);
    const { entries } = (await res.json()) as { entries: Entry[] };
    expect(entries.map((e) => e.path)).toEqual(["dist/deep/chunk.js"]);
    expect(entries[0]!.depth).toBe(2);
  });

  test("a directory past the cap answers with the first of them and how many it left out", async () => {
    const res = await children("ign", "many");
    expect(res.status).toBe(200);
    const { entries, truncated } = (await res.json()) as { entries: Entry[]; truncated: number };
    expect(entries).toHaveLength(MAX_DIR_ENTRIES);
    expect(truncated).toBe(5);
    // By name, so what is cut is the same each time it is asked.
    expect(entries[0]!.name).toBe("f0000.txt");
  });

  test("children without a directory is a 400", async () => {
    const res = await children("ign");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Missing dir parameter" });
  });

  test("children of a path that climbs out of the repository is a 400", async () => {
    const res = await children("ign", "../outside");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid directory path" });
  });

  test("children of a link that leads out of the repository is a 400", async () => {
    // Lexically inside, and ignored, so only the resolved path says no.
    const res = await children("ign", "dist/escape");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid directory path" });
  });

  test("children of a directory the repository does not ignore is a 400", async () => {
    // The listing already holds everything under it; answering here would
    // flag tracked files as ignored.
    const res = await children("ign", "src");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Not an ignored directory" });
  });

  test("a directory beyond a link inside an ignored one is listed, under the path it was asked by", async () => {
    // `git check-ignore` refuses a path beyond a symbolic link outright, so
    // the question it is asked is about the link: that is what is ignored.
    const link = await children("ign", "linked/pkg");
    expect(link.status).toBe(200);
    expect(((await link.json()) as { entries: Entry[] }).entries.map((e) => e.path)).toEqual(["linked/pkg/lib"]);

    const beyond = await children("ign", "linked/pkg/lib");
    expect(beyond.status).toBe(200);
    expect(((await beyond.json()) as { entries: Entry[] }).entries.map((e) => e.path)).toEqual([
      "linked/pkg/lib/a.js",
    ]);
  });

  test("children beyond a link the repository does not ignore is a 400", async () => {
    const res = await children("ign", "alias/inner");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Not an ignored directory" });
  });

  test("children of a directory that is not there is a 404", async () => {
    const res = await children("ign", "dist/missing");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Directory not found" });
  });

  test("children of a file is a 404 too", async () => {
    const res = await children("ign", "dist/bundle.js");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Directory not found" });
  });

  test("children on an unknown project is a 404", async () => {
    const res = await children("nope", "dist");
    expect(res.status).toBe(404);
  });

  test("search finds an ignored file, and nothing inside an ignored directory", async () => {
    const search = async (q: string) => {
      const res = await fetch(`${base}/api/projects/ign/files/search?q=${encodeURIComponent(q)}`);
      expect(res.status).toBe(200);
      return ((await res.json()) as { results: { path: string }[] }).results.map((r) => r.path);
    };
    expect(await search(".env")).toContain(".env");
    expect(await search("bundle")).toEqual([]);
    // The directory itself is not a file to open.
    expect(await search("dist")).toEqual([]);
  });
});

describe("isLoopbackAddress", () => {
  test("IPv4, IPv6 and v4-mapped loopback are local", () => {
    for (const a of ["127.0.0.1", "127.1.2.3", "::1", "::ffff:127.0.0.1"]) {
      expect(isLoopbackAddress(a)).toBe(true);
    }
  });

  test("anything else, or no address at all, is not", () => {
    for (const a of ["192.168.1.20", "::ffff:10.0.0.1", "fe80::1", "", undefined]) {
      expect(isLoopbackAddress(a)).toBe(false);
    }
  });
});

describe("revealCommand", () => {
  test("macOS selects the file in Finder", () => {
    expect(revealCommand("/repo/src/a.ts", "darwin")).toEqual(["/usr/bin/open", "-R", "/repo/src/a.ts"]);
  });

  test("anywhere else there is nothing to run, which the route answers with a 501", () => {
    expect(revealCommand("/repo/src/a.ts", "linux")).toBeNull();
    expect(revealCommand("/repo/src/a.ts", "win32")).toBeNull();
  });
});
