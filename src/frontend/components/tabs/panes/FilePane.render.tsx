import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { taskRoot } from "@/frontend/repo-root";
import { viewRef } from "@/frontend/view-state-store";
import type { FileContentResponse, FilesResponse } from "@/frontend/types/file";
import { FilePane } from "./FilePane";

/**
 * A file tab's side of preview links (TASK-122/124/125): turning an `href` or
 * a `src` into something to open or load. The preview's own half — what is
 * clickable, what scrolls — is `MarkdownPreview.render.tsx`'s.
 */

const PAGES: Record<string, string[]> = {
  "wiki/services/archive.md": [
    "# Archive",
    "[cell setup](cell.md#setup) [retention here](archive.md#retention) [line](/src/a.ts#L3)",
    "![diagram](/img/flow.png)",
    "## Retention",
  ],
};

const stubs = vi.hoisted(() => ({ fetchFiles: vi.fn() }));

vi.mock("@/frontend/hooks/use-task-files", () => ({
  useFileContent: (_root: unknown, path: string): { data: FileContentResponse; isLoading: boolean } => {
    const lines = PAGES[path] ?? [];
    return {
      data: {
        isBinary: false,
        isImage: false,
        lines: lines.map((content, i) => ({ lineNum: i + 1, content })),
        totalLines: lines.length,
      },
      isLoading: false,
    };
  },
  fetchTaskFiles: stubs.fetchFiles,
  revealFile: vi.fn(),
}));
vi.mock("@/frontend/hooks/use-task-diff", () => ({ useChangedPaths: () => undefined }));
vi.mock("@/frontend/components/SymbolPopover", () => ({ SymbolPopover: () => null }));

const FILES: FilesResponse = {
  directory: "/repo",
  files: [
    "README.md",
    "wiki/index.md",
    "wiki/img/flow.png",
    "wiki/services/archive.md",
    "wiki/services/cell.md",
    "src/a.ts",
  ].map((path) => ({ path, name: path.split("/").pop()!, isDirectory: false, depth: 0 })),
} as FilesResponse;

const scrolled: Element[] = [];
const originalScrollIntoView = Element.prototype.scrollIntoView;
beforeEach(() => {
  scrolled.length = 0;
  stubs.fetchFiles.mockReset().mockResolvedValue(FILES);
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this);
  };
});
afterEach(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

function renderPane(props: { anchor?: string; onOpenFile?: () => void } = {}) {
  const onOpenFile = props.onOpenFile ?? vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
  );
  const view = viewRef("t1", `file:${Math.random()}`);
  const result = render(
    <FilePane
      root={taskRoot("t1")}
      view={view}
      path="wiki/services/archive.md"
      anchor={props.anchor}
      onOpenFile={onOpenFile}
      onOpenDiff={vi.fn()}
    />,
    { wrapper },
  );
  return { ...result, onOpenFile, view, wrapper };
}

test("a link to another page's heading opens that page with the anchor", async () => {
  const { onOpenFile } = renderPane();
  fireEvent.click(screen.getByRole("link", { name: "cell setup" }));
  await waitFor(() => expect(onOpenFile).toHaveBeenCalledWith("wiki/services/cell.md", undefined, "setup"));
});

test("a #L link still opens at the line, with no anchor", async () => {
  const { onOpenFile } = renderPane();
  fireEvent.click(screen.getByRole("link", { name: "line" }));
  await waitFor(() => expect(onOpenFile).toHaveBeenCalledWith("src/a.ts", 3, undefined));
});

test("a link to this page's own heading scrolls here, every time it is clicked", async () => {
  const { onOpenFile, container } = renderPane();
  const heading = container.querySelector("#user-content-retention");
  const link = screen.getByRole("link", { name: "retention here" });

  // A bare-fragment link scrolls in the preview itself; this one names the
  // file too, so it goes through the pane — and must not reopen the tab.
  fireEvent.click(link);
  await waitFor(() => expect(scrolled).toEqual([heading]));
  fireEvent.click(link);
  await waitFor(() => expect(scrolled).toEqual([heading, heading]));
  expect(onOpenFile).not.toHaveBeenCalled();
});

test("opened with an anchor, the preview lands on that heading", () => {
  const { container } = renderPane({ anchor: "retention" });
  expect(scrolled).toEqual([container.querySelector("#user-content-retention")]);
});

test("a new anchor on the open tab scrolls to it", () => {
  const onOpenFile = vi.fn();
  const { container, rerender, view } = renderPane({ onOpenFile });
  expect(scrolled).toEqual([]);
  rerender(
    <FilePane
      root={taskRoot("t1")}
      view={view}
      path="wiki/services/archive.md"
      anchor="archive"
      onOpenFile={onOpenFile}
      onOpenDiff={vi.fn()}
    />,
  );
  expect(scrolled).toEqual([container.querySelector("#user-content-archive")]);
});

test("a / image resolves against the wiki's root and loads from the image endpoint", async () => {
  renderPane();
  const image = screen.getByAltText("diagram");
  await waitFor(() =>
    expect(image.getAttribute("src")).toBe(`/api/tasks/t1/image?file=${encodeURIComponent("wiki/img/flow.png")}`),
  );
});
