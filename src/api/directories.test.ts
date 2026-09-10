import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { directoryRoutes } from "./directories";

/**
 * The filesystem lister, through a real `Bun.serve` so the query parsing and
 * the JSON body under test are the ones a client actually gets.
 *
 * The interesting half is `files=1` (TASK-100): it adds a list without moving
 * the three fields the project-path field reads, which is what lets the
 * composer share the route rather than grow a second one.
 */

let server: ReturnType<typeof Bun.serve>;
let base: string;
let dir: string;
/** Its own directory, so the fifty-plus subdirectories it needs do not drown
 * every other listing in this file. */
let crowded: string;

interface Listing {
  parent: string;
  directories: string[];
  home: string;
  entries?: { name: string; isDirectory: boolean }[];
}

function list(query: string): Promise<Listing> {
  return fetch(`${base}/api/directories?${query}`).then((res) => res.json() as Promise<Listing>);
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-dirs-"));
  fs.mkdirSync(path.join(dir, "alpha"));
  fs.mkdirSync(path.join(dir, "beta"));
  fs.mkdirSync(path.join(dir, ".hidden"));
  fs.writeFileSync(path.join(dir, "aardvark.txt"), "x");
  fs.writeFileSync(path.join(dir, "zebra.txt"), "x");
  fs.writeFileSync(path.join(dir, ".dotfile"), "x");
  // A link into a directory, which readdir reports as neither.
  fs.symlinkSync(path.join(dir, "alpha"), path.join(dir, "linked"));

  crowded = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-dirs-many-"));
  for (let i = 0; i < 55; i++) {
    fs.mkdirSync(path.join(crowded, `d${String(i).padStart(2, "0")}`));
  }
  fs.writeFileSync(path.join(crowded, "readme.txt"), "x");

  server = Bun.serve({
    port: 0,
    routes: directoryRoutes as any,
    fetch: () => new Response("", { status: 404 }),
  });
  base = `http://localhost:${server.port}`;
});

afterAll(() => {
  server.stop(true);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(crowded, { recursive: true, force: true });
});

describe("GET /api/directories", () => {
  test("lists the directories inside a path, hidden ones excluded", async () => {
    const body = await list(`path=${encodeURIComponent(dir + "/")}`);

    expect(body.directories).toEqual(["alpha", "beta", "linked"]);
    // The files are not in it: this is what `PathField` reads, and it completes
    // repository paths.
    expect(body.entries).toBeUndefined();
    expect(body.home).toBe(os.homedir());
  });

  test("a path without a trailing slash is a prefix, not a directory", async () => {
    const body = await list(`path=${encodeURIComponent(path.join(dir, "al"))}`);

    expect(body.directories).toEqual(["alpha"]);
  });

  test("files=1 adds every child, directories first", async () => {
    const body = await list(`path=${encodeURIComponent(dir + "/")}&files=1`);

    expect(body.entries).toEqual([
      { name: "alpha", isDirectory: true },
      { name: "beta", isDirectory: true },
      { name: "linked", isDirectory: true },
      { name: "aardvark.txt", isDirectory: false },
      { name: "zebra.txt", isDirectory: false },
    ]);
    // And the fields the path field reads are exactly what they were, which is
    // what keeps one route serving both callers.
    expect(body.directories).toEqual(["alpha", "beta", "linked"]);
    expect(body.home).toBe(os.homedir());
    expect(body.parent).toBe(dir);
  });

  test("files=1 filters both groups by the same prefix", async () => {
    const body = await list(`path=${encodeURIComponent(path.join(dir, "a"))}&files=1`);

    expect(body.entries).toEqual([
      { name: "alpha", isDirectory: true },
      { name: "aardvark.txt", isDirectory: false },
    ]);
  });

  test("a symlink is classified by what it points at", async () => {
    // `readdir` calls a symlink a symlink and stops there, so without a stat
    // behind it a link into a directory would complete like a file: the token
    // would end in a space and there would be no typing on into it.
    const body = await list(`path=${encodeURIComponent(dir + "/")}&files=1`);

    expect(body.entries).toContainEqual({ name: "linked", isDirectory: true });
    // And so the path field, which reads `directories`, can walk through it too.
    expect(body.directories).toContain("linked");
  });

  test("each group has its own ceiling, so a crowded directory still offers files", async () => {
    // Fifty-five subdirectories is more than one answer carries. Capping the
    // concatenation would spend the whole budget on them and hand back a
    // listing with no files in it at all.
    const body = await list(`path=${encodeURIComponent(crowded + "/")}&files=1`);

    expect(body.entries).toContainEqual({ name: "readme.txt", isDirectory: false });
    expect(body.entries!.filter((e) => e.isDirectory)).toHaveLength(50);
  });

  test("a path it cannot read is an empty listing, not a failure", async () => {
    // The field is typed into character by character, so most prefixes name
    // nothing yet. An empty `home` is how "could not read this" is said, and
    // `DirectoryBrowser` keys off it.
    const res = await fetch(
      `${base}/api/directories?path=${encodeURIComponent(path.join(dir, "nope", "deeper") + "/")}&files=1`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Listing;
    expect(body).toEqual({ parent: "", directories: [], home: "", entries: [] });
  });
});
