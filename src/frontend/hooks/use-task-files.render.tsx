import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { taskKeys } from "../query-keys";
import type { FilesResponse } from "../types/file";
import { useTaskFiles } from "./use-task-files";

// A rendering test, so Vitest's, not `bun test`'s — see CLAUDE.md, "Testing".
//
// The subject is `enabled: false` against a real `QueryClient`: what it buys
// is a react-query rule (invalidation refetches only active observers), so a
// mocked `useQuery` would test nothing.

const TASK_ID = "task-1";
const LISTING: FilesResponse = { directory: "/repo", files: [] };

let fetches = 0;
let client: QueryClient;

beforeEach(() => {
  fetches = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      fetches += 1;
      return new Response(JSON.stringify(LISTING));
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

function mount(enabled: boolean) {
  return renderHook(({ enabled }) => useTaskFiles(TASK_ID, { enabled }), {
    wrapper,
    initialProps: { enabled },
  });
}

/** What `change-invalidation.ts` does with a `changed` frame. */
async function filesChanged() {
  await act(() => client.invalidateQueries({ queryKey: taskKeys.files(TASK_ID) }));
}

test("a disabled observer fetches nothing of its own", async () => {
  const { result } = mount(false);
  await filesChanged();
  expect(fetches).toBe(0);
  expect(result.current.data).toBeUndefined();
});

test("a disabled observer reads what is cached, and a change does not refetch it", async () => {
  client.setQueryData(taskKeys.files(TASK_ID), LISTING);
  const { result } = mount(false);
  expect(result.current.data).toEqual(LISTING);

  await filesChanged();
  expect(fetches).toBe(0);
  // Stale, but still served: a hidden terminal keeps its links.
  expect(result.current.data).toEqual(LISTING);
});

test("an enabled observer refetches on a change", async () => {
  const { result } = mount(true);
  await waitFor(() => expect(result.current.data).toEqual(LISTING));
  expect(fetches).toBe(1);

  await filesChanged();
  await waitFor(() => expect(fetches).toBe(2));
});

test("turning a stale observer on refetches it", async () => {
  client.setQueryData(taskKeys.files(TASK_ID), LISTING);
  const { rerender } = mount(false);
  await filesChanged();
  expect(fetches).toBe(0);

  rerender({ enabled: true });
  await waitFor(() => expect(fetches).toBe(1));
});
