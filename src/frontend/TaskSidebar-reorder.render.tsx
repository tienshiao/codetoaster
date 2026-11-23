import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ProjectInfo, TaskInfo } from "@/lib/xtmux/types";
import { resetSidebarState } from "./sidebar-store";
import { REORDER_CUE_MS, REORDER_LOCK_MS, useReorderGuard } from "./reorder-guard";

/**
 * TASK-146: a reorder of the task list cues the rows that moved and locks the
 * list against clicks for `REORDER_LOCK_MS`, so a row that slid under the
 * pointer cannot be opened or archived by a click aimed at the one before it.
 *
 * Rendered through the real hook and the real shell, because the behaviour is
 * the seam between them: the hook decides what was a reorder, the shell
 * refuses the click. Which sequences count as a reorder, and which rows get the
 * cue, is `orderChange`'s and is tested as a function in `reorder-guard.test.ts`.
 *
 * Fake timers stand in for the clock: they fake `Date.now` and `setTimeout`
 * together, so the lock the hook dates and the timer that lifts it agree.
 * Promises are left real, for the archive dialog's preview.
 */

function task(id: string, title: string, over: Partial<TaskInfo> = {}): TaskInfo {
  return {
    id,
    projectId: "website",
    ptyId: `pty-${id}`,
    shellPtyIds: [],
    title,
    titleSource: "derived",
    terminalTitle: "",
    agentState: "idle",
    profile: "claude",
    hooks: true,
    restarted: false,
    lifecycle: "live",
    cwd: "/Users/someone/projects/website",
    worktreePath: null,
    worktreeCwd: null,
    branch: null,
    lastMessage: null,
    clientCount: 0,
    size: { cols: 80, rows: 24 },
    createdAt: 0,
    lastActiveAt: 0,
    rankAt: 0,
    exited: false,
    hasNotification: false,
    worktreeState: "none",
    wipPending: false,
    worktree: null,
    ...over,
  };
}

function project(id: string, name: string): ProjectInfo {
  return {
    id,
    name,
    initialPath: `/Users/someone/projects/${id}`,
    taskIds: [],
    defaultModel: null,
    defaultProfile: null,
    defaultPermissionMode: null,
    defaultBaseRef: null,
    setupCommand: null,
    worktreeCopy: null,
    worktreeDefault: false,
  };
}

const A = task("a", "Fix the parser");
const B = task("b", "Rotate the certs");
const C = task("c", "Write the docs");

/** What `useTasks` hands out, mutated by each test and then re-rendered. A new
 * array is a new snapshot, the way `setTasks` would hand one over. */
const data = vi.hoisted(() => ({
  tasks: [] as TaskInfo[],
  archivedTasks: [] as TaskInfo[],
  projects: [] as ProjectInfo[],
}));
const stubs = vi.hoisted(() => ({
  onSelectTask: vi.fn(),
  archivePreview: vi.fn(),
  archiveTask: vi.fn(),
}));

vi.mock("@/frontend/TaskContext", () => ({
  useTasks: () => ({
    tasks: data.tasks,
    archivedTasks: data.archivedTasks,
    projects: data.projects,
    unclaimed: [],
    renameTask: vi.fn(),
    loadArchivedTasks: vi.fn(async () => {}),
    archivePreview: stubs.archivePreview,
    archiveTask: stubs.archiveTask,
    deleteTaskForGood: vi.fn(),
    unarchivePreview: vi.fn(),
    unarchiveTask: vi.fn(),
    deleteUnclaimedWorktree: vi.fn(),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    deleteProject: vi.fn(),
  }),
  taskStateOf: () => "idle",
}));

const { useTaskSidebar } = await import("./components/TaskSidebar");
const { AppShell } = await import("./components/v2/AppShell");

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function Sidebar() {
  const sidebar = useTaskSidebar({
    selectedTaskId: null,
    onSelectTask: stubs.onSelectTask,
    onNewTask: () => {},
  });
  return <AppShell {...sidebar} />;
}

function mount(tasks: TaskInfo[]) {
  data.tasks = tasks;
  const view = render(
    <QueryClientProvider client={client}>
      <Sidebar />
    </QueryClientProvider>,
  );
  return {
    /** A new snapshot from the server. */
    update(tasks: TaskInfo[]) {
      data.tasks = tasks;
      view.rerender(
        <QueryClientProvider client={client}>
          <Sidebar />
        </QueryClientProvider>,
      );
    },
    unmount: () => view.unmount(),
  };
}

function row(title: string): HTMLElement {
  const found = screen.getAllByRole("option").find((el) => el.textContent?.includes(title));
  if (!found) throw new Error(`no row for ${title}`);
  return found;
}

const order = () => screen.getAllByRole("option").map((el) => el.textContent);
const FLASH = /change-flash-[ab]/;
const cueOf = (title: string) => row(title).className.match(FLASH)?.[0];
const cued = () =>
  screen
    .getAllByRole("option")
    .filter((el) => FLASH.test(el.className))
    .map((el) => el.textContent);
