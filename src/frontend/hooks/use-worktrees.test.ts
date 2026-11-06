import { describe, expect, test } from "bun:test";
import { worktreeLabel } from "./use-worktrees";

describe("worktreeLabel", () => {
  test("names the branch and the directory", () => {
    expect(worktreeLabel({ path: "/src/shots-repo-feature", branch: "feature/streaming", head: "abc1234def" }))
      .toBe("feature/streaming · shots-repo-feature");
  });

  test("drops the directory when the branch already names it", () => {
    expect(
      worktreeLabel({
        path: "/repo/.claude/worktrees/task-136-change-highlight",
        branch: "worktree-task-136-change-highlight",
        head: "abc1234def",
      }),
    ).toBe("worktree-task-136-change-highlight");
    expect(worktreeLabel({ path: "/repo/Main/", branch: "main", head: "abc1234def" })).toBe("main");
  });

  test("keeps the directory when the branch only contains it inside a word", () => {
    expect(worktreeLabel({ path: "/repo/web", branch: "feature/webhooks", head: "abc1234def" }))
      .toBe("feature/webhooks · web");
    expect(worktreeLabel({ path: "/wt/x", branch: "fix-xyz", head: "abc1234def" })).toBe("fix-xyz · x");
    expect(worktreeLabel({ path: "/wt/feature", branch: "feature/webhooks", head: "abc1234def" }))
      .toBe("feature/webhooks");
  });

  test("a detached worktree is its short SHA and always keeps its directory", () => {
    expect(worktreeLabel({ path: "/wt/abc1234", branch: null, head: "abc1234def" })).toBe("abc1234 · abc1234");
  });
});
