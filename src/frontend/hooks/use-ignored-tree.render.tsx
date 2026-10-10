import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { DirChildrenResponse, FileInfo } from "../types/file";
import { taskRoot } from "../repo-root";
import { useIgnoredTree } from "./use-task-files";

// A rendering test, so Vitest's, not `bun test`'s — see CLAUDE.md, "Testing".
//
// What to ask for is `walkIgnored`'s and tested as a function. What needs a
// real `QueryClient` is when: that a directory is fetched because it is open,
// that one inside it waits for its parent's answer, and that closing a
// directory stops watching it (TASK-130).

const TASK_ID = "task-1";

const ignoredDir = (path: string): FileInfo => ({
  path,
  name: path.slice(path.lastIndexOf("/") + 1),
  isDirectory: true,
  depth: path.split("/").length - 1,
  ignored: true,
});

const BASE: FileInfo[] = [
  { path: "README.md", name: "README.md", isDirectory: false, depth: 0 },
  ignoredDir("dist"),
  ignoredDir("node_modules"),
];

const CHILDREN: Record<string, DirChildrenResponse> = {
  dist: { entries: [ignoredDir("dist/deep")], truncated: 0 },
  "dist/deep": { entries: [], truncated: 0 },
  node_modules: { entries: [ignoredDir("node_modules/react")], truncated: 40 },
};

let asked: string[];
let client: QueryClient;

beforeEach(() => {
  asked = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const dir = new URL(url, "http://localhost").searchParams.get("dir")!;
      asked.push(dir);
      const answer = CHILDREN[dir];
      return answer
        ? new Response(JSON.stringify(answer))
        : new Response(JSON.stringify({ error: "Directory not found" }), { status: 404 });
    }),
  );
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  client.clear();
  vi.unstubAllGlobals();
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function mount(expanded: string[]) {
  return renderHook(({ expanded }) => useIgnoredTree(taskRoot(TASK_ID), BASE, expanded), {
    wrapper,
    initialProps: { expanded: new Set(expanded) },
  });
}

test("nothing is fetched for a tree with no ignored directory open", () => {
  const { result } = mount([]);
  expect(asked).toEqual([]);
  expect(result.current.files).toEqual(BASE);
  expect([...result.current.unloaded].sort()).toEqual(["dist", "node_modules"]);
});

test("an open ignored directory is fetched, and says so until it answers", async () => {
  const { result } = mount(["dist"]);
  expect(result.current.notes.get("dist")).toBe("Loading…");

  await waitFor(() => expect(result.current.files.map((f) => f.path)).toContain("dist/deep"));
  expect(asked).toEqual(["dist"]);
  expect(result.current.notes.has("dist")).toBe(false);
  expect(result.current.unloaded.has("dist")).toBe(false);
});

test("a directory inside one is fetched once its parent has answered, and not before", async () => {
  const { result } = mount(["dist", "dist/deep"]);
  await waitFor(() => expect(result.current.notes.get("dist/deep")).toBe("Empty"));
  expect(asked).toEqual(["dist", "dist/deep"]);
});

test("a directory cut short says how much is missing", async () => {
  const { result } = mount(["node_modules"]);
  await waitFor(() => expect(result.current.notes.get("node_modules")).toBe("40 more not shown"));
});

test("a directory that cannot be read says so, and the rest of the tree is unaffected", async () => {
  const base = [...BASE, ignoredDir("gone")];
  const { result } = renderHook(() => useIgnoredTree(taskRoot(TASK_ID), base, new Set(["gone", "dist"])), {
    wrapper,
  });
  await waitFor(() => expect(result.current.notes.get("gone")).toBe("Could not read this directory"));
  await waitFor(() => expect(result.current.files.map((f) => f.path)).toContain("dist/deep"));
});

test("closing a directory stops watching it", async () => {
  const { result, rerender } = mount(["dist"]);
  await waitFor(() => expect(result.current.files.map((f) => f.path)).toContain("dist/deep"));

  rerender({ expanded: new Set<string>() });
  expect(result.current.files).toEqual(BASE);

  // What a `changed` frame naming `dist/…` does: with no observer left, the
  // listing is marked stale and nothing is asked.
  await client.invalidateQueries({ queryKey: ["tasks", TASK_ID, "dir-children"] });
  expect(asked).toEqual(["dist"]);
});

test("opening or closing an ordinary directory leaves the tree as it was", async () => {
  const { result, rerender } = mount(["dist"]);
  await waitFor(() => expect(result.current.files.map((f) => f.path)).toContain("dist/deep"));

  // `src` is not ignored, so nothing here depends on whether it is open — and
  // this is the commonest click in the tree, which rebuilds every node it has
  // whenever `files` is a new array.
  const before = result.current;
  rerender({ expanded: new Set(["dist", "src"]) });
  expect(result.current).toBe(before);
});

test("a refetch that finds the directory as it was leaves the tree as it was", async () => {
  const { result } = mount(["dist"]);
  await waitFor(() => expect(result.current.files.map((f) => f.path)).toContain("dist/deep"));

  // A build rewriting the files it wrote before: a `changed` frame per second,
  // each a refetch of an open `dist`, and none with anything new to draw.
  const before = result.current;
  await act(() => client.invalidateQueries({ queryKey: ["tasks", TASK_ID, "dir-children", "dist"] }));
  await waitFor(() => expect(asked).toEqual(["dist", "dist"]));
  expect(result.current).toBe(before);
});

test("the tree keeps its identity across a render that changed nothing", async () => {
  const { result, rerender } = mount(["dist"]);
  await waitFor(() => expect(result.current.files.map((f) => f.path)).toContain("dist/deep"));

  const before = result.current;
  const expanded = new Set(["dist"]);
  rerender({ expanded });
  const settled = result.current;
  rerender({ expanded });
  // The tree rebuilds its nodes from `files` and prunes on `unloaded`; both
  // would run on every render of the Explorer otherwise.
  expect(result.current).toBe(settled);
  expect(settled.files).toEqual(before.files);
});
