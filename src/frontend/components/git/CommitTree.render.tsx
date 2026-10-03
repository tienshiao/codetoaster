import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { taskRoot } from "@/frontend/repo-root";
import { getViewState, resetViewStates, viewRef, type ViewRef } from "@/frontend/view-state-store";
import type { FileContentResponse, FilesResponse } from "@/frontend/types/file";
import type { SymbolEntry } from "@/lib/symbols/types";
import { CommitTree } from "./CommitTree";

/**
 * A commit's File Tree reads a file the way a file tab does (TASK-127), with
 * everything scoped to the commit. What the viewer itself does with a link or
 * a heading is `FilePane.render.tsx`'s; this is the tree's side — where the
 * list, the images and the symbols come from, and where an opened file goes.
 */

const SHA = "a".repeat(40);
const TASK = "t-commit-tree";

const PAGES: Record<string, string[]> = {
  "README.md": ["# Readme"],
  "docs/guide.md": [
    "# Guide",
    "[setup](setup.md#install) [source](/src/a.ts#L2) [gone](removed.md) [root](/README.md)",
    "![diagram](img/flow.png)",
  ],
  "docs/setup.md": ["# Setup", "", "## Install", "", "Run it."],
  "docs/totals.csv": ["name,count", "alpha,1"],
  "src/a.ts": ["export function helper() {", "  return 1;", "}"],
};

const stubs = vi.hoisted(() => ({
  toastError: vi.fn(),
  popover: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: stubs.toastError }) }));
vi.mock("@/frontend/components/SymbolPopover", () => ({
  SymbolPopover: (props: { sha?: string; onGo: (entry: SymbolEntry) => void }) => {
    stubs.popover(props);
    return null;
  },
}));
vi.mock("@/frontend/hooks/use-git-tree", () => ({
  useGitTree: (): { data: FilesResponse; isLoading: boolean; error: null } => ({
    data: {
      directory: "/repo",
      files: [...Object.keys(PAGES), "docs/img/flow.png"].map((path) => ({
        path,
        name: path.split("/").pop()!,
        isDirectory: false,
        depth: path.split("/").length - 1,
      })),
    } as FilesResponse,
    isLoading: false,
    error: null,
  }),
  useGitFile: (_root: unknown, _sha: string, path: string | null) => {
    const lines = path ? (PAGES[path] ?? []) : [];
    const data: FileContentResponse | undefined = path
      ? {
          isBinary: false,
          isImage: false,
          lines: lines.map((content, i) => ({ lineNum: i + 1, content })),
          totalLines: lines.length,
        }
      : undefined;
    return { data, isLoading: false, error: null };
  },
}));

