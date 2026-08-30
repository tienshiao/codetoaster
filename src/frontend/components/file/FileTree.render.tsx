import { useCallback, useReducer, type SetStateAction } from "react";
import { test, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FileTree } from "./FileTree";
import type { FileInfo } from "../../types/file";

/**
 * The one behaviour of the file tree that only exists across a mount boundary:
 * whether a collapse the user made survives the Explorer unmounting the section
 * and mounting it again on the next rail switch.
 *
 * The sorting, the prefix collection and the set helpers are pure and tested as
 * functions elsewhere; what needs a DOM is the reveal *effect*, which is a
 * lifecycle question — see CLAUDE.md, "Testing".
 */

const FILE = "src/frontend/AppShell.tsx";

const FILES: FileInfo[] = [
  { path: "src", name: "src", isDirectory: true, depth: 0 },
  { path: "src/frontend", name: "frontend", isDirectory: true, depth: 1 },
  { path: FILE, name: "AppShell.tsx", isDirectory: false, depth: 2, size: 100 },
];

/**
 * A tree whose expansion set outlives its mount, which is the shape the
 * Explorer gives it: `FilesSection` keeps both the selection and the expanded
 * paths in the view-state store, and unmounts the section itself on every rail
 * switch.
 */
function hostTree() {
  let expandedPaths = new Set<string>();

  return function Section({ mounted, selected }: { mounted: boolean; selected: string | null }) {
    const [, bump] = useReducer((n: number) => n + 1, 0);
    // Stable, and a no-op when the set comes back unchanged — the way
    // `useViewState` behaves. An identity that changed per render would re-run
    // the tree's prune effect forever.
    const onExpandedPathsChange = useCallback((action: SetStateAction<Set<string>>) => {
      const next = typeof action === "function" ? action(expandedPaths) : action;
      if (next === expandedPaths) return;
      expandedPaths = next;
      bump();
    }, []);

    if (!mounted) return null;
    return (
      <FileTree
        files={FILES}
        selectedFile={selected}
        onSelectFile={() => {}}
        expandedPaths={expandedPaths}
        onExpandedPathsChange={onExpandedPathsChange}
      />
    );
  };
}

test("a selection arriving from elsewhere reveals the directories holding it", () => {
  const Section = hostTree();
  const view = render(<Section mounted selected={null} />);
  expect(screen.queryByText("frontend")).toBeNull();

  view.rerender(<Section mounted selected={FILE} />);
  screen.getByText("AppShell.tsx");
});

test("a collapse survives the section being unmounted and mounted again", () => {
  const Section = hostTree();
  const view = render(<Section mounted selected={null} />);

  fireEvent.click(screen.getByText("src"));
  fireEvent.click(screen.getByText("frontend"));
  fireEvent.click(screen.getByText("AppShell.tsx"));
  view.rerender(<Section mounted selected={FILE} />);

  fireEvent.click(screen.getByText("src"));
  expect(screen.queryByText("frontend")).toBeNull();

  // The rail switched away and back. The selection is still in the store, so a
  // reveal that ran on mount would undo the collapse — and would do it again on
  // every switch, which is what makes it impossible to live with.
  view.rerender(<Section mounted={false} selected={FILE} />);
  view.rerender(<Section mounted selected={FILE} />);
  expect(screen.queryByText("frontend")).toBeNull();
});
