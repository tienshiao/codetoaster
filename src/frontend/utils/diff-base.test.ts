import { test, expect } from "bun:test";
import { diffBaseOptions, diffBaseValue, resolveDiffBase } from "./diff-base";
import type { GitRefsResponse } from "../types/git";

const REFS: GitRefsResponse = {
  head: { ref: "v2", sha: "a1" },
  branches: [
    { name: "origin/foo", sha: "b1" },
    { name: "v2", sha: "a1" },
  ],
  remotes: [{ name: "origin/foo", sha: "c1" }],
  tags: [{ name: "v1.0", sha: "d1" }],
  hash: "h",
};

test("branches, then remotes, then tags, in the order they were listed", () => {
  expect(diffBaseOptions(REFS).map((o) => o.value)).toEqual([
    "branch:origin/foo",
    "branch:v2",
    "remote:origin/foo",
    "tag:v1.0",
  ]);
});

test("refs that have not loaded are no options, not a failure", () => {
  expect(diffBaseOptions(undefined)).toEqual([]);
});

test("a local branch and a remote of the same name resolve apart", () => {
  const options = diffBaseOptions(REFS);
  expect(resolveDiffBase(options, diffBaseValue("branch", "origin/foo"))?.sha).toBe("b1");
  expect(resolveDiffBase(options, diffBaseValue("remote", "origin/foo"))?.sha).toBe("c1");
});

test("nothing chosen, and a ref that is gone, both resolve to nothing", () => {
  const options = diffBaseOptions(REFS);
  expect(resolveDiffBase(options, null)).toBeNull();
  expect(resolveDiffBase(options, diffBaseValue("branch", "deleted"))).toBeNull();
});
