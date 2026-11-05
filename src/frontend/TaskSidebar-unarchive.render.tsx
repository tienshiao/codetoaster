import { test, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { TaskInfo, UnarchivePreview } from "@/lib/xtmux/types";
import { resetSidebarState } from "./sidebar-store";

/**
 * The sidebar's Unarchive, wired (TASK-139): the archived row's control reaches
 * the context's `unarchiveTask`, and a success opens the task the user asked
 * for back. The dialog's own states are `TaskSidebar.render.tsx`'s; this is the
 * part only the hook can get wrong — which task is posted, and that the
 * navigation waits for the answer rather than racing it.
 */

function archived(overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    id: "t-archived",
    projectId: "website",
    ptyId: null,
    shellPtyIds: [],
    title: "Fix the parser",
    titleSource: "derived",
    terminalTitle: "",
    agentState: "idle",
    profile: "claude",
    hooks: true,
    restarted: false,
    lifecycle: "archived",
    cwd: "/Users/someone/projects/website",
    worktreePath: null,
    worktreeCwd: null,
    branch: "codetoaster/fix-the-parser",
    lastMessage: null,
    clientCount: 0,
    size: { cols: 80, rows: 24 },
    createdAt: 0,
    lastActiveAt: 0,
    rankAt: 0,
    exited: false,
    hasNotification: false,
    worktreeState: "evicted",
    wipPending: false,
    worktree: null,
    ...overrides,
  } as TaskInfo;
}

const PREVIEW: UnarchivePreview = {
  checkout: "restore",
  snapshot: { state: "kept", expiresAt: null, stale: false },
  branch: "codetoaster/fix-the-parser",
  baseRef: "main",
};

const stubs = vi.hoisted(() => ({
  unarchivePreview: vi.fn(),
  unarchiveTask: vi.fn(),
  onSelectTask: vi.fn(),
}));

vi.mock("@/frontend/TaskContext", () => ({
  useTasks: () => ({
    tasks: [],
    archivedTasks: [archived()],
    projects: [],
    unclaimed: [],
    renameTask: vi.fn(),
    closeTask: vi.fn(),
    loadArchivedTasks: vi.fn(async () => {}),
    archivePreview: vi.fn(),
    archiveTask: vi.fn(),
    deleteTaskForGood: vi.fn(),
    unarchivePreview: stubs.unarchivePreview,
    unarchiveTask: stubs.unarchiveTask,
    deleteUnclaimedWorktree: vi.fn(),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    deleteProject: vi.fn(),
  }),
  taskStateOf: () => "exited",
}));

const { useTaskSidebar } = await import("./components/TaskSidebar");

beforeEach(() => {
  resetSidebarState();
  localStorage.clear();
  stubs.unarchivePreview.mockReset();
  stubs.unarchivePreview.mockResolvedValue({ ok: true, value: PREVIEW });
  stubs.unarchiveTask.mockReset();
  stubs.onSelectTask.mockReset();
});

/** The archived row's controls, as the hook built them, mounted on their own. */
function archivedRowActions() {
  const view = renderHook(() =>
    useTaskSidebar({ selectedTaskId: null, onSelectTask: stubs.onSelectTask, onNewTask: vi.fn() }),
  );
  act(() => view.result.current.onToggleArchived!());
  const row = view.result.current.tasks!.find((t) => t.id === "t-archived")!;
  expect(row.archived).toBe(true);
  render(<>{row.actions}</>);
}

test("confirming an unarchive posts it, then opens the task", async () => {
  let settle: (result: unknown) => void = () => {};
  stubs.unarchiveTask.mockReturnValue(new Promise((resolve) => (settle = resolve)));
  archivedRowActions();

  fireEvent.click(screen.getByRole("button", { name: "Unarchive Fix the parser" }));
  await screen.findByText("Its checkout is rebuilt on codetoaster/fix-the-parser.");
  expect(stubs.unarchivePreview).toHaveBeenCalledWith("t-archived");

  fireEvent.click(screen.getByRole("button", { name: "Unarchive" }));
  expect(stubs.unarchiveTask).toHaveBeenCalledWith("t-archived");
  // Not before the server has answered: the task is not openable until it is
  // back in the live list, which is what the answer puts it in.
  expect(stubs.onSelectTask).not.toHaveBeenCalled();

  await act(async () => settle({ ok: true, value: { task: archived({ lifecycle: "live" }) } }));
  expect(stubs.onSelectTask).toHaveBeenCalledWith("t-archived");
});

test("a failed unarchive stays where it is", async () => {
  // The context's `request` has already toasted the failure.
  stubs.unarchiveTask.mockResolvedValue({ ok: false, error: { status: 409, message: "no" } });
  archivedRowActions();

  fireEvent.click(screen.getByRole("button", { name: "Unarchive Fix the parser" }));
  await screen.findByText("Its checkout is rebuilt on codetoaster/fix-the-parser.");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Unarchive" }));
  });

  expect(stubs.unarchiveTask).toHaveBeenCalledWith("t-archived");
  expect(stubs.onSelectTask).not.toHaveBeenCalled();
});

test("a preview the server refused (409) is quoted", async () => {
  stubs.unarchivePreview.mockResolvedValue({
    ok: false,
    error: {
      status: 409,
      message: `Task "Fix the parser" was branched from a repository this task can no longer name.`,
    },
  });
  archivedRowActions();
  fireEvent.click(screen.getByRole("button", { name: "Unarchive Fix the parser" }));
  await screen.findByText(/can no longer name/);
  screen.getByText("Unarchiving will be refused until that changes.");
});

test("a preview that merely failed says so without quoting the error", async () => {
  stubs.unarchivePreview.mockResolvedValue({ ok: false, error: { status: 500, message: "boom" } });
  archivedRowActions();
  fireEvent.click(screen.getByRole("button", { name: "Unarchive Fix the parser" }));
  await screen.findByText(/could not be established/);
  expect(screen.queryByText("boom")).toBeNull();
});
