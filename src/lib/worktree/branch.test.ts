import { test, expect, describe } from "bun:test";
import { branchSlug } from "./branch";

describe("branchSlug", () => {
  test("is the title, not the URL slug", () => {
    // The URL slug ends in the task's uuid, which is what makes a link survive
    // a rename. A branch outlives its task, and is read in `git branch` by
    // someone who gains nothing from thirty-six characters of uuid — and a
    // uuid would make every name unique, leaving §5.6's collision suffixing
    // guarding a case that could not happen.
    expect(branchSlug({ id: "1fc1-abcd", title: "Fix the parser" })).toBe("fix-the-parser");
  });

  test("collapses everything that is not a ref-safe character", () => {
    expect(branchSlug({ id: "x", title: "Fix: the parser (again!)" })).toBe("fix-the-parser-again");
    expect(branchSlug({ id: "x", title: "  spaces  everywhere  " })).toBe("spaces-everywhere");
  });

  test("truncates, and trims the dash the truncation lands on", () => {
    const slug = branchSlug({ id: "x", title: "a".repeat(40) + " " + "b".repeat(40) });

    expect(slug.length).toBeLessThanOrEqual(60);
    // Cut mid-word, the separator would be left dangling — `refs/heads/x-` is
    // a name git takes and nobody wants — so the trim runs after the cut.
    expect(slug.endsWith("-")).toBe(false);
  });

  test("falls back to the task id when a title slugifies to nothing", () => {
    // Unreadable, but valid and unique. The alternative is refusing to make a
    // worktree because of what someone called their task.
    expect(branchSlug({ id: "task-99", title: "???" })).toBe("task-99");
    expect(branchSlug({ id: "task-99", title: "" })).toBe("task-99");
    expect(branchSlug({ id: "task-99", title: "日本語" })).toBe("task-99");
  });
});
