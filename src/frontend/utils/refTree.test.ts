import { test, expect } from "bun:test";
import { buildRefTree, countRefs, isRefFolder } from "./refTree";
import type { GitRef } from "../types/git";

const ref = (name: string, sha = name): GitRef => ({ name, sha });

test("no-slash names stay flat leaves", () => {
  const tree = buildRefTree([ref("main"), ref("dev")]);
  expect(tree.map((n) => n.name)).toEqual(["dev", "main"]);
  expect(tree.every((n) => n.children.length === 0)).toBe(true);
  expect(tree[0]!.ref).toEqual(ref("dev"));
});

test("nested names build folders split on slash", () => {
  const tree = buildRefTree([ref("feature/foo/bar")]);
  expect(tree).toHaveLength(1);
  const feature = tree[0]!;
  expect(feature.name).toBe("feature");
  expect(feature.path).toBe("feature");
  expect(feature.ref).toBeUndefined();
  expect(isRefFolder(feature)).toBe(true);

  const foo = feature.children[0]!;
  expect(foo.name).toBe("foo");
  expect(foo.path).toBe("feature/foo");

  const bar = foo.children[0]!;
  expect(bar.name).toBe("bar");
  expect(bar.path).toBe("feature/foo/bar");
  expect(bar.ref).toEqual(ref("feature/foo/bar"));
  expect(bar.children).toHaveLength(0);
  expect(isRefFolder(bar)).toBe(false);
});

test("siblings: folders before leaves, case-insensitive alpha", () => {
  const tree = buildRefTree([
    ref("main"),
    ref("Zebra"),
    ref("apple"),
    ref("feature/x"),
    ref("Bugfix/y"),
  ]);
  // Folders (Bugfix, feature) first — case-insensitive alpha — then leaves
  // (apple, main, Zebra) also case-insensitive alpha.
  expect(tree.map((n) => n.name)).toEqual(["Bugfix", "feature", "apple", "main", "Zebra"]);
});

test("nested sibling lists are sorted too", () => {
  const tree = buildRefTree([ref("feature/z"), ref("feature/deep/x"), ref("feature/a")]);
  expect(tree[0]!.children.map((n) => n.name)).toEqual(["deep", "a", "z"]);
});

test("multiple refs share a folder", () => {
  const tree = buildRefTree([ref("feature/a"), ref("feature/b")]);
  expect(tree).toHaveLength(1);
  const feature = tree[0]!;
  expect(feature.children.map((n) => n.name)).toEqual(["a", "b"]);
  expect(countRefs(feature)).toBe(2);
});

test("countRefs counts nested descendant leaves", () => {
  const tree = buildRefTree([
    ref("feature/foo/bar"),
    ref("feature/foo/qux"),
    ref("feature/baz"),
  ]);
  expect(countRefs(tree[0]!)).toBe(3);
});
