import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { taskRoot } from "@/frontend/repo-root";
import { getViewState, viewRef, type ViewRef } from "@/frontend/view-state-store";
import type { FileContentResponse, FilesResponse } from "@/frontend/types/file";
import { defaultParseSearch } from "@tanstack/react-router";
import { parseTabSearch } from "@/frontend/utils/tab-link";
import { FilePane } from "./FilePane";

/**
 * A file tab's side of preview links (TASK-122/124/125): turning an `href` or
 * a `src` into something to open or load. The preview's own half — what is
 * clickable, what scrolls — is `MarkdownPreview.render.tsx`'s.
 */

const PAGES: Record<string, string[]> = {
  "wiki/services/archive.md": [
    "# Archive",
    "[cell setup](cell.md#setup) [retention here](archive.md#retention) [line](/src/a.ts#L3) [below](#retention) [index](/index)",
    "![diagram](/img/flow.png)",
    "## Retention",
  ],
};

const stubs = vi.hoisted(() => ({
  fetchFiles: vi.fn(),
  /** What the cache holds for the listing — the pane only watches it. */
  cachedFiles: undefined as unknown,
}));

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
  useTaskFiles: (_root: unknown, options?: { enabled?: boolean }) => {
    // The pane must only watch the cache, never fetch through the hook.
    if (options?.enabled !== false) throw new Error("useTaskFiles must stay disabled in a file pane");
    return { data: stubs.cachedFiles };
  },
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
  stubs.cachedFiles = undefined;
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
  taskHref?: string;
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
      taskHref={p.taskHref}
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

test("a request for a heading that is not there keeps the saved place", () => {
  const view = viewRef("t1", `file:${Math.random()}`);
  getViewState("file", view).scrollTops.set("md-preview:wiki/services/archive.md", 120);
  const { container } = renderPane({ anchor: "nowhere", anchorAt: 100, view });
  const scroller = container.querySelector(".markdown-preview")!.closest(".overflow-auto")!;
  expect(scroller.scrollTop).toBe(120);
  expect(getViewState("file", view).jumpedAt).toBe(100);
});

test("a request that arrives while the tab shows source is spent, not saved for later", () => {
  const view = viewRef("t1", `file:${Math.random()}`);
  getViewState("file", view).markdownPreview = false;
  renderPane({ anchor: "retention", anchorAt: 100, view });
  expect(getViewState("file", view).jumpedAt).toBe(100);

  // Turning the preview on later does not jump.
  getViewState("file", view).markdownPreview = true;
  renderPane({ anchor: "retention", anchorAt: 100, view });
  expect(scrolled).toEqual([]);
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

/** Real URLs (TASK-126). */
const BASE = "/t/wiki-t1";
const tabSearch = (href: string | null) => parseTabSearch(defaultParseSearch(href!.slice(href!.indexOf("?"))));

test("in a task, a repository link carries the URL that opens its tab", () => {
  stubs.cachedFiles = FILES;
  renderPane({ taskHref: BASE });
  const href = screen.getByRole("link", { name: "cell setup" }).getAttribute("href");
  expect(href!.startsWith(`${BASE}?`)).toBe(true);
  expect(tabSearch(href)).toEqual({ tab: "file:wiki/services/cell.md", anchor: "setup" });
  expect(tabSearch(screen.getByRole("link", { name: "line" }).getAttribute("href"))).toEqual({
    tab: "file:src/a.ts",
    line: 3,
  });
});

test("a fragment link carries this file's URL with the heading", () => {
  renderPane({ taskHref: BASE });
  expect(tabSearch(screen.getByRole("link", { name: "below" }).getAttribute("href"))).toEqual({
    tab: "file:wiki/services/archive.md",
    anchor: "retention",
  });
});

test("the URL uses the cached listing once it is there, for an extensionless / link", () => {
  // No listing yet: the plain resolution, which misses the .md and the bundle.
  const { unmount } = renderPane({ taskHref: BASE });
  expect(tabSearch(screen.getByRole("link", { name: "index" }).getAttribute("href"))).toEqual({ tab: "file:index" });
  unmount();
  stubs.cachedFiles = FILES;
  renderPane({ taskHref: BASE });
  expect(tabSearch(screen.getByRole("link", { name: "index" }).getAttribute("href"))).toEqual({
    tab: "file:wiki/index.md",
  });
});

test("opening a task's preview asks for the listing up front; a project's does not", async () => {
  // The page's image asks for the listing either way (and the query client
  // would fold the two into one request); a task's preview adds the up-front ask.
  const project = renderPane();
  await waitFor(() => expect(stubs.fetchFiles).toHaveBeenCalled());
  const withoutTask = stubs.fetchFiles.mock.calls.length;
  project.unmount();
  stubs.fetchFiles.mockClear();

  renderPane({ taskHref: BASE });
  await waitFor(() => expect(stubs.fetchFiles.mock.calls.length).toBe(withoutTask + 1));
});

test("a modified or middle click is left to the browser; a plain click opens in place", async () => {
  const { onOpenFile } = renderPane({ taskHref: BASE });
  const link = screen.getByRole("link", { name: "cell setup" });
  // fireEvent returns false when the default was prevented.
  expect(fireEvent.click(link, { metaKey: true })).toBe(true);
  expect(fireEvent.click(link, { ctrlKey: true })).toBe(true);
  expect(fireEvent.click(link, { shiftKey: true })).toBe(true);
  expect(fireEvent(link, new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }))).toBe(true);
  expect(onOpenFile).not.toHaveBeenCalled();

  expect(fireEvent.click(link)).toBe(false);
  await waitFor(() => expect(onOpenFile).toHaveBeenCalledWith("wiki/services/cell.md", undefined, "setup"));
});

test("outside a task the link keeps its raw href, and a middle click stays blocked", () => {
  renderPane();
  const link = screen.getByRole("link", { name: "cell setup" });
  expect(link.getAttribute("href")).toBe("cell.md#setup");
  expect(fireEvent(link, new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }))).toBe(false);
  expect(fireEvent.click(link, { metaKey: true })).toBe(false);
});

test("a / image resolves against the wiki's root and loads from the image endpoint", async () => {
  renderPane();
  const image = screen.getByAltText("diagram");
  await waitFor(() =>
    expect(image.getAttribute("src")).toBe(`/api/tasks/t1/image?file=${encodeURIComponent("wiki/img/flow.png")}`),
  );
});
