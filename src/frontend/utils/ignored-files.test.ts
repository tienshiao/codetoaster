import { test, expect, describe } from "bun:test";
import { ignoredDirsOf, ignoredEntriesOf, isUnder, parentDir, walkIgnored } from "./ignored-files";
import type { FileInfo, FilesResponse } from "../types/file";

/**
 * What the Files tree shows of an ignored directory (TASK-130), as functions.
 *
 * The listing names the directory and nothing under it; the children arrive
 * per directory, as each is opened. Which to ask for, what the tree then
 * holds, and which directories it still cannot see into are all decided here,
 * so none of it needs a query client or a rendered tree to test.
 */

const dir = (path: string, ignored = false): FileInfo => ({
  path,
  name: path.slice(path.lastIndexOf("/") + 1),
  isDirectory: true,
  depth: path.split("/").length - 1,
  ...(ignored ? { ignored: true as const } : {}),
});

const file = (path: string, ignored = false): FileInfo => ({ ...dir(path, ignored), isDirectory: false });

const BASE: FileInfo[] = [
  dir("src"),
  file("src/a.ts"),
  file(".env", true),
  dir("dist", true),
  dir("node_modules", true),
];

const CHILDREN: Record<string, FileInfo[]> = {
  dist: [file("dist/bundle.js", true), dir("dist/deep", true)],
  "dist/deep": [file("dist/deep/chunk.js", true)],
  node_modules: [dir("node_modules/react", true)],
};

const childrenOf = (path: string) => CHILDREN[path];

describe("walkIgnored", () => {
  test("nothing expanded: the listing as it came, and every ignored directory still closed to it", () => {
    const walk = walkIgnored(BASE, new Set(), childrenOf);
    expect(walk.files).toEqual(BASE);
    expect(walk.open).toEqual([]);
    expect([...walk.unloaded].sort()).toEqual(["dist", "node_modules"]);
  });

  test("an expanded ignored directory is asked for, and its children join the tree", () => {
    const walk = walkIgnored(BASE, new Set(["dist"]), childrenOf);
    expect(walk.open).toEqual(["dist"]);
    expect(walk.files).toEqual([...BASE, ...CHILDREN.dist!]);
    // `dist` is seen into now; the directory inside it is the new edge.
    expect([...walk.unloaded].sort()).toEqual(["dist/deep", "node_modules"]);
  });

  test("a directory inside one is asked for only once its parent has arrived", () => {
    const expanded = new Set(["dist", "dist/deep"]);

    const before = walkIgnored(BASE, expanded, () => undefined);
    expect(before.open).toEqual(["dist"]);
    expect(before.files).toEqual(BASE);
    expect(before.unloaded.has("dist")).toBe(true);

    const after = walkIgnored(BASE, expanded, childrenOf);
    expect(after.open).toEqual(["dist", "dist/deep"]);
    expect(after.files.map((f) => f.path)).toContain("dist/deep/chunk.js");
    expect(after.unloaded.has("dist/deep")).toBe(false);
  });

  test("an expansion under a collapsed directory asks for nothing", () => {
    // What a collapse leaves behind: the parent closed, the child still
    // remembered as open for when the parent opens again.
    const walk = walkIgnored(BASE, new Set(["dist/deep"]), childrenOf);
    expect(walk.open).toEqual([]);
    expect(walk.files).toEqual(BASE);
  });

  test("an expanded path the parent does not hold is never asked for", () => {
    // A directory that has since been deleted, still in the persisted set.
    const walk = walkIgnored(BASE, new Set(["dist", "dist/gone"]), childrenOf);
    expect(walk.open).toEqual(["dist"]);
  });

  test("an expanded directory that is not ignored is the listing's own, and asks for nothing", () => {
    const walk = walkIgnored(BASE, new Set(["src"]), childrenOf);
    expect(walk.open).toEqual([]);
  });
});

describe("ignoredEntriesOf", () => {
  test("the ignored directories and the ignored files of a listing, apart", () => {
    const data: FilesResponse = { files: BASE, directory: "/repo" };
    expect(ignoredEntriesOf(data)).toEqual({ dirs: ["dist", "node_modules"], files: new Set([".env"]) });
    expect(ignoredDirsOf(data)).toEqual(["dist", "node_modules"]);
  });

  test("undefined before the listing has arrived", () => {
    expect(ignoredEntriesOf(undefined)).toBeUndefined();
    expect(ignoredDirsOf(undefined)).toBeUndefined();
  });
});

describe("isUnder", () => {
  test("strictly inside, on whole segments", () => {
    expect(isUnder("dist/a.js", ["dist"])).toBe(true);
    expect(isUnder("dist/deep/a.js", ["dist"])).toBe(true);
    expect(isUnder("dist", ["dist"])).toBe(false);
    expect(isUnder("distribution/a.js", ["dist"])).toBe(false);
    expect(isUnder("src/dist/a.js", ["dist"])).toBe(false);
    expect(isUnder("dist/a.js", [])).toBe(false);
  });
});

test("parentDir is the path without its last segment, and empty at the root", () => {
  expect(parentDir("dist/deep/a.js")).toBe("dist/deep");
  expect(parentDir("dist/a.js")).toBe("dist");
  expect(parentDir(".env")).toBe("");
});