const locked = () => document.querySelector("[data-locked]") !== null;
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000, toFake: ["Date", "setTimeout", "clearTimeout"] });
  resetSidebarState();
  localStorage.clear();
  data.tasks = [];
  data.archivedTasks = [];
  data.projects = [project("website", "Website"), project("infra", "Infra")];
  stubs.onSelectTask.mockReset();
  stubs.archivePreview.mockReset();
  stubs.archiveTask.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

test("a rank move cues the row that moved and locks the list", () => {
  const list = mount([A, B, C]);
  expect(locked()).toBe(false);

  list.update([C, A, B]);

  expect(order()[0]).toContain("Write the docs");
  expect(cued()).toEqual([row("Write the docs").textContent]);
  expect(locked()).toBe(true);
  // The list says it is locked, not only refuses: a screen reader hears it
  // busy, and the pointer is told so.
  expect(document.querySelector("[data-locked]")?.getAttribute("aria-busy")).toBe("true");
});

test("a click inside the window is ignored, and one after it goes through", () => {
  const list = mount([A, B, C]);
  list.update([C, A, B]);

  // The row now under the pointer is the one that just arrived.
  fireEvent.click(row("Write the docs"));
  expect(stubs.onSelectTask).not.toHaveBeenCalled();

  advance(REORDER_LOCK_MS - 1);
  fireEvent.click(row("Fix the parser"));
  expect(stubs.onSelectTask).not.toHaveBeenCalled();
  expect(locked()).toBe(true);

  advance(1);
  expect(locked()).toBe(false);
  fireEvent.click(row("Fix the parser"));
  expect(stubs.onSelectTask).toHaveBeenCalledWith("a");
});

test("a row's own actions are refused in the window too", () => {
  const list = mount([A, B, C]);
  list.update([C, A, B]);

  fireEvent.click(screen.getByRole("button", { name: "Archive Write the docs" }));
  expect(screen.queryByRole("dialog")).toBeNull();

  advance(REORDER_LOCK_MS);
  fireEvent.click(screen.getByRole("button", { name: "Archive Write the docs" }));
  expect(screen.queryByRole("dialog")).not.toBeNull();
});

test("a refresh that leaves the order alone neither cues nor locks", () => {
  const list = mount([A, B, C]);

  // A new snapshot, every row a new object, ages and states moved — and the
  // same order.
  list.update([
    { ...A, lastActiveAt: 500, agentState: "busy" },
    { ...B, lastMessage: "Done." },
    { ...C },
  ]);

  expect(cued()).toEqual([]);
  expect(locked()).toBe(false);
  fireEvent.click(row("Fix the parser"));
  expect(stubs.onSelectTask).toHaveBeenCalledWith("a");
});

test("a new task above the others locks the list and cues the new row", () => {
  const list = mount([A, B]);

  list.update([C, A, B]);

  expect(cued()).toEqual([row("Write the docs").textContent]);
  expect(locked()).toBe(true);
});

test("a task leaving the list locks it, though the rows below kept their order", () => {
  // The reported case: archive the top row (or have it leave from elsewhere)
  // and every row below slides up one, under a pointer aimed at its neighbour.
  const list = mount([A, B, C]);

  list.update([B, C]);

  expect(locked()).toBe(true);
  // Nothing moved relative to anything else, so there is no row to light.
  expect(cued()).toEqual([]);
  fireEvent.click(row("Rotate the certs"));
  expect(stubs.onSelectTask).not.toHaveBeenCalled();
});

test("the first snapshot, arriving into an empty list, is quiet", () => {
  const list = mount([]);

  list.update([A, B, C]);

  expect(order()).toHaveLength(3);
  expect(cued()).toEqual([]);
  expect(locked()).toBe(false);
});

test("a remount starts from what it finds", () => {
  const first = mount([A, B, C]);
  first.unmount();

  // The list changed while it was away — a navigation remounts the sidebar.
  mount([C, A, B]);

  expect(cued()).toEqual([]);
  expect(locked()).toBe(false);
});

test("typing a filter reshapes the list without locking it", () => {
  mount([A, B, C]);

  fireEvent.change(screen.getByPlaceholderText("Filter tasks"), { target: { value: "docs" } });
  expect(order()).toHaveLength(1);
  expect(locked()).toBe(false);
  // The click the filter was typed for.
  fireEvent.click(row("Write the docs"));
  expect(stubs.onSelectTask).toHaveBeenCalledWith("c");

  fireEvent.change(screen.getByPlaceholderText("Filter tasks"), { target: { value: "" } });
  expect(order()).toHaveLength(3);
  expect(cued()).toEqual([]);
  expect(locked()).toBe(false);
});

