import { test, expect, describe } from "bun:test";
import { sortFiles, buildTree, FILE_KEY } from "./sortFiles";
import type { FileDiff } from "../types/diff";

function makeFile(path: string): FileDiff {
  return {
    oldPath: path,
    newPath: path,
    hunks: [],
    additions: 0,
    deletions: 0,
  };
}

function paths(files: FileDiff[]): string[] {
  return files.map((f) => f.newPath);
}

describe("sortFiles", () => {
  test("alphabetical — files in same directory sort A-Z", () => {
    const files = [makeFile("src/c.ts"), makeFile("src/a.ts"), makeFile("src/b.ts")];
    expect(paths(sortFiles(files))).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
  });

  test("directories before files", () => {
    const files = [makeFile("src/foo.ts"), makeFile("src/lib/bar.ts")];
    expect(paths(sortFiles(files))).toEqual(["src/lib/bar.ts", "src/foo.ts"]);
  });

  test("nested directories sort depth-first", () => {
    const files = [
      makeFile("src/z.ts"),
      makeFile("src/a/b/c.ts"),
      makeFile("src/a/x.ts"),
      makeFile("src/a/b/a.ts"),
    ];
    const sorted = paths(sortFiles(files));
    expect(sorted).toEqual([
      "src/a/b/a.ts",
      "src/a/b/c.ts",
      "src/a/x.ts",
      "src/z.ts",
    ]);
  });

  test("case insensitive", () => {
    const files = [makeFile("src/Readme.md"), makeFile("src/api.ts"), makeFile("src/README.md")];
    const sorted = paths(sortFiles(files));
    // api.ts should come before both readme variants
    expect(sorted[0]).toBe("src/api.ts");
    // Both readmes should follow (stable relative order between equal keys)
    expect(sorted.slice(1).sort()).toEqual(["src/README.md", "src/Readme.md"]);
  });

  test("already sorted input is stable", () => {
    const files = [
      makeFile("src/lib/a.ts"),
      makeFile("src/lib/b.ts"),
      makeFile("src/x.ts"),
    ];
    expect(paths(sortFiles(files))).toEqual([
      "src/lib/a.ts",
      "src/lib/b.ts",
      "src/x.ts",
    ]);
  });

  test("empty array", () => {
    expect(sortFiles([])).toEqual([]);
  });

  test("single file", () => {
    const files = [makeFile("foo.ts")];
    expect(paths(sortFiles(files))).toEqual(["foo.ts"]);
  });

  test("root-level files sort alphabetically", () => {
    const files = [makeFile("z.ts"), makeFile("a.ts"), makeFile("m.ts")];
    expect(paths(sortFiles(files))).toEqual(["a.ts", "m.ts", "z.ts"]);
  });

  test("mixed depths — deeper paths grouped under their parent", () => {
    const files = [
      makeFile("b.ts"),
      makeFile("a/c.ts"),
      makeFile("a.ts"),
      makeFile("a/b/d.ts"),
    ];
    expect(paths(sortFiles(files))).toEqual([
      "a/b/d.ts",
      "a/c.ts",
      "a.ts",
      "b.ts",
    ]);
  });
});

describe("buildTree", () => {
  test("builds nested structure from flat paths", () => {
    const files = [makeFile("src/a.ts"), makeFile("src/lib/b.ts")];
    const tree = buildTree(files);
    expect(tree.src!.lib!["b.ts"]![FILE_KEY]).toBeDefined();
    expect(tree.src!["a.ts"]![FILE_KEY]).toBeDefined();
    expect(tree.src!["a.ts"]![FILE_KEY]!.newPath).toBe("src/a.ts");
  });

  test("empty input produces empty tree", () => {
    expect(buildTree([])).toEqual({});
  });

  test("file literally named __file is not lost", () => {
    const files = [makeFile("src/__file"), makeFile("src/other.ts")];
    const tree = buildTree(files);
    expect(tree.src!["__file"]![FILE_KEY]!.newPath).toBe("src/__file");
    expect(tree.src!["other.ts"]![FILE_KEY]!.newPath).toBe("src/other.ts");
    // __file entry should appear as a normal child key, not be confused with the marker
    const childKeys = Object.keys(tree.src!);
    expect(childKeys).toContain("__file");
    expect(childKeys).toContain("other.ts");
  });
});

describe("tree order consistency", () => {
  test("sorted DFS of tree matches sortFiles order", () => {
    const files = [
      makeFile("src/z.ts"),
      makeFile("src/a/b/c.ts"),
      makeFile("README.md"),
      makeFile("src/a/x.ts"),
      makeFile("src/a/b/a.ts"),
      makeFile("package.json"),
      makeFile("lib/util.ts"),
    ];

    const sorted = sortFiles(files);
    const tree = buildTree(sorted);

    // DFS the tree in the same order FileTree renders (dirs first, alpha)
    function dfs(node: Record<string, any>): string[] {
      const entries = Object.entries(node);
      entries.sort(([aKey, aVal], [bKey, bVal]) => {
        const aIsDir = !aVal[FILE_KEY];
        const bIsDir = !bVal[FILE_KEY];
        if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
        return aKey.localeCompare(bKey, undefined, { sensitivity: "base" });
      });

      const result: string[] = [];
      for (const [, value] of entries) {
        if (value[FILE_KEY]) {
          result.push(value[FILE_KEY].newPath);
        } else {
          result.push(...dfs(value));
        }
      }
      return result;
    }

    const treeOrder = dfs(tree);
    expect(treeOrder).toEqual(paths(sorted));
  });
});
