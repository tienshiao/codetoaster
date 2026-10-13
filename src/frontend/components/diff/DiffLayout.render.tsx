import { useState } from "react";
import { test, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DiffLayout } from "./DiffLayout";
import type { FileDiff } from "../../types/diff";

/**
 * Who the single-file arrow keys belong to when two panes are on screen at
 * once — the split `TabArea` draws, which is the only way to get two of these
 * mounted together.
 *
 * A rendering test because the claim is made and released by effects, and the
 * listener is on `window`: there is no function to call that would answer it.
 */

function fileDiff(path: string): FileDiff {
  return {
    oldPath: path,
    newPath: path,
    status: "modified",
    additions: 1,
    deletions: 0,
    hunks: [
      {
        header: `@@ -1 +1,2 @@`,
        oldStart: 1,
        oldCount: 1,
        newStart: 1,
        newCount: 2,
        lines: [{ type: "addition", content: path, newLineNum: 2 }],
      },
    ],
  };
}

const FILES = ["a.ts", "b.ts", "c.ts"].map(fileDiff);

/** One pane, with the persistence-backed props the real consumers inject held
 * in local state. The tree is off: this is about the keys, and a pane's own
 * "n of N" counter already says which file it is showing. */
function Pane({
  mode,
  files = FILES,
  onRevealFile,
}: {
  mode: "all" | "single";
  files?: FileDiff[];
  onRevealFile?: (path: string) => void;
}) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const [treeCollapsedPaths, setTreeCollapsedPaths] = useState<Set<string>>(new Set());
  return (
    <DiffLayout
      files={files}
      onRevealFile={onRevealFile}
      viewModeOverride={mode}
      onViewModeOverride={() => {}}
      selectedFile={selectedFile}
      onSelectedFileChange={setSelectedFile}
      collapsedFiles={collapsedFiles}
      onCollapsedFilesChange={setCollapsedFiles}
      treeCollapsedPaths={treeCollapsedPaths}
      onTreeCollapsedPathsChange={setTreeCollapsedPaths}
      showFileTree={false}
      showViewModeToggle={false}
    />
  );
}

/** The split: the "all" pane mounts first, exactly as it does when a small
 * commit's Changes tab is opened before the working-tree diff is split out
 * beside it. */
function split(): { allPane: HTMLElement } {
  const view = render(
    <div>
      <div data-testid="all">
        <Pane mode="all" />
      </div>
      <div data-testid="single">
        <Pane mode="single" />
      </div>
    </div>,
  );
  return { allPane: view.getByTestId("all") };
}

/** Which file the single-file pane is on, read off its own counter. */
const showing = (): string | null => screen.getByText(/of 3$/).textContent;

test("a pane showing every file does not hold the arrow keys", () => {
  split();
  expect(showing()).toBe("1 of 3");

  // Claimed on mount order alone, the keys would sit with the "all" pane, which
  // installs no listener — and the single-file pane would be dead until the
  // user thought to click inside it.
  fireEvent.keyDown(window, { key: "ArrowRight" });
  expect(showing()).toBe("2 of 3");
});

test("pointing at a pane that is not listening does not take the keys away", () => {
  const { allPane } = split();
  fireEvent.pointerDown(allPane);

  fireEvent.keyDown(window, { key: "ArrowRight" });
  expect(showing()).toBe("2 of 3");
});

test("navigating does not release the keys the pane is holding", () => {
  split();
  // The listener's effect re-runs on every navigation (its callbacks close over
  // the selection). If the claim rode along with it, the second press would
  // find the keys handed elsewhere.
  fireEvent.keyDown(window, { key: "ArrowRight" });
  fireEvent.keyDown(window, { key: "ArrowRight" });
  expect(showing()).toBe("3 of 3");
});

/**
 * The other thing the two modes disagree on: whether a file's header collapses
 * it. Here rather than in a file of its own because it needs the same pane.
 */
test("a file header collapses its file among others, and offers nothing when it is the only one shown", () => {
  // The path is both the header's label and the fixture's one line; the header
  // comes first.
  const header = (view: ReturnType<typeof render>) => view.getAllByText("a.ts")[0]!;
  const tables = (view: ReturnType<typeof render>) => view.container.querySelectorAll("table");
  const chevron = ".lucide-chevron-down";

  const all = render(<Pane mode="all" />);
  expect(all.container.querySelector(chevron)).not.toBeNull();
  expect(tables(all)).toHaveLength(3);
  fireEvent.click(header(all));
  expect(tables(all)).toHaveLength(2);
  all.unmount();

  // In single-file mode the file is the whole view. A chevron there promised a
  // collapse that never came, while the click quietly collapsed the file in
  // "all" mode — which is only visible on the way back.
  const single = render(<Pane mode="single" />);
  expect(single.container.querySelector(chevron)).toBeNull();
  fireEvent.click(header(single));
  expect(tables(single)).toHaveLength(1);
  single.rerender(<Pane mode="all" />);
  expect(tables(single)).toHaveLength(3);
});

/** Show in Finder on a file header (TASK-131). */
test("a file header shows its file in Finder without collapsing it", () => {
  const onRevealFile = vi.fn();
  const view = render(<Pane mode="all" onRevealFile={onRevealFile} />);
  const buttons = screen.getAllByRole("button", { name: "Show in Finder" });
  expect(buttons).toHaveLength(3);

  fireEvent.click(buttons[1]!);
  expect(onRevealFile).toHaveBeenCalledWith("b.ts");
  // The header is itself a collapse toggle; the button must not be one too.
  expect(view.container.querySelectorAll("table")).toHaveLength(3);
});

test("a deleted file has nothing on disk to show, and a consumer that passes nothing gets no button", () => {
  const gone: FileDiff = { ...fileDiff("gone.ts"), status: "deleted" };
  const view = render(<Pane mode="all" files={[fileDiff("a.ts"), gone]} onRevealFile={vi.fn()} />);
  expect(screen.getAllByRole("button", { name: "Show in Finder" })).toHaveLength(1);
  view.unmount();

  // A commit's diff: the file as it was then is not a file on disk now.
  render(<Pane mode="all" />);
  expect(screen.queryByRole("button", { name: "Show in Finder" })).toBeNull();
});
