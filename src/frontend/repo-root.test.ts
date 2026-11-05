import { test, expect } from "bun:test";
import { decodeWorktreeToken } from "@/lib/worktree-token";
import {
  baseRoot,
  baseRootId,
  isWatchedRoot,
  projectRoot,
  refetchOnFocusFor,
  rootApi,
  rootId,
  taskRoot,
  worktreeRoot,
} from "./repo-root";

// A worktree root (TASK-138.2): served under a token the server decodes with
// the same codec, and identified in caches apart from its base.

const TASK = "6f1c2b8e-0000-4000-8000-000000000001";

test("a task and a project keep the prefixes and ids they always had", () => {
  expect(rootApi(taskRoot(TASK))).toBe(`/api/tasks/${TASK}`);
  expect(rootApi(projectRoot("web"))).toBe("/api/projects/web");
  expect(rootId(taskRoot(TASK))).toBe(TASK);
  expect(rootId(projectRoot("web"))).toBe("project:web");
});

test("a worktree root is served under a token the server's decoder reads back", () => {
  const prefix = "/api/worktrees/";
  const forTask = rootApi(worktreeRoot(taskRoot(TASK), "/repo/.claude/worktrees/agent-a"));
  expect(forTask.startsWith(prefix)).toBe(true);
  expect(decodeWorktreeToken(forTask.slice(prefix.length))).toEqual({
    scope: "tasks",
    id: TASK,
    path: "/repo/.claude/worktrees/agent-a",
  });

  const forProject = rootApi(worktreeRoot(projectRoot("web"), "/tmp/ü side"));
  expect(decodeWorktreeToken(forProject.slice(prefix.length))).toEqual({
    scope: "projects",
    id: "web",
    path: "/tmp/ü side",
  });
});

test("a worktree's id is stable, distinct per path and per base, and gives its base back", () => {
  const a = rootId(worktreeRoot(taskRoot(TASK), "/repo/wt-a"));
  expect(rootId(worktreeRoot(taskRoot(TASK), "/repo/wt-a"))).toBe(a);
  expect(rootId(worktreeRoot(taskRoot(TASK), "/repo/wt-b"))).not.toBe(a);
  expect(rootId(worktreeRoot(projectRoot("web"), "/repo/wt-a"))).not.toBe(a);
  expect(a).not.toBe(TASK);

  expect(baseRootId(a)).toBe(TASK);
  expect(baseRootId(rootId(worktreeRoot(projectRoot("web"), "/odd:path/with:colons")))).toBe("project:web");
  expect(baseRootId(TASK)).toBe(TASK);
  expect(baseRootId("project:web")).toBe("project:web");
});

test("a worktree of a worktree is a worktree of the base", () => {
  const nested = worktreeRoot(worktreeRoot(taskRoot(TASK), "/repo/wt-a"), "/repo/wt-b");
  expect(nested).toEqual({ kind: "worktree", base: { kind: "task", id: TASK }, path: "/repo/wt-b" });
  expect(baseRoot(nested)).toEqual({ kind: "task", id: TASK });
});

test("nothing watches a worktree, so it refetches on focus and flashes nothing", () => {
  const wt = worktreeRoot(taskRoot(TASK), "/repo/wt-a");
  expect(refetchOnFocusFor(wt)).toBe(true);
  expect(refetchOnFocusFor(taskRoot(TASK))).toBe(false);
  expect(refetchOnFocusFor(projectRoot("web"))).toBe(true);
  expect(isWatchedRoot(wt)).toBe(false);
  expect(isWatchedRoot(taskRoot(TASK))).toBe(true);
});
