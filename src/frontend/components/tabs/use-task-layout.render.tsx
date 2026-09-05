import { test, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTaskLayout } from "./use-task-layout";
import {
  createLayout,
  loadLayout,
  openTab,
  resetIdCounter,
  saveLayout,
  splitTab,
  type LayoutEnv,
  type TaskLayout,
} from "@/frontend/layout-store";

/**
 * The device policy at the layout's boundary (TASK-33, §9 risk 6). A
 * rendering test, so Vitest's — see CLAUDE.md, "Testing" — because what is
 * being checked is *when* the fold happens relative to a render: on the way
 * in, before the first paint; on the way out, on every write; and during the
 * render in which the viewport crosses the breakpoint, not an effect after it.
 */

const TASK = "task-1";

const keys = (layout: TaskLayout | null) =>
  layout?.groups.map((g) => g.tabs.map((t) => t.key)) ?? null;

/** A stored split: [agent, diff:a.ts] | [diff:a.ts]. */
function storeSplit(): TaskLayout {
  resetIdCounter();
  let layout = openTab(createLayout(), { kind: "diff", path: "a.ts" });
  layout = splitTab(layout, layout.groups[0]!.tabs[1]!.id);
  saveLayout(TASK, layout);
  return layout;
}

const PHONE: LayoutEnv = { singleGroup: true };

beforeEach(() => {
  localStorage.clear();
});

test("a stored split comes back as one group on a phone, without being rewritten", () => {
  storeSplit();

  const { result } = renderHook(() => useTaskLayout(TASK, PHONE));

  // Folded in the render that loaded it, so nothing paints two columns.
  expect(keys(result.current.layout)).toEqual([["agent", "diff:a.ts"]]);
  // A visit that edits nothing writes nothing: the desktop's split survives a
  // window dragged narrow for a moment.
  expect(keys(loadLayout(TASK))).toEqual([["agent", "diff:a.ts"], ["diff:a.ts"]]);
});

test("a write on a phone is folded before it is held or stored", () => {
  const split = storeSplit();
  const { result } = renderHook(() => useTaskLayout(TASK, PHONE));

  // What an edit derived from an unfolded layout would send back: the round
  // trip that would undo a read-side merge on its own.
  let committed: TaskLayout | undefined;
  act(() => {
    committed = result.current.setLayout(openTab(split, { kind: "history" }));
  });

  expect(keys(result.current.layout)).toEqual([["agent", "diff:a.ts", "history"]]);
  expect(keys(loadLayout(TASK))).toEqual([["agent", "diff:a.ts", "history"]]);
  // The caller keeping its own copy is handed what the store holds.
  expect(committed).toBe(result.current.layout);
});

test("crossing below the breakpoint folds the split on screen in the same render", () => {
  storeSplit();
  const { result, rerender } = renderHook(({ env }) => useTaskLayout(TASK, env), {
    initialProps: { env: {} as LayoutEnv },
  });
  expect(keys(result.current.layout)).toEqual([["agent", "diff:a.ts"], ["diff:a.ts"]]);

  rerender({ env: PHONE });

  expect(keys(result.current.layout)).toEqual([["agent", "diff:a.ts"]]);
  // Still a projection until something is edited.
  expect(keys(loadLayout(TASK))).toEqual([["agent", "diff:a.ts"], ["diff:a.ts"]]);
});

test("a desktop is untouched: the split is held and written as it is", () => {
  const split = storeSplit();
  const { result } = renderHook(() => useTaskLayout(TASK, {}));
  expect(keys(result.current.layout)).toEqual([["agent", "diff:a.ts"], ["diff:a.ts"]]);

  act(() => {
    result.current.setLayout(openTab(split, { kind: "history" }));
  });

  expect(result.current.layout?.groups).toHaveLength(2);
  expect(loadLayout(TASK).groups).toHaveLength(2);
});
