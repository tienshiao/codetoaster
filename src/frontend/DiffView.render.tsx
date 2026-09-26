import { test, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { projectRoot, taskRoot } from "./repo-root";

/**
 * The review's confirmation says where the review is going (TASK-106): a
 * task's diff sends it to the agent's terminal, a diff opened at the composer
 * appends it to the prompt being written. Vitest's, since it is a dialog.
 *
 * Everything but the dialog is stubbed: one file in the diff, one comment in
 * the review, and a layout reduced to the toolbar slot the Submit button sits
 * in.
 */

const stubs = vi.hoisted(() => ({ onSubmit: vi.fn(() => true), clearComments: vi.fn() }));

vi.mock("./hooks/use-task-diff", () => ({
  useTaskDiff: () => ({
    data: [{ newPath: "a.ts", oldPath: "a.ts", hunks: [] }],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock("./hooks/use-comments", () => ({
  useComments: () => ({
    comments: new Map([["a.ts:1:addition", { id: "c1" }]]),
    fileCommentCounts: new Map(),
    pruneComments: () => 0,
    clearComments: stubs.clearComments,
  }),
}));
vi.mock("./hooks/use-hunk-expansions", () => ({
  useHunkExpansions: () => ({ hunkExpansions: new Map(), expandContext: vi.fn() }),
}));
vi.mock("./hooks/use-symbol-highlight", () => ({ useSymbolHighlight: () => ({}) }));
vi.mock("./utils/tips", () => ({ maybeShowSymbolTip: vi.fn() }));
vi.mock("./utils/generatePrompt", () => ({ generatePrompt: () => "THE REVIEW" }));
vi.mock("./components/SymbolPopover", () => ({ SymbolPopover: () => null }));
vi.mock("./components/diff/DiffLayout", () => ({
  DiffLayout: ({ toolbarExtra }: { toolbarExtra?: ReactNode }) => <div>{toolbarExtra}</div>,
}));

const { DiffView } = await import("./DiffView");

function openConfirmation(destination?: "terminal" | "prompt") {
  render(
    <DiffView
      root={destination === "prompt" ? projectRoot("web") : taskRoot("t1")}
      onSubmit={stubs.onSubmit}
      onOpenFile={vi.fn()}
      destination={destination}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Submit Review/ }));
}

test("a task's review is sent to the terminal, and says so", () => {
  openConfirmation();
  expect(screen.getByText("Send review to terminal?")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Send to Terminal" })).toBeTruthy();
});

test("at the composer the review is added to the prompt, and says so", () => {
  openConfirmation("prompt");
  expect(screen.getByText("Add review to prompt?")).toBeTruthy();
  expect(
    screen.getByText("The following will be appended to the prompt you are writing."),
  ).toBeTruthy();
  expect(screen.queryByText(/terminal/i)).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Add to prompt" }));
  expect(stubs.onSubmit).toHaveBeenCalledWith("THE REVIEW");
});
