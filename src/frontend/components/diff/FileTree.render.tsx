import { test, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FileTree } from "./FileTree";
import type { FileDiff } from "../../types/diff";

/**
 * Which rows of the changed-files tree answer a right-click (TASK-131). The
 * Explorer hangs Show in Finder off it, so the rule is "what is on disk": a
 * file the diff deletes is not, and a directory here is only a grouping of
 * changed paths, which may itself be gone.
 */

function fileDiff(path: string, status: FileDiff["status"] = "modified"): FileDiff {
  return { oldPath: path, newPath: path, status, additions: 1, deletions: 0, hunks: [] };
}

function mount(onRowContextMenu?: (event: unknown, path: string) => void) {
  return render(
    <FileTree
      files={[fileDiff("src/a.ts"), fileDiff("src/gone.ts", "deleted")]}
      selectedFile={null}
      onSelectFile={() => {}}
      totalAdditions={2}
      totalDeletions={0}
      collapsedPaths={new Set()}
      onCollapsedPathsChange={() => {}}
      onRowContextMenu={onRowContextMenu}
    />,
  );
}

test("a right-click on a changed file is reported with its path", () => {
  const onRowContextMenu = vi.fn();
  mount(onRowContextMenu);
  fireEvent.contextMenu(screen.getByText("a.ts"));
  expect(onRowContextMenu.mock.calls.map(([, path]) => path)).toEqual(["src/a.ts"]);
});

test("a deleted file and a directory are left to the browser", () => {
  const onRowContextMenu = vi.fn();
  mount(onRowContextMenu);
  fireEvent.contextMenu(screen.getByText("gone.ts"));
  fireEvent.contextMenu(screen.getByText("src"));
  expect(onRowContextMenu).not.toHaveBeenCalled();
});
