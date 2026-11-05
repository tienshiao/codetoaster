import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { projectRoot, rootId, type RepoRoot } from "@/frontend/repo-root";
import { gitKeys } from "@/frontend/query-keys";
import {
  branchLabel,
  COMPOSER_REFS_POLL_MS,
  composerRefsPoll,
  useRootBranch,
} from "./use-root-branch";

/**
 * The composer's status bar branch (TASK-137). A rendering test because what
 * it answers depends on a query's lifecycle: the root it is pointed at
 * changing underneath it, and a route that refuses.
 */

const REFS: Record<string, { status: number; body: unknown }> = {
  "/api/projects/repo/git/refs": {
    status: 200,
    body: { head: { ref: "main", sha: "a".repeat(40) }, branches: [], remotes: [], tags: [] },
  },
  "/api/projects/detached/git/refs": {
    status: 200,
    body: { head: { ref: null, sha: "1234567890abcdef".padEnd(40, "0") }, branches: [], remotes: [], tags: [] },
  },
  "/api/projects/plain/git/refs": { status: 400, body: { error: "Not a git repository" } },
};

function stubFetch() {
  const fetch = vi.fn(async (url: string) => {
    const answer = REFS[url] ?? { status: 404, body: { error: "unknown" } };
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function wrapper(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

afterEach(() => vi.unstubAllGlobals());

test("the chosen project's branch, and the new one when the project changes", async () => {
  stubFetch();
  const { result, rerender } = renderHook(({ root }: { root: RepoRoot | null }) => useRootBranch(root), {
    wrapper: wrapper(),
    initialProps: { root: projectRoot("repo") },
  });
  await waitFor(() => expect(result.current).toBe("main"));

  rerender({ root: projectRoot("detached") });
  // A detached HEAD says where it is by commit.
  await waitFor(() => expect(result.current).toBe("1234567"));
});

test("a project that is not a repository shows no branch", async () => {
  const fetch = stubFetch();
  const { result } = renderHook(() => useRootBranch(projectRoot("plain")), { wrapper: wrapper() });
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  await waitFor(() => expect(result.current).toBeNull());
});

test("a repository that stops answering stops showing the branch it last had", async () => {
  const fetch = stubFetch();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { result } = renderHook(() => useRootBranch(projectRoot("repo")), { wrapper: wrapper(client) });
  await waitFor(() => expect(result.current).toBe("main"));

  fetch.mockImplementation(
    async () => new Response(JSON.stringify({ error: "Not a git repository" }), { status: 400 }),
  );
  await act(() => client.refetchQueries());
  // The query still holds "main" beside its error; the hook does not repeat it.
  const state = client.getQueryState(gitKeys.refs(rootId(projectRoot("repo"))));
  expect(state?.status).toBe("error");
  expect((state?.data as { head: { ref: string } } | undefined)?.head.ref).toBe("main");
  await waitFor(() => expect(result.current).toBeNull());
});

test("the poll stops for a root that has never answered, and keeps on for one that has", () => {
  expect(composerRefsPoll({ state: { status: "error", data: undefined } })).toBe(false);
  expect(composerRefsPoll({ state: { status: "error", data: {} } })).toBe(COMPOSER_REFS_POLL_MS);
  expect(composerRefsPoll({ state: { status: "pending", data: undefined } })).toBe(COMPOSER_REFS_POLL_MS);
  expect(composerRefsPoll({ state: { status: "success", data: {} } })).toBe(COMPOSER_REFS_POLL_MS);
});

test("no root asks nothing and shows nothing", () => {
  const fetch = stubFetch();
  const { result } = renderHook(() => useRootBranch(null), { wrapper: wrapper() });
  expect(result.current).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

test("a repository with no commits has a branch but no sha, and an empty head says nothing", () => {
  expect(branchLabel({ ref: "main", sha: "" })).toBe("main");
  expect(branchLabel({ ref: null, sha: "" })).toBeNull();
  expect(branchLabel(undefined)).toBeNull();
});
