import { afterEach, test, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useHunkExpansions } from "./use-hunk-expansions";
import { resetViewStates, viewRef } from "../view-state-store";
import type { DiffHunk, FileDiff } from "../types/diff";

// A rendering test, so Vitest's, not `bun test`'s — see CLAUDE.md, "Testing".
//
// Both cases here are races between a click and a response, so the fetch is
// held open rather than resolved: what the *second* thing to happen sees while
// the first is still out is the whole subject.

const PATH = "src/a.ts";

function hunk(newStart: number, newCount: number): DiffHunk {
  return {
    header: `@@ -${newStart},${newCount} +${newStart},${newCount} @@`,
    oldStart: newStart,
    oldCount: newCount,
    newStart,
    newCount,
    lines: [],
  };
}

function file(hunks: DiffHunk[]): FileDiff {
  return { oldPath: PATH, newPath: PATH, hunks, additions: 0, deletions: 0 };
}

/** A fetch that records what was asked for and hands back the requested range
 * only when the test says so. */
function heldFetch() {
  const calls: string[] = [];
  const waiting: Array<() => void> = [];
  vi.stubGlobal("fetch", (url: string) => {
    calls.push(url);
    return new Promise((settle) => {
      waiting.push(() => {
        const params = new URL(url, "http://test").searchParams;
        const start = Number(params.get("start"));
        const end = Number(params.get("end"));
        const lines: Array<{ lineNum: number; content: string }> = [];
        for (let n = start; n <= end; n++) lines.push({ lineNum: n, content: `line ${n}` });
        settle({ ok: true, json: async () => ({ lines, hasMore: true, tokens: null }) });
      });
    });
  });
  return {
    calls,
    range: (i: number) => {
      const params = new URL(calls[i]!, "http://test").searchParams;
      return [Number(params.get("start")), Number(params.get("end"))];
    },
    release: (i: number) => waiting[i]!(),
  };
}

afterEach(() => vi.unstubAllGlobals());

test("a chevron clamps against its neighbour's in-flight range, not only what has landed", async () => {
  // Two hunks thirty lines apart: hunk 0 ends at 10, hunk 1 starts at 41.
  const files = [file([hunk(1, 10), hunk(41, 5)])];
  const [first, second] = files[0]!.hunks as [DiffHunk, DiffHunk];
  const task = "expand-overlap";
  const net = heldFetch();
  const view = viewRef(task, "diffAll");
  const { result } = renderHook(() => useHunkExpansions(task, "diffAll", view, files));

  // ⌄ below hunk 0, then ⌃ above hunk 1 before the first lands. Both handlers
  // come from the same render, which is the point: the second cannot see the
  // first's lines in the map, only its claim on the gap.
  await act(async () => {
    void result.current.expandContext(PATH, 0, "after", first, null, second);
    void result.current.expandContext(PATH, 1, "before", second, first, null);
  });

  expect(net.calls).toHaveLength(2);
  expect(net.range(0)).toEqual([11, 30]);
  // 21–40 unclamped, which overlaps the twenty lines already on their way.
  expect(net.range(1)).toEqual([31, 40]);

  await act(async () => {
    net.release(0);
    net.release(1);
  });

  const expansions = result.current.hunkExpansions;
  const numbers = [
    ...expansions.get(`${PATH}:0`)!.afterLines,
    ...expansions.get(`${PATH}:1`)!.beforeLines,
  ].map((l) => l.newLineNum);
  expect(numbers).toEqual([...numbers].sort((a, b) => a! - b!));
  expect(new Set(numbers).size).toBe(numbers.length);

  resetViewStates(task);
});

test("a response whose hunk moved under it is dropped rather than committed", async () => {
  const before = [file([hunk(32, 5)])];
  // The agent edits the file while the request is out and the diff refetches:
  // the same hunk, twelve lines lower.
  const after = [file([hunk(44, 5)])];
  const task = "expand-moved";
  const net = heldFetch();
  const view = viewRef(task, "diffAll");
  const { result, rerender } = renderHook(
    ({ files }: { files: FileDiff[] }) => useHunkExpansions(task, "diffAll", view, files),
    { initialProps: { files: before } },
  );

  await act(async () => {
    void result.current.expandContext(PATH, 0, "before", before[0]!.hunks[0]!, null, null);
  });
  expect(net.range(0)).toEqual([12, 31]);

  rerender({ files: after });
  await act(async () => net.release(0));

  // Lines 12–31 are contiguous with where the hunk *was*, so the prune effect
  // would have kept them — there is nothing to prune, in fact, since no entry
  // existed before the response.
  expect(result.current.hunkExpansions.has(`${PATH}:0`)).toBe(false);

  resetViewStates(task);
});

test("a response whose hunk stayed put still commits", async () => {
  const files = [file([hunk(32, 5)])];
  const task = "expand-settled";
  const net = heldFetch();
  const view = viewRef(task, "diffAll");
  const { result } = renderHook(() => useHunkExpansions(task, "diffAll", view, files));

  await act(async () => {
    void result.current.expandContext(PATH, 0, "before", files[0]!.hunks[0]!, null, null);
  });
  await act(async () => net.release(0));

  const expansion = result.current.hunkExpansions.get(`${PATH}:0`)!;
  expect(expansion.beforeLines).toHaveLength(20);
  expect(expansion.beforeLines[0]!.newLineNum).toBe(12);
  expect(expansion.beforeLines[19]!.newLineNum).toBe(31);

  resetViewStates(task);
});
