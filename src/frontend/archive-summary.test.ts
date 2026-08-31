import { test, expect } from "bun:test";
import { archiveSummary } from "./archive-summary";
import type { ArchivePreview } from "@/lib/xtmux/types";

function preview(over: Partial<ArchivePreview> = {}): ArchivePreview {
  return {
    status: { exists: true, dirty: 0, unpushed: 0, merged: false, pushed: false, atBase: false },
    branch: "task/parser",
    branchWouldBeDeleted: false,
    wipRetentionDays: 30,
    ...over,
  };
}

function status(over: Partial<NonNullable<ArchivePreview["status"]>> = {}) {
  return { exists: true, dirty: 0, unpushed: 0, merged: false, pushed: false, atBase: false, ...over };
}

test("a task with no checkout of its own says exactly that", () => {
  expect(archiveSummary(preview({ status: null, branch: null }))).toEqual([
    "This task has no checkout of its own, so nothing on disk is removed.",
  ]);
});

test("a clean checkout draws no zeros — only what happens to the branch", () => {
  expect(archiveSummary(preview())).toEqual([
    "The branch task/parser will be kept, since deleting it would take that work with it.",
  ]);
});

test("counts are stated with the retention the server sent, not one of ours", () => {
  const lines = archiveSummary(preview({ status: status({ dirty: 1 }), wipRetentionDays: 7 }));
  expect(lines[0]).toBe("1 uncommitted file will be saved to a snapshot, kept for 7 days.");
});

// `dirty: null` is an answer and not the absence of one — folding it into
// silence would leave an evicted task's dialog implying there is still a
// working tree to lose. But it is not a *specific* answer: `dirtyCount` returns
// null both for a checkout that is not on disk and for one git failed on, so
// the sentence must not assert the first of those over a directory that is
// sitting right there with uncommitted work in it.
test("a checkout that could not be counted says so, without claiming it is gone", () => {
  const lines = archiveSummary(preview({ status: status({ dirty: null }) }));
  expect(lines[0]).toBe(
    "Its uncommitted files could not be counted — the checkout is gone from disk, or git could not read it. Anything still there is snapshotted first.",
  );
  expect(lines[0]).not.toMatch(/^Its checkout is already gone/);
});

// `exists: false` is the branch not being there — or git not being able to say,
// on the same fail-closed rule. Either way `branchWouldBeDeleted` is false, and
// the ordinary "kept" sentence would read it as "there is work here deleting it
// would lose", which is a claim about a ref nobody found.
test("a branch that is not there is not reported as one being kept", () => {
  const lines = archiveSummary(preview({ status: status({ exists: false }) }));
  expect(lines).toEqual(["The branch task/parser was not found, so nothing here deletes it."]);
});

test("a branch that would be deleted says why, and distinguishes merged from pushed", () => {
  expect(
    archiveSummary(preview({ status: status({ merged: true }), branchWouldBeDeleted: true }))[0],
  ).toBe("The branch task/parser will be deleted — its work is already merged into its base.");

  expect(
    archiveSummary(preview({ status: status({ pushed: true }), branchWouldBeDeleted: true }))[0],
  ).toBe("The branch task/parser will be deleted — its work is already on a remote.");
});

test("unpushed commits are counted, and the sentence agrees with itself at one", () => {
  expect(archiveSummary(preview({ status: status({ unpushed: 1 }) }))[0]).toBe(
    "The branch has 1 unpushed commit.",
  );
  expect(archiveSummary(preview({ status: status({ unpushed: 4 }) }))[0]).toBe(
    "The branch has 4 unpushed commits.",
  );
});