test("reorders in quick succession extend the lock from the latest one", () => {
  const list = mount([A, B, C]);

  list.update([C, A, B]);
  advance(REORDER_LOCK_MS - 100);
  list.update([B, C, A]);

  // Past where the first lock would have run out.
  advance(200);
  expect(locked()).toBe(true);
  fireEvent.click(row("Fix the parser"));
  expect(stubs.onSelectTask).not.toHaveBeenCalled();

  advance(REORDER_LOCK_MS - 200);
  expect(locked()).toBe(false);
});

test("a row that moves again while still lit restarts its cue instead of stacking one", () => {
  const list = mount([A, B, C]);

  list.update([C, A, B]);
  const first = cueOf("Write the docs");
  expect(first).toBeDefined();

  advance(REORDER_LOCK_MS);
  // Down and back up: C is the mover both times, and each move takes the other
  // of the two identical keyframes — a change of `animation-name` is what
  // restarts a fade already running.
  list.update([A, B, C]);
  const second = cueOf("Write the docs");
  expect(second).toBeDefined();
  expect(second).not.toBe(first);
  list.update([C, A, B]);
  expect(cueOf("Write the docs")).toBe(first);
  // One cue, on the one row — not a second layered over the first.
  expect(cued()).toEqual([row("Write the docs").textContent]);
});

test("the cue is taken off once its flash has run", () => {
  const list = mount([A, B, C]);
  list.update([C, A, B]);

  advance(REORDER_CUE_MS - 1);
  expect(cueOf("Write the docs")).toBeDefined();
  advance(1);
  expect(cueOf("Write the docs")).toBeUndefined();
});

test("grouped, a move between groups locks and cues; closing a group does not", () => {
  const list = mount([A, { ...B, projectId: "infra" }, C]);
  fireEvent.click(screen.getByRole("button", { name: "Group by project" }));
  expect(locked()).toBe(false);

  // The infra task wakes: its group overtakes Website's.
  list.update([{ ...B, projectId: "infra", rankAt: 10 }, A, C]);
  expect(locked()).toBe(true);
  expect(cued()).toEqual([row("Rotate the certs").textContent]);

  advance(REORDER_CUE_MS);
  expect(locked()).toBe(false);

  // The user's own chevron: rows vanish from under the pointer by request.
  const chevron = screen.getByRole("button", { name: /^Infra/, expanded: true });
  fireEvent.click(chevron);
  expect(chevron.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryAllByRole("option").map((el) => el.textContent)).not.toContainEqual(
    expect.stringContaining("Rotate the certs"),
  );
  expect(locked()).toBe(false);
});

// ── the hook on its own, for the view/data rule ──────────────────────────────

function guard(initial: { sequence: string[]; view: unknown[]; data: unknown }) {
  return renderHook((p: typeof initial) => useReorderGuard(p.sequence, p.view, p.data), {
    initialProps: initial,
  });
}

test("a view change on its own moves the baseline quietly", () => {
  const tasks = [A, B, C];
  const hook = guard({ sequence: ["a", "b", "c"], view: [""], data: tasks });

  hook.rerender({ sequence: ["c"], view: ["docs"], data: tasks });
  expect(hook.result.current.locked).toBe(false);
  expect(hook.result.current.cues.size).toBe(0);
});

test("a view change landing with a data change still counts", () => {
  // The cheap side of the trade: a spurious half-second lock, rather than a
  // real reorder waved through because a fetch happened to land with it.
  const view: unknown[] = [[]];
  const hook = guard({ sequence: ["a", "b", "c"], view, data: [A, B, C] });

  hook.rerender({ sequence: ["c", "a", "b"], view: [[ARCHIVED]], data: [C, A, B] });
  expect(hook.result.current.locked).toBe(true);
});

const ARCHIVED = task("z", "Old work", { lifecycle: "archived" });

test("the lock the hook reports follows its clock", () => {
  const hook = guard({ sequence: ["a", "b"], view: [], data: [A, B] });
  hook.rerender({ sequence: ["b", "a"], view: [], data: [B, A] });
  expect(hook.result.current.locked).toBe(true);

  advance(REORDER_LOCK_MS);
  expect(hook.result.current.locked).toBe(false);
});

test("the archive confirmation answers while the list is locked", async () => {
  // The dialog is portaled out of the list, but React routes its clicks
  // through the row that owns it — the lock must not swallow them. It does not
  // move when the list does, so there is nothing to protect it from.
  stubs.archivePreview.mockResolvedValue({
    ok: true,
    value: {
      status: { exists: true, dirty: 0, unpushed: 0, merged: false, pushed: false, atBase: false },
      branch: null,
      branchWouldBeDeleted: false,
      wipRetentionDays: 30,
    },
  });
  const list = mount([A, B, C]);
  fireEvent.click(screen.getByRole("button", { name: "Archive Rotate the certs" }));
  await act(async () => {});
  const dialog = screen.getByRole("dialog");

  list.update([C, A, B]);
  expect(locked()).toBe(true);

  fireEvent.click(within(dialog).getByRole("button", { name: "Archive" }));
  expect(stubs.archiveTask).toHaveBeenCalledWith("b");
});
