import { test, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { FetchUntilStatus } from "./use-git-log";

// A rendering test, so Vitest's, not `bun test`'s — see CLAUDE.md, "Testing".
//
// The subject is `selectRef`'s seek outliving the task it was started for, so
// everything the hook talks to is stubbed down to the one thing that matters:
// a `fetchUntil` the test resolves by hand. The real one polls for up to five
// seconds waiting out an in-flight page fetch, which is exactly why there is
// time to switch tasks underneath it.

const stubs = vi.hoisted(() => ({
  fetchUntil: vi.fn<(sha: string) => Promise<FetchUntilStatus>>(),
  refetch: vi.fn(),
  resetQueries: vi.fn(),
  toast: vi.fn(),
  commits: [] as Array<{ hash: string }>,
}));

vi.mock("./use-git-log", () => ({
  useGitLog: () => ({
    data: { pages: [{ commits: stubs.commits }] },
    fetchUntil: stubs.fetchUntil,
  }),
}));
vi.mock("./use-git-refs", () => ({
  useGitRefs: () => ({ data: undefined, refetch: stubs.refetch }),
}));
vi.mock("../components/git/RefChip", () => ({ useRefSets: () => ({}) }));
vi.mock("../TaskContext", () => ({ useTasks: () => ({ activity: {} }) }));
vi.mock("../query-client", () => ({ queryClient: { resetQueries: stubs.resetQueries } }));
vi.mock("sonner", () => ({ toast: stubs.toast }));

const { useGitHistory } = await import("./use-git-history");

/** A `fetchUntil` the test resolves when it chooses, one call at a time. */
function heldSeek() {
  const waiting: Array<(status: FetchUntilStatus) => void> = [];
  stubs.fetchUntil.mockImplementation(() => new Promise((resolve) => waiting.push(resolve)));
  return (i: number, status: FetchUntilStatus) => waiting[i]!(status);
}

/**
 * The hook as the Explorer holds it: one instance whose `taskId` changes, and
 * an `onSelect` that opens a tab in whichever task is selected *now* — because
 * that is what the layout handler it is built from does.
 */
function mountAcrossTasks() {
  const opened: Array<{ taskId: string; sha: string }> = [];
  let current = "task-a";
  const view = renderHook(
    ({ taskId }: { taskId: string }) => {
      current = taskId;
      return useGitHistory(taskId, (sha) => opened.push({ taskId: current, sha }));
    },
    { initialProps: { taskId: "task-a" } },
  );
  return { ...view, opened };
}

test("a seek that resolves after the task changed opens nothing", async () => {
  const release = heldSeek();
  const { result, rerender, opened } = mountAcrossTasks();

  act(() => void result.current.selectRef("aaaaaaa"));
  expect(result.current.pendingRefSha).toBe("aaaaaaa");

  rerender({ taskId: "task-b" });
  await act(async () => release(0, "found"));

  // A `commit:aaaaaaa` tab in task B's layout would sit there fetching
  // /api/tasks/task-b/git/commit/aaaaaaa, which cannot resolve.
  expect(opened).toEqual([]);
});

test("switching tasks takes the seeking ref's spinner with it", async () => {
  const release = heldSeek();
  const { result, rerender } = mountAcrossTasks();

  act(() => void result.current.selectRef("aaaaaaa"));
  rerender({ taskId: "task-b" });

  // The sidebar drawn for task B has its own rows; one of them matching this
  // sha by coincidence would spin for a seek nobody asked it to make.
  expect(result.current.pendingRefSha).toBeNull();
  await act(async () => release(0, "found"));
});

test("a stale seek resolving does not clear the new task's own spinner", async () => {
  const release = heldSeek();
  const { result, rerender } = mountAcrossTasks();

  act(() => void result.current.selectRef("aaaaaaa"));
  rerender({ taskId: "task-b" });
  act(() => void result.current.selectRef("bbbbbbb"));
  expect(result.current.pendingRefSha).toBe("bbbbbbb");

  await act(async () => release(0, "found"));

  expect(result.current.pendingRefSha).toBe("bbbbbbb");
  await act(async () => release(1, "found"));
  expect(result.current.pendingRefSha).toBeNull();
});

test("a seek that resolves on the task it was started for still selects", async () => {
  const release = heldSeek();
  const { result, opened } = mountAcrossTasks();

  act(() => void result.current.selectRef("aaaaaaa"));
  await act(async () => release(0, "found"));

  expect(opened).toEqual([{ taskId: "task-a", sha: "aaaaaaa" }]);
  expect(result.current.pendingRefSha).toBeNull();
});

test("a failed seek on a task left behind says nothing", async () => {
  const release = heldSeek();
  const { result, rerender } = mountAcrossTasks();

  act(() => void result.current.selectRef("aaaaaaa"));
  rerender({ taskId: "task-b" });
  await act(async () => release(0, "too-deep"));

  // A toast about history the user is no longer looking at is noise.
  expect(stubs.toast).not.toHaveBeenCalled();
});
