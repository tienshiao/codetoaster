import { useState } from "react";
import { test, expect } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { ChangePulseStore, useChangePulses } from "./change-pulse-store";
import { FileTree as WorkspaceFileTree } from "./components/file/FileTree";
import { FileTree as DiffFileTree } from "./components/diff/FileTree";
import { FileContent } from "./components/file/FileContent";
import { DiffFile } from "./components/diff/DiffFile";
import { taskRoot } from "./repo-root";
import type { FileInfo, FileContentResponse } from "./types/file";
import type { FileDiff } from "./types/diff";

/**
 * The change flash (TASK-136) is a lifecycle behaviour through and through:
 * whether a row is lit depends on when its list mounted, a repeat depends on
 * the class it already carries, and a line view compares against what it drew
 * last. The pure halves — the store's windowing and the line comparison — are
 * tested as functions; this is the seam where they meet a mounted tree.
 */

const FLASH = /change-flash-[ab]/;
const flashOf = (el: Element) => el.className.match(FLASH)?.[0];

function manualClock(start = 10_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

// ── list rows ────────────────────────────────────────────────────────────────

const FILES: FileInfo[] = [
  { path: "src", name: "src", isDirectory: true, depth: 0 },
  { path: "src/a.ts", name: "a.ts", isDirectory: false, depth: 1, size: 10 },
  { path: "src/b.ts", name: "b.ts", isDirectory: false, depth: 1, size: 10 },
  { path: "dist", name: "dist", isDirectory: true, depth: 0, ignored: true },
];

function FilesHarness({
  store,
  files = FILES,
  expanded = ["src"],
  rootId = "t1",
}: {
  store: ChangePulseStore;
  files?: FileInfo[];
  expanded?: string[];
  rootId?: string;
}) {
  const changeFlash = useChangePulses(rootId, store);
  const [expandedPaths, setExpandedPaths] = useState(() => new Set(expanded));
  return (
    <WorkspaceFileTree
      files={files}
      selectedFile={null}
      onSelectFile={() => {}}
      expandedPaths={expandedPaths}
      onExpandedPathsChange={setExpandedPaths}
      changeFlash={changeFlash}
    />
  );
}

test("a file the agent writes flashes its row, and only its row", () => {
  const clock = manualClock();
  const store = new ChangePulseStore(clock.now);
  render(<FilesHarness store={store} />);
  expect(flashOf(screen.getByTitle("src/a.ts"))).toBeUndefined();

  clock.advance(5);
  act(() => store.record("t1", ["src/a.ts"]));

  expect(flashOf(screen.getByTitle("src/a.ts"))).toBeDefined();
  expect(flashOf(screen.getByTitle("src/b.ts"))).toBeUndefined();
  // Open, so the directory leaves the cue to the row it holds.
  expect(flashOf(screen.getByTitle("src"))).toBeUndefined();
});

test("a refetch that changed nothing flashes nothing", () => {
  const clock = manualClock();
  const store = new ChangePulseStore(clock.now);
  const { rerender } = render(<FilesHarness store={store} />);
  // The same listing in fresh objects, the way a refetch delivers it.
  rerender(<FilesHarness store={store} files={FILES.map((f) => ({ ...f }))} />);
  for (const path of ["src", "src/a.ts", "src/b.ts"]) {
    expect(flashOf(screen.getByTitle(path))).toBeUndefined();
  }
});

test("a list mounted after the change starts quiet", () => {
  const clock = manualClock();
  const store = new ChangePulseStore(clock.now);
  const { unmount } = render(<FilesHarness store={store} />);
  clock.advance(5);
  act(() => store.record("t1", ["src/a.ts"]));
  expect(flashOf(screen.getByTitle("src/a.ts"))).toBeDefined();

  // A rail switch away and back, well inside the pulse's window.
  unmount();
  clock.advance(100);
  render(<FilesHarness store={store} />);
  expect(flashOf(screen.getByTitle("src/a.ts"))).toBeUndefined();
});

// The Explorer is not keyed by root, so a section stays mounted across a task
// switch; the switch has to be a fresh baseline the way a remount is.
test("a list pointed at another root starts quiet for that root", () => {
  const clock = manualClock();
  const store = new ChangePulseStore(clock.now);
  const { rerender } = render(<FilesHarness store={store} />);
  clock.advance(5);
  act(() => store.record("t2", ["src/a.ts"]));
  clock.advance(100);
  rerender(<FilesHarness store={store} rootId="t2" />);
  expect(flashOf(screen.getByTitle("src/a.ts"))).toBeUndefined();

  clock.advance(5);
  act(() => store.record("t2", ["src/a.ts"]));
  expect(flashOf(screen.getByTitle("src/a.ts"))).toBeDefined();
});

test("a row that appears because of the change flashes as it arrives", () => {
  const clock = manualClock();
  const store = new ChangePulseStore(clock.now);
  const { rerender } = render(<FilesHarness store={store} />);
  clock.advance(5);
  act(() => store.record("t1", ["src/c.ts"]));
  // The refetch lands a moment later with the new file in it.
  clock.advance(80);
  rerender(
    <FilesHarness
      store={store}
      files={[...FILES, { path: "src/c.ts", name: "c.ts", isDirectory: false, depth: 1, size: 1 }]}
    />,
  );
  expect(flashOf(screen.getByTitle("src/c.ts"))).toBeDefined();
});

test("a second change while still fading restarts the fade", () => {
  const clock = manualClock();
  const store = new ChangePulseStore(clock.now);
  render(<FilesHarness store={store} />);
  clock.advance(5);
  act(() => store.record("t1", ["src/a.ts"]));
  const first = flashOf(screen.getByTitle("src/a.ts"));
  clock.advance(500);
  act(() => store.record("t1", ["src/a.ts"]));
  const second = flashOf(screen.getByTitle("src/a.ts"));
  // A different animation name is what makes the browser start it over.
  expect(first).toBeDefined();
  expect(second).toBeDefined();
  expect(second).not.toBe(first);
});

test("a collapsed directory stands in for what changed under it, ignored writes aside", () => {
  const clock = manualClock();
  const store = new ChangePulseStore(clock.now);
  render(<FilesHarness store={store} expanded={[]} />);
  clock.advance(5);
  act(() => store.record("t1", ["src/a.ts"], ["dist/bundle.js"]));
  expect(flashOf(screen.getByTitle("src"))).toBeDefined();
  // A build writing into an ignored directory does not keep it lit.
  expect(flashOf(screen.getByTitle("dist (ignored)"))).toBeUndefined();
});

test("the expired pulse is not handed to a row mounted later", () => {
  const clock = manualClock();
  const store = new ChangePulseStore(clock.now);
  const { rerender } = render(<FilesHarness store={store} expanded={[]} />);
  clock.advance(5);
  act(() => store.record("t1", ["src/a.ts"]));
  // Long after the fade, the directory is opened: its rows mount now.
  clock.advance(10_000);
  rerender(<FilesHarness store={store} expanded={[]} files={FILES.map((f) => ({ ...f }))} />);
  expect(flashOf(screen.getByTitle("src"))).toBeUndefined();
});

test("the Changes tree flashes a changed file the same way", () => {
  const clock = manualClock();
  const store = new ChangePulseStore(clock.now);
  const diff = (path: string): FileDiff => ({
    oldPath: path,
    newPath: path,
    status: "modified",
    additions: 1,
    deletions: 0,
    hunks: [],
  });
  function Changes() {
    const changeFlash = useChangePulses("t1", store);
    const [collapsed, setCollapsed] = useState(() => new Set<string>());
    return (
      <DiffFileTree
        files={[diff("src/a.ts"), diff("src/b.ts")]}
        selectedFile={null}
        onSelectFile={() => {}}
        totalAdditions={2}
        totalDeletions={0}
        collapsedPaths={collapsed}
        onCollapsedPathsChange={setCollapsed}
        changeFlash={changeFlash}
      />
    );
  }
  render(<Changes />);
  clock.advance(5);
  act(() => store.record("t1", ["src/b.ts"]));
  expect(flashOf(screen.getByTitle("src/b.ts"))).toBeDefined();
  expect(flashOf(screen.getByTitle("src/a.ts"))).toBeUndefined();
});

// ── lines of an open file ───────────────────────────────────────────────────

function fileContent(lines: string[]): FileContentResponse {
  return {
    isBinary: false,
    isImage: false,
    lines: lines.map((content, i) => ({ lineNum: i + 1, content })),
    totalLines: lines.length,
  };
}

const flashedLines = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("[data-line]"))
    .filter((row) => flashOf(row))
    .map((row) => Number(row.getAttribute("data-line")));

