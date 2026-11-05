import { expect, test } from "bun:test";
import { worktreeReviewPreamble } from "./generatePrompt";

test("a review of a worktree's diff names the worktree its paths are relative to", () => {
  expect(worktreeReviewPreamble("/repo/.claude/worktrees/side", true)).toBe(
    "These comments are on the worktree at /repo/.claude/worktrees/side; the paths below are relative to it.",
  );
});

test("the task's own checkout, or nothing to review, gets no preamble", () => {
  expect(worktreeReviewPreamble(null, true)).toBeNull();
  expect(worktreeReviewPreamble("/repo/.claude/worktrees/side", false)).toBeNull();
});
