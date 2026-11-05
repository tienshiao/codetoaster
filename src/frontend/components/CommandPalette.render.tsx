import { test, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createLayout, openTab } from "../layout-store";
import { projectRoot, taskRoot, type RepoRoot } from "../repo-root";
import { presentComposerTab } from "./tabs/tab-labels";

/**
 * The palette host at the composer (TASK-106): with a project root it
 * searches what the Explorer beside it browses, reads its tabs the way the
 * strip does, and offers nothing that needs a terminal.
 *
 * The rows themselves are `palette-items.test.ts`'s; what is pinned here is
 * the wiring — which root the queries are handed, and which projection the
 * tab rows are drawn through. The data hooks are stubbed to record the root
 * they were given.
 */

const calls = vi.hoisted(() => ({
  diff: [] as Array<{ root: RepoRoot | null; options: unknown }>,
  log: [] as Array<RepoRoot | null>,
  refs: [] as Array<RepoRoot | null>,
  files: [] as Array<RepoRoot | null>,
}));

// The archived list and the unarchive calls, which the TASK-139 test below
// fills in; empty for the rest of the file.
const unarchive = vi.hoisted(() => ({
  archivedTasks: [] as unknown[],
  loadArchivedTasks: vi.fn(async () => ({ ok: true, value: [] })),
  unarchivePreview: vi.fn(),
  unarchiveTask: vi.fn(),
  openTask: vi.fn(),
}));

vi.mock("@/frontend/TaskContext", () => ({
  useTasks: () => ({
    tasks: [],
    projects: [],
    closeTask: vi.fn(),
    resumeTask: vi.fn(),
    archivePreview: vi.fn(),
    archiveTask: vi.fn(),
    archivedTasks: unarchive.archivedTasks,
    loadArchivedTasks: unarchive.loadArchivedTasks,
    unarchivePreview: unarchive.unarchivePreview,
    unarchiveTask: unarchive.unarchiveTask,
  }),
  taskStateOf: () => "idle",
  taskDisplayNames: () => new Map(),
}));
vi.mock("@/frontend/hooks/use-task-nav", () => ({
  useOpenTask: () => unarchive.openTask,
  useOpenComposer: () => vi.fn(),
}));
vi.mock("@/frontend/components/TaskSidebar", () => ({
  ArchiveTaskDialog: () => null,
  CloseTaskDialog: () => null,
}));
vi.mock("@/frontend/hooks/use-task-diff", () => ({
  useTaskDiff: (root: RepoRoot | null, options: unknown) => {
    calls.diff.push({ root, options });
    return { data: [] };
  },
}));
vi.mock("@/frontend/hooks/use-git-log", () => ({
  useGitLog: (root: RepoRoot | null) => {
    calls.log.push(root);
    return { data: undefined };
  },
}));
vi.mock("@/frontend/hooks/use-git-refs", () => ({
  useGitRefs: (root: RepoRoot | null) => {
    calls.refs.push(root);
    return { data: undefined };
  },
}));
vi.mock("@/frontend/hooks/use-file-search", () => ({
  useFileSearch: (root: RepoRoot | null) => {
    calls.files.push(root);
    return { data: undefined, isFetching: false };
  },
}));

const { CommandPaletteHost } = await import("./CommandPalette");

beforeEach(() => {
  calls.diff = [];
  calls.log = [];
  calls.refs = [];
  calls.files = [];
  unarchive.archivedTasks.length = 0;
  unarchive.loadArchivedTasks.mockClear();
  unarchive.unarchivePreview.mockReset();
  unarchive.unarchiveTask.mockReset();
  unarchive.openTask.mockReset();
});

function mount(props: Partial<Parameters<typeof CommandPaletteHost>[0]>) {
  render(
    <CommandPaletteHost
      open
      onOpenChange={vi.fn()}
      taskId={null}
      root={null}
      layout={null}
      onLayoutChange={vi.fn()}
      onFocusTab={vi.fn()}
      onSearchTab={vi.fn()}
      onOpenTab={vi.fn()}
      runCommand={vi.fn()}
      onToggleSidebar={vi.fn()}
      onToggleExplorer={vi.fn()}
      {...props}
    />,
  );
}

test("at the composer the palette searches the project and reads its tabs as the strip does", () => {
  const root = projectRoot("web");
  mount({
    root,
    presentTab: presentComposerTab,
    layout: openTab(createLayout(), { kind: "file", path: "src/a.ts" }),
  });

  for (const seen of [calls.diff.map((c) => c.root), calls.log, calls.refs, calls.files]) {
    expect(seen.at(-1)).toBe(root);
  }
  // The palette reads only the diff's file list.
  expect(calls.diff.at(-1)!.options).toEqual({ tokens: false });

  // The composer's tab row, beside the "New task" action.
  expect(screen.getAllByText("New task")).toHaveLength(2);
  expect(screen.queryByText("Agent")).toBeNull();
  // Its front tab is the composer, which has no terminal to search.
  expect(screen.queryByText("Find in terminal")).toBeNull();
  expect(screen.getByPlaceholderText("Search tasks, tabs, files, actions…")).toBeTruthy();
});

test("with nothing to browse the searches stay off", () => {
  mount({});
  expect(calls.files.at(-1)).toBeNull();
  expect(calls.diff.at(-1)!.root).toBeNull();
  expect(screen.getByPlaceholderText("Search tasks and actions…")).toBeTruthy();
});

test("a task's palette searches the task and keeps the agent's labels", () => {
  const root = taskRoot("t1");
  mount({ taskId: "t1", root, layout: createLayout() });
  expect(calls.files.at(-1)).toBe(root);
  expect(screen.getByText("Agent")).toBeTruthy();
});

// TASK-139 AC #1: an archived task is offered as an Unarchive when searched
// for, behind the same confirmation as the sidebar's, and a confirmed one is
// opened once it is back.
test("searching offers Unarchive for an archived task, and confirming it opens the task", async () => {
  unarchive.archivedTasks.push({
    id: "t-archived",
    projectId: "web",
    title: "Fix the parser",
    lifecycle: "archived",
    lastMessage: null,
    agentState: "idle",
  });
  unarchive.unarchivePreview.mockResolvedValue({
    ok: true,
    value: {
      checkout: "from-snapshot",
      snapshot: { state: "kept", expiresAt: null, stale: false },
      branch: "codetoaster/fix-the-parser",
      baseRef: "main",
    },
  });
  unarchive.unarchiveTask.mockResolvedValue({ ok: true, value: { task: {} } });
  mount({});

  // Not at an empty box: a year of archived tasks would bury the actions.
  expect(screen.queryByText("Unarchive Fix the parser")).toBeNull();
  expect(unarchive.loadArchivedTasks).not.toHaveBeenCalled();

  fireEvent.change(screen.getByRole("combobox"), { target: { value: "unarchive" } });
  expect(unarchive.loadArchivedTasks).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("option", { name: /Unarchive Fix the parser/ }));

  screen.getByRole("dialog", { name: "Unarchive this task?" });
  await screen.findByText(
    "codetoaster/fix-the-parser was deleted when it was archived, and is recreated at the commit the snapshot was taken on.",
  );
  expect(unarchive.unarchivePreview).toHaveBeenCalledWith("t-archived");

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Unarchive" }));
  });
  expect(unarchive.unarchiveTask).toHaveBeenCalledWith("t-archived");
  expect(unarchive.openTask).toHaveBeenCalledWith("t-archived");
});
