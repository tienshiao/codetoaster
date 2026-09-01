import { test, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ChangeEvent } from "react";
import type { ProjectInfo, TaskInfo } from "@/lib/xtmux/types";
import { resetSidebarState } from "./sidebar-store";

/**
 * The defect TASK-67 fixes, stated as the thing that used to break: `/` and
 * `/t/$slug` are separate route components, each rendering its own `TaskShell`,
 * so navigating between them unmounts the sidebar and mounts a new one. Every
 * assertion below is therefore "set it, unmount, mount again, still there" —
 * the arrangement the user chose has to outlive the component that offered it.
 *
 * A rendering test and not a `.test.ts`, because surviving a remount is a
 * lifecycle question and nothing else here is: the arithmetic of what is stored
 * and what is refused is in `sidebar-store.test.ts`, against the functions.
 * Note the filename carries no `.test` — that is what keeps it out of
 * `bun test`; see CLAUDE.md, "Testing".
 */

const STORAGE_KEY = "codetoaster:sidebar";

function task(overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    id: "t1",
    projectId: "website",
    ptyId: "pty-1",
    shellPtyIds: [],
    title: "Fix the parser",
    titleSource: "derived",
    terminalTitle: "",
    agentState: "idle",
    lifecycle: "live",
    cwd: "/Users/someone/projects/website",
    worktreePath: null,
    branch: null,
    lastMessage: null,
    clientCount: 0,
    size: { cols: 80, rows: 24 },
    createdAt: 0,
    lastActiveAt: 0,
    exited: false,
    hasNotification: false,
    worktreeState: "none",
    wipPending: false,
    worktree: null,
    ...overrides,
  };
}

function project(id: string, name: string): ProjectInfo {
  return {
    id,
    name,
    initialPath: `/Users/someone/projects/${id}`,
    taskIds: [],
    defaultModel: null,
    defaultPermissionMode: null,
    defaultBaseRef: null,
    setupCommand: null,
    worktreeCopy: null,
    worktreeDefault: false,
  };
}

// Mocked rather than wrapped in a real provider: `TaskContext` opens a socket
// and fetches, and none of that is what this file is asking about. The two
// tasks and two projects are only enough to give the grouping something to
// group and the closed-group record something to name.
const stubs = vi.hoisted(() => ({ loadArchivedTasks: vi.fn(async () => {}) }));

vi.mock("@/frontend/TaskContext", () => ({
  useTasks: () => ({
    tasks: [
      task(),
      task({ id: "t2", projectId: "infra", title: "Rotate the certs" }),
    ],
    archivedTasks: [],
    projects: [project("website", "Website"), project("infra", "Infra")],
    unclaimed: [],
    createTask: vi.fn(),
    renameTask: vi.fn(),
    closeTask: vi.fn(),
    loadArchivedTasks: stubs.loadArchivedTasks,
    archivePreview: vi.fn(),
    archiveTask: vi.fn(),
    deleteTaskForGood: vi.fn(),
    deleteUnclaimedWorktree: vi.fn(),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    deleteProject: vi.fn(),
  }),
  taskStateOf: () => "idle",
}));

const { useTaskSidebar } = await import("./components/TaskSidebar");
type SidebarProps = import("./components/TaskSidebar").TaskSidebarProps;

/**
 * One mount of the sidebar's state, standing in for one route component.
 *
 * `state` is read through a getter and not captured, because every assertion
 * here is about a value that changed since the last render. It is asserted as
 * `Required` for the same reason it can be: `TaskSidebarProps` is a `Pick` of
 * `AppShellProps`, where every field is optional so the shell can be drawn with
 * no list at all — but this hook is the thing that always supplies them, and
 * saying so once beats a non-null assertion on each of nine reads.
 */
function mount() {
  const view = renderHook(() =>
    useTaskSidebar({ selectedTaskId: null, onSelectTask: vi.fn() }),
  );
  return {
    unmount: () => view.unmount(),
    get state(): Required<SidebarProps> {
      return view.result.current as Required<SidebarProps>;
    },
  };
}

/** What a typed character reaches the handler as. */
function typed(value: string): ChangeEvent<HTMLInputElement> {
  return { target: { value } } as ChangeEvent<HTMLInputElement>;
}

beforeEach(() => {
  resetSidebarState();
  localStorage.clear();
  stubs.loadArchivedTasks.mockClear();
});

test("grouping the list survives a navigation", () => {
  const first = mount();
  act(() => first.state.onToggleGrouping());
  expect(first.state.grouped).toBe(true);
  first.unmount();

  expect(mount().state.grouped).toBe(true);
});

test("the archived toggle survives a navigation", () => {
  const first = mount();
  act(() => first.state.onToggleArchived());
  expect(first.state.showArchived).toBe(true);
  first.unmount();

  const second = mount();
  expect(second.state.showArchived).toBe(true);
  // And the rows are re-fetched on the new mount rather than assumed: the
  // archived list arrives by fetch, so one loaded before three more tasks were
  // archived would go on showing the three it knew about.
  expect(stubs.loadArchivedTasks).toHaveBeenCalledTimes(2);
});

test("the filter survives a navigation", () => {
  // The whole of the reported defect: type a filter, click the task you found,
  // and on the screen you used it to reach the box was empty again.
  const first = mount();
  act(() => first.state.onTaskFilterChange(typed("parser")));
  expect(first.state.taskFilter).toBe("parser");
  first.unmount();

  const second = mount();
  expect(second.state.taskFilter).toBe("parser");
  expect(second.state.tasks.map((t) => t.title)).toEqual(["Fix the parser"]);
});

test("a closed group is still closed after a navigation", () => {
  const first = mount();
  const website = () => first.state.groups.find((g) => g.id === "website")!;
  expect(website().open).toBe(true);
  // Optional on `ShellGroup`, because a header without a chevron is a legal
  // group; a miss here would show up as the `open` assertion below not moving.
  act(() => website().onToggle?.());
  expect(website().open).toBe(false);
  first.unmount();

  const second = mount();
  expect(second.state.groups.find((g) => g.id === "website")!.open).toBe(false);
});

test("a closed group named by the store but gone from the list is simply inert", () => {
  // A project deleted since one of its groups was closed leaves an id behind in
  // storage. Nothing has to prune it: the list of groups is drawn from the
  // groups that exist, and the record is only ever read by id — so a stale
  // entry is never asked about, and the groups that are there open normally.
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ grouped: true, closedGroups: { "deleted-project": true } }),
  );

  const view = mount();
  expect(view.state.grouped).toBe(true);
  expect(view.state.groups.map((g) => g.id)).toEqual(["website", "infra"]);
  expect(view.state.groups.every((g) => g.open)).toBe(true);
});
