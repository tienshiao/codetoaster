import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { taskRoot } from "@/frontend/repo-root";
import { viewRef, type ViewRef } from "@/frontend/view-state-store";
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

type OpenFile = (path: string, line?: number, anchor?: string) => void;

interface PaneProps {
  anchor?: string;
  anchorAt?: number;
  view?: ViewRef;
}

function renderPane(props: PaneProps = {}) {
  const onOpenFile = vi.fn<OpenFile>();
  const view = props.view ?? viewRef("t1", `file:${Math.random()}`);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
  );
  const pane = (p: PaneProps) => (
    <FilePane
      root={taskRoot("t1")}
      view={view}
      path="wiki/services/archive.md"
      anchor={p.anchor}
      anchorAt={p.anchorAt}
      onOpenFile={onOpenFile}
      onOpenDiff={vi.fn()}
    />
  );
  const result = render(pane(props), { wrapper });
  return { ...result, onOpenFile, view, rerenderWith: (p: PaneProps) => result.rerender(pane(p)) };
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

test("a link to this page's own heading is a request like any other", async () => {
  // A bare-fragment link scrolls in the preview itself; this one names the
  // file too, so it goes through the tab, where `anchorAt` makes a repeat a
  // new request.
  const { onOpenFile } = renderPane();
  fireEvent.click(screen.getByRole("link", { name: "retention here" }));
  await waitFor(() =>
    expect(onOpenFile).toHaveBeenCalledWith("wiki/services/archive.md", undefined, "retention"),
  );
});

test("opened with an anchor, the preview lands on that heading", () => {
  const { container } = renderPane({ anchor: "retention", anchorAt: 100 });
  expect(scrolled).toEqual([container.querySelector("#user-content-retention")]);
});

test("a request is served once: coming back to the tab keeps the user's place", () => {
  // The pane unmounts whenever its tab is not the active one, and the
  // descriptor keeps its anchor — a remount must not jump again.
  const first = renderPane({ anchor: "retention", anchorAt: 100 });
  expect(scrolled).toHaveLength(1);
  first.unmount();

  renderPane({ anchor: "retention", anchorAt: 100, view: first.view });
  expect(scrolled).toHaveLength(1);
});

test("the same heading asked for again is a new request and scrolls again", () => {
  const { container, rerenderWith } = renderPane({ anchor: "retention", anchorAt: 100 });
  const heading = container.querySelector("#user-content-retention");
  rerenderWith({ anchor: "retention", anchorAt: 100 });
  expect(scrolled).toEqual([heading]);
  rerenderWith({ anchor: "retention", anchorAt: 200 });
  expect(scrolled).toEqual([heading, heading]);
});

test("an anchor with no request stamp does not scroll", () => {
  renderPane({ anchor: "retention" });
  expect(scrolled).toEqual([]);
});

test("only the latest of two quick clicks opens anything", async () => {
  let release!: (files: FilesResponse) => void;
  stubs.fetchFiles.mockReset().mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
  stubs.fetchFiles.mockResolvedValue(FILES);
  const { onOpenFile } = renderPane();

  fireEvent.click(screen.getByRole("link", { name: "cell setup" })); // slow
  fireEvent.click(screen.getByRole("link", { name: "line" })); // fast
  await waitFor(() => expect(onOpenFile).toHaveBeenCalledWith("src/a.ts", 3, undefined));
  release(FILES);
  await new Promise((r) => setTimeout(r, 0));
  expect(onOpenFile).toHaveBeenCalledTimes(1);
});

test("a click whose listing arrives after the tab closed opens nothing", async () => {
  let release!: (files: FilesResponse) => void;
  stubs.fetchFiles.mockReset().mockImplementation(() => new Promise((resolve) => (release = resolve)));
  const { onOpenFile, unmount } = renderPane();
  fireEvent.click(screen.getByRole("link", { name: "cell setup" }));
  unmount();
  release(FILES);
  await new Promise((r) => setTimeout(r, 0));
  expect(onOpenFile).not.toHaveBeenCalled();
});

test("a / image resolves against the wiki's root and loads from the image endpoint", async () => {
  renderPane();
  const image = screen.getByAltText("diagram");
  await waitFor(() =>
    expect(image.getAttribute("src")).toBe(`/api/tasks/t1/image?file=${encodeURIComponent("wiki/img/flow.png")}`),
  );
});
