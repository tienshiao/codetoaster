import { test, expect } from "bun:test";
import { displayRefs, type RefSets } from "./RefChip";

const sets = (headBranch: string | null): RefSets => ({
  branches: new Set(["main"]),
  remotes: new Set(),
  tags: new Set(),
  headBranch,
});

test("drops the HEAD pseudo-ref when a current branch carries the styling", () => {
  expect(displayRefs(["HEAD", "main"], sets("main"))).toEqual(["main"]);
});

test("keeps the HEAD pseudo-ref when detached so the checkout stays marked", () => {
  expect(displayRefs(["HEAD"], sets(null))).toEqual(["HEAD"]);
});
