import { useState } from "react";
import { test, expect } from "vitest";
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
function Pane({ mode }: { mode: "all" | "single" }) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const [treeCollapsedPaths, setTreeCollapsedPaths] = useState<Set<string>>(new Set());
  return (
    <DiffLayout
      files={FILES}
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