function Source({ lines, highlight = true }: { lines: FileContentResponse; highlight?: boolean }) {
  return (
    <FileContent
      filePath="src/a.ts"
      root={taskRoot("t1")}
      content={lines}
      loading={false}
      lineWrap={false}
      highlightChanges={highlight}
    />
  );
}

test("a rewrite of an open file flashes the lines it brought in", () => {
  const { container, rerender } = render(<Source lines={fileContent(["a", "b", "c"])} />);
  expect(flashedLines(container)).toEqual([]);
  rerender(<Source lines={fileContent(["a", "B", "c", "d"])} />);
  expect(flashedLines(container)).toEqual([2, 4]);
});

test("the same content refetched flashes nothing, and nor does a remount", () => {
  const { container, rerender, unmount } = render(<Source lines={fileContent(["a", "b"])} />);
  rerender(<Source lines={fileContent(["a", "b"])} />);
  expect(flashedLines(container)).toEqual([]);
  unmount();
  const again = render(<Source lines={fileContent(["a", "X"])} />);
  expect(flashedLines(again.container)).toEqual([]);
});

test("a second rewrite restarts the fade on a line that is still fading", () => {
  const { container, rerender } = render(<Source lines={fileContent(["a", "b"])} />);
  rerender(<Source lines={fileContent(["a", "b2"])} />);
  const row = () => container.querySelector('[data-line="2"]')!;
  const first = flashOf(row());
  rerender(<Source lines={fileContent(["a", "b3"])} />);
  expect(first).toBeDefined();
  expect(flashOf(row())).toBeDefined();
  expect(flashOf(row())).not.toBe(first);
});

