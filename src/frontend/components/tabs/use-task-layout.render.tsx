import { test, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTaskLayout } from "./use-task-layout";
import {
  activeTab,
  createLayout,
  focusTab,
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

test("crossing back above the breakpoint brings the split back, unwritten", () => {
  // A desktop window docked narrow for a moment: the fold was a projection,
  // so widening again shows what storage still holds — and the next write
  // from a desktop stores the split, not the fold.
  const split = storeSplit();
  const { result, rerender } = renderHook(({ env }) => useTaskLayout(TASK, env), {
    initialProps: { env: {} as LayoutEnv },
  });
  rerender({ env: PHONE });
  expect(keys(result.current.layout)).toEqual([["agent", "diff:a.ts"]]);

  rerender({ env: {} });

  expect(keys(result.current.layout)).toEqual([["agent", "diff:a.ts"], ["diff:a.ts"]]);
  act(() => {
    result.current.setLayout(openTab(split, { kind: "history" }));
  });
  expect(loadLayout(TASK).groups).toHaveLength(2);
});

test("a tap on a tab on a phone is a focus applied to the stored split, not a fold", () => {
  storeSplit();
  const { result } = renderHook(() => useTaskLayout(TASK, PHONE));
  const shown = result.current.layout!;
  const diffTab = shown.groups[0]!.tabs[1]!;

  act(() => {
    result.current.setLayout(focusTab(shown, diffTab.id));
  });

  expect(activeTab(result.current.layout!)?.key).toBe("diff:a.ts");
  // The split survived, and the focus reached it by tab id.
  const stored = loadLayout(TASK);
  expect(keys(stored)).toEqual([["agent", "diff:a.ts"], ["diff:a.ts"]]);
  expect(activeTab(stored)?.key).toBe("diff:a.ts");
});

test("an edit the shell makes itself runs over the stored split, and the fold is only shown", () => {
  // A `?tab=` link, a dead shell tab, a file from the Explorer: none of them
  // is a layout the user built on this device, so none of them should decide
  // that the desktop has one group from now on.
  storeSplit();
  const { result } = renderHook(() => useTaskLayout(TASK, PHONE));

  let shown: TaskLayout | null = null;
  act(() => {
    shown = result.current.editLayout((stored) => {
      expect(stored.groups).toHaveLength(2);
      return openTab(stored, { kind: "history" });
    });
  });

  expect(shown).toBe(result.current.layout);
  expect(keys(result.current.layout)).toEqual([["agent", "diff:a.ts", "history"]]);
  // Opened into the stored layout's active group — the right one, where
  // `splitTab` left focus — with the split intact around it.
  expect(keys(loadLayout(TASK))).toEqual([["agent", "diff:a.ts"], ["diff:a.ts", "history"]]);
});

test("a write that changes nothing writes nothing", () => {
  storeSplit();
  const { result } = renderHook(() => useTaskLayout(TASK, PHONE));
  const before = result.current.layout!;
  localStorage.clear();

  let returned: TaskLayout | null = null;
  act(() => {
    returned = result.current.editLayout((stored) => stored);
  });
  expect(returned).toBe(before);
  act(() => {
    returned = result.current.setLayout(before);
  });
  expect(returned).toBe(before);
  // Nothing went back to storage.
  expect(localStorage.length).toBe(0);
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
