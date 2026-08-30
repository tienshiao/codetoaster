import { test, expect } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { useViewState } from "./use-view-state";
import { getViewState, resetViewStates, setViewField, viewRef } from "../view-state-store";
import type { LineComment } from "../types/diff";

function comment(filePath: string): LineComment {
  return {
    id: filePath,
    filePath,
    lineNumber: 1,
    lineType: "addition",
    hunkIndex: 0,
    content: `note on ${filePath}`,
    createdAt: 0,
    updatedAt: 0,
  };
}

// ── two panes, one slot ─────────────────────────────────────────────────────
//
// A split can put two live views on the same slot: the all-files diff beside a
// single file of it both address the task's one `review`, and two commit tabs
// both address `prefs`. These are the tests for that, because it is the case a
// hook backed by its own `useState` copy gets silently wrong.

test("a write through one instance reaches another on the same slot", () => {
  const task = "two-panes";
  const ref = viewRef(task, "review");
  const left = renderHook(() => useViewState("review", ref, "comments"));
  const right = renderHook(() => useViewState("review", ref, "comments"));

  act(() => left.result.current[1](new Map([["src/a.ts:1:addition", comment("src/a.ts")]])));

  expect(right.result.current[0].size).toBe(1);
  expect(right.result.current[0].get("src/a.ts:1:addition")?.content).toBe("note on src/a.ts");
  resetViewStates(task);
});

test("an updater resolves against the store, so one pane cannot discard the other's write", () => {
  const task = "no-lost-write";
  const ref = viewRef(task, "review");
  const left = renderHook(() => useViewState("review", ref, "comments"));
  const right = renderHook(() => useViewState("review", ref, "comments"));

  // The review flow: each pane appends to the map it was handed. Resolved
  // against a private copy, the second append is computed from a map snapshotted
  // before the first and writes it back — losing a comment the user typed.
  act(() => left.result.current[1]((prev) => new Map(prev).set("a", comment("src/a.ts"))));
  act(() => right.result.current[1]((prev) => new Map(prev).set("b", comment("src/b.ts"))));

  const stored = getViewState("review", ref).comments;
  expect([...stored.keys()].sort()).toEqual(["a", "b"]);
  expect(left.result.current[0].size).toBe(2);
  expect(right.result.current[0].size).toBe(2);
  resetViewStates(task);
});

test("a write outside React reaches a mounted instance", () => {
  const task = "external-write";
  const ref = viewRef(task, "diffAll");
  const pane = renderHook(() => useViewState("diffAll", ref, "selectedFile"));

  act(() => setViewField("diffAll", ref, "selectedFile", "src/a.ts"));

  expect(pane.result.current[0]).toBe("src/a.ts");
  resetViewStates(task);
});

// ── what must NOT wake ──────────────────────────────────────────────────────

test("a write to one field leaves an instance on another field alone", () => {
  const task = "per-field";
  const ref = viewRef(task, "diffAll");
  let renders = 0;
  renderHook(() => {
    renders += 1;
    return useViewState("diffAll", ref, "selectedFile");
  });
  const settled = renders;

  // `scrollTop` is written on every frame of a scroll. Notifying per slot rather
  // than per field would re-render every pane on that slot for the whole gesture.
  act(() => setViewField("diffAll", ref, "scrollTop", 400));

  expect(renders).toBe(settled);
  resetViewStates(task);
});

test("two view keys in one task do not wake each other", () => {
  const task = "per-key";
  const one = renderHook(() =>
    useViewState("diffFile", viewRef(task, "diff:src/a.ts"), "scrollTop"),
  );
  const other = renderHook(() =>
    useViewState("diffFile", viewRef(task, "diff:src/b.ts"), "scrollTop"),
  );

  act(() => one.result.current[1](250));

  expect(one.result.current[0]).toBe(250);
  expect(other.result.current[0]).toBe(0);
  resetViewStates(task);
});

test("an unmounted instance stops being notified", () => {
  const task = "unmount";
  const ref = viewRef(task, "prefs");
  const gone = renderHook(() => useViewState("prefs", ref, "treeLineWrap"));
  const stays = renderHook(() => useViewState("prefs", ref, "treeLineWrap"));
  gone.unmount();

  // A listener left behind would set state on an unmounted tree — React's
  // warning, and a leak for the life of the page in a UI where panes come and go.
  act(() => stays.result.current[1](true));

  expect(stays.result.current[0]).toBe(true);
  expect(getViewState("prefs", ref).treeLineWrap).toBe(true);
  resetViewStates(task);
});

// ── binding ─────────────────────────────────────────────────────────────────

test("an instance hydrates from the slot rather than from its own default", () => {
  const task = "hydrate";
  const ref = viewRef(task, "file:src/a.ts");
  setViewField("file", ref, "lineWrap", true);

  const pane = renderHook(() => useViewState("file", ref, "lineWrap"));

  expect(pane.result.current[0]).toBe(true);
  resetViewStates(task);
});

test("a write lands on the slot named by the ref, not the one held at mount", () => {
  const task = "write-through";
  const ref = viewRef(task, "commit:abc123");
  const pane = renderHook(() => useViewState("commit", ref, "mode"));

  act(() => pane.result.current[1]("tree"));

  expect(getViewState("commit", ref).mode).toBe("tree");
  expect(getViewState("commit", viewRef(task, "commit:def456")).mode).toBe("commit");
  resetViewStates(task);
});
