import { test, expect } from "bun:test";
import { extractFrontmatter } from "./frontmatter";

// The one thing both callers need to agree on is `lineCount`: it is what the
// preview drops off the front of the body, so an off-by-one shows a stray `---`
// or eats the first heading (TASK-87).

test("a fenced block yields the YAML between the fences and a count including both", () => {
  const block = extractFrontmatter("---\nid: TASK-1\nstatus: To Do\n---\n# Title\n");
  expect(block).toEqual({ yaml: "id: TASK-1\nstatus: To Do", lineCount: 4 });
});

test("an empty block still counts its two fences", () => {
  expect(extractFrontmatter("---\n---\nbody")).toEqual({ yaml: "", lineCount: 2 });
});

test("a byte-order mark ahead of the opening fence does not hide the block", () => {
  expect(extractFrontmatter("﻿---\nid: TASK-1\n---\n")).toEqual({
    yaml: "id: TASK-1",
    lineCount: 3,
  });
});

test("a closing fence with trailing whitespace still closes", () => {
  expect(extractFrontmatter("---\nid: TASK-1\n---  \nbody")?.lineCount).toBe(3);
});

test("no opening fence is no block", () => {
  expect(extractFrontmatter("# Title\n---\nnot frontmatter\n---\n")).toBeNull();
});

test("an unclosed block is no block, so nothing is dropped from the body", () => {
  expect(extractFrontmatter("---\nid: TASK-1\n# Title\n")).toBeNull();
});

test("an empty file is no block", () => {
  expect(extractFrontmatter("")).toBeNull();
});
