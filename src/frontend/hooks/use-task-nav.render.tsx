import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

/**
 * What the sidebar's New task button does, which is the whole of TASK-76: it
 * lands on the composer and creates nothing.
 *
 * Both halves need a mounted tree — a hook, and a focus that only means
 * anything against a real `document` — so this is Vitest's, not `bun test`'s;
 * see CLAUDE.md, "Testing". The router is stubbed because the destination is
 * the assertion: a real one would need a route tree to navigate within, and
 * would answer a question about TanStack rather than about this hook.
 */

const stubs = vi.hoisted(() => ({
  navigate: vi.fn<(options: unknown) => Promise<void>>(),
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => stubs.navigate }));
// Pulled in by `useOpenTask` next door, and it opens a socket on import.
// Nothing here calls it; this only keeps the module graph inert.
vi.mock("@/frontend/TaskContext", () => ({ useTasks: () => ({ taskById: () => undefined }) }));

const { COMPOSER_PROMPT_ID, useOpenComposer } = await import("./use-task-nav");

beforeEach(() => {
  stubs.navigate.mockReset();
  stubs.navigate.mockResolvedValue(undefined);
});

afterEach(() => {
  document.body.innerHTML = "";
});

test("the New task button navigates to the composer and creates nothing", async () => {
  // Nothing is mounted at the prompt's id here, which is also the real case
  // where the composer has not painted yet by the time focus is attempted: a
  // throw there would surface as an unhandled rejection and nowhere else.
  const { result } = renderHook(() => useOpenComposer());

  await act(async () => {
    result.current();
  });

  expect(stubs.navigate).toHaveBeenCalledWith({ to: "/", search: {} });
  // The point of the task: no task is created on the way. The hook is given no
  // means to — it takes nothing from the store — and this says so.
  expect(stubs.navigate).toHaveBeenCalledTimes(1);
});

test("a project group's New task carries the project in the URL", async () => {
  // TASK-77. The id goes in the address rather than into a store, so the
  // composer reads it from the route it is mounted under and a reload lands
  // back on the same project.
  const { result } = renderHook(() => useOpenComposer());

  await act(async () => {
    result.current({ projectId: "web" });
  });

  expect(stubs.navigate).toHaveBeenCalledWith({ to: "/", search: { project: "web" } });
});

test("the prompt box takes focus once the navigation has landed", async () => {
  // The case autofocus does not cover: `/` is already what is showing, so the
  // composer never remounts and the press would otherwise do nothing visible.
  const textarea = document.createElement("textarea");
  textarea.id = COMPOSER_PROMPT_ID;
  document.body.appendChild(textarea);

  const { result } = renderHook(() => useOpenComposer());
  await act(async () => {
    result.current();
  });

  expect(document.activeElement).toBe(textarea);
});

