import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { MouseEvent } from "react";
import { projectRoot, taskRoot } from "@/frontend/repo-root";
import { useRevealInFinder, useRevealMenu } from "./use-reveal";

/**
 * Show in Finder as the surfaces outside a file tab reach it (TASK-131): the
 * gate, the request and the menu an Explorer row opens.
 *
 * A rendering test because the menu is state a hook holds between a
 * right-click and the row chosen; the route's own refusals are `files.test.ts`'s.
 */

const stubs = vi.hoisted(() => ({ canReveal: true, toastError: vi.fn() }));

vi.mock("@/frontend/utils/platform", () => ({ canRevealInFinder: () => stubs.canReveal }));
vi.mock("sonner", () => ({ toast: { error: stubs.toastError } }));

let requests: Array<{ url: string; body: unknown }> = [];
let answer: () => Response;

beforeEach(() => {
  stubs.canReveal = true;
  stubs.toastError.mockReset();
  requests = [];
  answer = () => new Response(null, { status: 204 });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return answer();
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

/** A right-click, as much of one as the hook reads. */
function rightClick(x: number, y: number) {
  return { clientX: x, clientY: y, preventDefault: vi.fn() } as unknown as MouseEvent & {
    preventDefault: ReturnType<typeof vi.fn>;
  };
}

test("revealing posts the path to the root's reveal route", async () => {
  const task = renderHook(() => useRevealInFinder(taskRoot("t1")));
  task.result.current!("src/a.ts");
  await waitFor(() => expect(requests).toEqual([{ url: "/api/tasks/t1/reveal", body: { file: "src/a.ts" } }]));

  const project = renderHook(() => useRevealInFinder(projectRoot("web")));
  project.result.current!("docs");
  await waitFor(() => expect(requests[1]).toEqual({ url: "/api/projects/web/reveal", body: { file: "docs" } }));
  expect(stubs.toastError).not.toHaveBeenCalled();
});

test("a reveal the server refuses is said in a toast, with the server's words", async () => {
  answer = () => Response.json({ error: "File not found" }, { status: 404 });
  const { result } = renderHook(() => useRevealInFinder(taskRoot("t1")));
  result.current!("gone.ts");
  await waitFor(() =>
    expect(stubs.toastError).toHaveBeenCalledWith("Could not show gone.ts in Finder", {
      description: "File not found",
    }),
  );
});

test("where Finder cannot be shown there is nothing to call and no menu to open", () => {
  stubs.canReveal = false;
  expect(renderHook(() => useRevealInFinder(taskRoot("t1"))).result.current).toBeUndefined();

  const { result } = renderHook(() => useRevealMenu(taskRoot("t1")));
  // No handler at all, so a row's right-click stays the browser's.
  expect(result.current.onContextMenu).toBeUndefined();
  expect(result.current.menu.at).toBeNull();
});

test("a right-click opens the menu at the pointer, and its one row reveals that path", async () => {
  const { result } = renderHook(() => useRevealMenu(taskRoot("t1")));
  expect(result.current.menu.at).toBeNull();

  const event = rightClick(40, 90);
  act(() => result.current.onContextMenu!(event, "backlog/tasks/task-1 - a.md"));
  // The browser's own menu would otherwise open on top of this one.
  expect(event.preventDefault).toHaveBeenCalled();
  expect(result.current.menu.at).toEqual({ x: 40, y: 90 });
  expect(result.current.menu.items.map((item) => item.label)).toEqual(["Show in Finder"]);

  const [row] = result.current.menu.items;
  if (!row || row.separator || row.section) throw new Error("expected an action row");
  row.onSelect();
  await waitFor(() =>
    expect(requests).toEqual([{ url: "/api/tasks/t1/reveal", body: { file: "backlog/tasks/task-1 - a.md" } }]),
  );

  act(() => result.current.menu.onDismiss());
  expect(result.current.menu.at).toBeNull();
});

test("a menu left open closes when the root changes under it", () => {
  // A chord can move the shell to another task with the menu still up, and the
  // path it names is the old root's.
  const { result, rerender } = renderHook(({ id }) => useRevealMenu(taskRoot(id)), {
    initialProps: { id: "t1" },
  });
  act(() => result.current.onContextMenu!(rightClick(1, 2), "a.ts"));
  expect(result.current.menu.at).toEqual({ x: 1, y: 2 });

  rerender({ id: "t2" });
  expect(result.current.menu.at).toBeNull();
  expect(result.current.menu.items).toEqual([]);

  // And it is closed for good, not waiting for the first root to come back.
  rerender({ id: "t1" });
  expect(result.current.menu.at).toBeNull();
});

test("a second right-click moves the menu to the new row", () => {
  const { result } = renderHook(() => useRevealMenu(taskRoot("t1")));
  act(() => result.current.onContextMenu!(rightClick(1, 2), "a.ts"));
  act(() => result.current.onContextMenu!(rightClick(3, 4), "b.ts"));
  expect(result.current.menu.at).toEqual({ x: 3, y: 4 });
  expect(result.current.menu["aria-label"]).toBe("b.ts");
});