test("a commit's file never flashes", () => {
  const { container, rerender } = render(<Source lines={fileContent(["a"])} highlight={false} />);
  rerender(<Source lines={fileContent(["b"])} highlight={false} />);
  expect(flashedLines(container)).toEqual([]);
});

// ── lines of a diff ─────────────────────────────────────────────────────────

function diffOf(added: string[]): FileDiff {
  return {
    oldPath: "src/a.ts",
    newPath: "src/a.ts",
    status: "modified",
    additions: added.length,
    deletions: 0,
    hunks: [
      {
        header: "@@",
        oldStart: 1,
        oldCount: 1,
        newStart: 1,
        newCount: 1 + added.length,
        lines: [
          { type: "hunk-header", content: "" },
          { type: "context", content: "keep", oldLineNum: 1, newLineNum: 1 },
          ...added.map((content, i) => ({ type: "addition" as const, content, newLineNum: i + 2 })),
        ],
      },
    ],
  };
}

test("a diff that grows flashes the new lines and not the ones already there", () => {
  const { container, rerender } = render(<DiffFile file={diffOf(["one"])} isExpanded highlightChanges />);
  expect(container.querySelectorAll("tr.change-flash-a, tr.change-flash-b")).toHaveLength(0);
  rerender(<DiffFile file={diffOf(["one", "two"])} isExpanded highlightChanges />);
  const lit = Array.from(container.querySelectorAll("tr")).filter((tr) => flashOf(tr));
  expect(lit.map((tr) => tr.textContent?.trim())).toEqual(["3+two"]);
});

// An edit further down opens a hunk of its own, and its context lines come
// into the diff with it. Nobody wrote those: only the addition lights.
test("a new hunk flashes its written lines, not the context it brings", () => {
  const second: FileDiff["hunks"][number] = {
    header: "@@",
    oldStart: 40,
    oldCount: 2,
    newStart: 41,
    newCount: 3,
    lines: [
      { type: "hunk-header", content: "" },
      { type: "context", content: "above", oldLineNum: 40, newLineNum: 41 },
      { type: "addition", content: "written", newLineNum: 42 },
      { type: "context", content: "below", oldLineNum: 41, newLineNum: 43 },
    ],
  };
  const before = diffOf(["one"]);
  const after = { ...before, hunks: [...before.hunks, second] };
  const { container, rerender } = render(<DiffFile file={before} isExpanded highlightChanges />);
  rerender(<DiffFile file={after} isExpanded highlightChanges />);
  const lit = Array.from(container.querySelectorAll("tr")).filter((tr) => flashOf(tr));
  expect(lit.map((tr) => tr.textContent?.trim())).toEqual(["42+written"]);
});