const scrolled: Element[] = [];
const originalScrollIntoView = Element.prototype.scrollIntoView;
beforeEach(() => {
  scrolled.length = 0;
  stubs.toastError.mockReset();
  stubs.popover.mockReset();
  resetViewStates(TASK);
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this);
  };
});
afterEach(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

function renderTree(file: string | null, view: ViewRef = viewRef(TASK, `commit:${SHA}`)) {
  const onSelectFile = vi.fn<(path: string | null) => void>();
  // The pane above owns the selection; this stands in for it, so a link's
  // target is actually shown.
  function Harness() {
    const [selected, setSelected] = useState(file);
    return (
      <CommitTree
        root={taskRoot(TASK)}
        view={view}
        sha={SHA}
        file={selected ?? undefined}
        onSelectFile={(path) => {
          onSelectFile(path);
          setSelected(path);
        }}
      />
    );
  }
  const result = render(
    <QueryClientProvider client={new QueryClient()}>
      <Harness />
    </QueryClientProvider>,
  );
  return { ...result, onSelectFile, view };
}

test("a markdown file is rendered, and the Preview toggle turns it back into source", () => {
  renderTree("docs/setup.md");
  expect(screen.getByRole("heading", { name: "Install" })).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  expect(screen.queryByRole("heading", { name: "Install" })).toBeNull();
  expect(screen.getByText("## Install")).toBeTruthy();
  // Task-wide, like the wrap beside it: the next commit opens the same way.
  expect(getViewState("prefs", viewRef(TASK, "prefs")).treePreview).toBe(false);
});

test("a CSV is a table under the same toggle; a source file has no toggle", () => {
  const csv = renderTree("docs/totals.csv");
  expect(screen.getByRole("table")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Preview" })).toBeTruthy();
  csv.unmount();

  renderTree("src/a.ts");
  expect(screen.queryByRole("button", { name: "Preview" })).toBeNull();
  expect(screen.getByRole("button", { name: "Wrap" })).toBeTruthy();
});

test("a link selects the linked file in this tree and lands on its heading", async () => {
  const { onSelectFile, view, container } = renderTree("docs/guide.md");
  fireEvent.click(screen.getByRole("link", { name: "setup" }));
  await waitFor(() => expect(onSelectFile).toHaveBeenCalledWith("docs/setup.md"));
  expect(getViewState("commit", view).treeTarget).toMatchObject({ path: "docs/setup.md", anchor: "install" });
  await waitFor(() => expect(scrolled).toContain(container.querySelector("#user-content-install")));
});

test("a #L link selects the file at that line", async () => {
  const { onSelectFile, container } = renderTree("docs/guide.md");
  fireEvent.click(screen.getByRole("link", { name: "source" }));
  await waitFor(() => expect(onSelectFile).toHaveBeenCalledWith("src/a.ts"));
  await waitFor(() => expect(scrolled).toContain(container.querySelector('[data-line="2"]')));
});

test("a link to a file the commit does not have says so and selects nothing", async () => {
  const { onSelectFile } = renderTree("docs/guide.md");
  fireEvent.click(screen.getByRole("link", { name: "gone" }));
  await waitFor(() =>
    expect(stubs.toastError).toHaveBeenCalledWith("That file is not in this commit", {
      description: "docs/removed.md",
    }),
  );
  expect(onSelectFile).not.toHaveBeenCalled();
});

test("links keep their raw href: a commit's file has no URL of its own", () => {
  renderTree("docs/guide.md");
  const link = screen.getByRole("link", { name: "setup" });
  expect(link.getAttribute("href")).toBe("setup.md#install");
  // And so a modified click is kept from the browser, which would 404.
  expect(fireEvent.click(link, { metaKey: true })).toBe(false);
});

test("an image loads the blob from the commit", async () => {
  renderTree("docs/guide.md");
  const image = screen.getByAltText("diagram");
  await waitFor(() =>
    expect(image.getAttribute("src")).toBe(
      `/api/tasks/${TASK}/image/git?ref=${SHA}&file=${encodeURIComponent("docs/img/flow.png")}`,
    ),
  );
});

test("symbols are looked up in the commit, and a chosen one is selected at its line", async () => {
  const { onSelectFile, container } = renderTree("docs/guide.md");
  const props = stubs.popover.mock.lastCall![0];
  expect(props.sha).toBe(SHA);

  props.onGo({ name: "helper", path: "src/a.ts", line: 1, kind: "definition", symbolKind: "function", context: "" });
  await waitFor(() => expect(onSelectFile).toHaveBeenCalledWith("src/a.ts"));
  await waitFor(() => expect(scrolled).toContain(container.querySelector('[data-line="1"]')));
});

test("a file picked from the tree opens where it was left, not where a link sent it", async () => {
  const { view } = renderTree("docs/guide.md");
  fireEvent.click(screen.getByRole("link", { name: "root" }));
  await waitFor(() => expect(getViewState("commit", view).treeTarget?.path).toBe("README.md"));

  fireEvent.click(screen.getByTitle("README.md"));
  expect(getViewState("commit", view).treeTarget).toBeNull();
});

test("scroll offsets are kept per file and mode in the commit's slot", () => {
  const view = viewRef(TASK, `commit:${SHA}`);
  getViewState("commit", view).treeScrollTops.set("md-preview:docs/setup.md", 140);
  const { container } = renderTree("docs/setup.md", view);
  const scroller = container.querySelector(".markdown-preview")!.closest(".overflow-auto")!;
  expect(scroller.scrollTop).toBe(140);

  fireEvent.scroll(scroller, { target: { scrollTop: 60 } });
  expect(getViewState("commit", view).treeScrollTops.get("md-preview:docs/setup.md")).toBe(60);
});

test("a line is landed on once: coming back keeps the reader's place", () => {
  // The viewer remounts on every mode switch, tab switch and reload, and the
  // target outlives all of them.
  const view = viewRef(TASK, `commit:${SHA}`);
  getViewState("commit", view).treeTarget = { path: "src/a.ts", line: 2, at: 5 };
  const first = renderTree("src/a.ts", view);
  const row = () => document.querySelector('[data-line="2"]');
  expect(scrolled).toContain(row());

  fireEvent.scroll(row()!.closest(".overflow-auto")!, { target: { scrollTop: 90 } });
  first.unmount();
  scrolled.length = 0;

  renderTree("src/a.ts", view);
  expect(scrolled).toEqual([]);
  expect(row()!.closest(".overflow-auto")!.scrollTop).toBe(90);
});

test("a selection the commit does not have is cleared", async () => {
  const { onSelectFile } = renderTree("docs/elsewhere.md");
  await waitFor(() => expect(onSelectFile).toHaveBeenCalledWith(null));
  expect(screen.getByText("No file selected")).toBeTruthy();
});
