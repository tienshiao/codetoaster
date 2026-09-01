import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { TaskInfo } from "../../lib/xtmux/types";
import { clearLayout, loadLayout, openTab, saveLayout } from "../layout-store";

/**
 * The shell's two async lifecycle rules, which only exist once the component is
 * mounted: opening a shell tab across a round trip, and reconciling a restored
 * layout against the PTYs the server says are running (§5.5).
 *
 * Vitest's, not `bun test`'s — see CLAUDE.md, "Testing". Neither of these is
 * arithmetic over a layout (`layout-store.test.ts` has that, including
 * `reconcileShellTabs` itself); both are about *when* a write is issued
 * relative to an await and to a task delta, which is a question only a mounted
 * tree can answer.
 *
 * Everything around the tab area is stubbed. The task list, the Explorer and
 * the terminal are not the subject and each drags in a socket, so `AppShell`
 * here is reduced to the one thing that matters — the chrome slot the tab area
 * is rendered into.
 */

const stubs = vi.hoisted(() => ({
  tasks: [] as TaskInfo[],
  openShell: vi.fn<(id: string) => Promise<unknown>>(),
  closeShell: vi.fn<(id: string, ptyId: string) => Promise<unknown>>(),
  toast: vi.fn(),
  setViewedTask: vi.fn(),
  resolveWip: vi.fn(),
}));

vi.mock("@/frontend/TaskContext", () => ({
  useTasks: () => ({
    tasks: stubs.tasks,
    loaded: true,
    openShell: stubs.openShell,
    closeShell: stubs.closeShell,
    setViewedTask: stubs.setViewedTask,
    resolveWip: stubs.resolveWip,
  }),
  taskStateOf: () => "idle",
  // The real projection over the real shape; it is pure, and stubbing it would
  // only mean these tests could not see a label change break the shell.
  taskDisplayNames: (tasks: TaskInfo[]) =>
    new Map(tasks.map((t) => [t.id, t.terminalTitle || t.title])),
}));
vi.mock("sonner", () => ({ toast: Object.assign(stubs.toast, { error: vi.fn() }) }));
vi.mock("@/frontend/PtyContext", () => ({ usePty: () => ({ sendInput: vi.fn() }) }));
vi.mock("@/frontend/hooks/use-task-nav", () => ({ useOpenTask: () => vi.fn() }));
vi.mock("@/frontend/hooks/use-explorer-panel", () => ({
  useExplorerPanel: () => ({ section: "Changes", setSection: vi.fn(), open: false, setOpen: vi.fn() }),
}));
vi.mock("@/frontend/components/Explorer", () => ({
  Explorer: () => null,
  useExplorerRail: () => [],
}));
vi.mock("@/frontend/components/TaskSidebar", () => ({ useTaskSidebar: () => ({}) }));
// Only the slot and the Settings button. Everything else `AppShell` draws is
// chrome this file has no question about, and all of it wants data from the
// contexts stubbed above.
//
// It renders no `children`, and that is the real component's contract rather
// than a shortcut: `AppShell` renders `children` only on the branch where no
// `tabArea` was supplied. Anything the shell passes through as a child is
// therefore invisible on every page that has a layout — which is every task
// page.
vi.mock("@/frontend/components/v2/AppShell", () => ({
  AppShell: ({
    tabArea,
    onOpenSettings,
    status,
  }: {
    tabArea?: (chrome: { leading: ReactNode }) => ReactNode;
    onOpenSettings?: () => void;
    status?: { items?: ReactNode[] };
  }) => (
    <div>
      <button type="button" onClick={onOpenSettings}>
        Settings
      </button>
      {/* The items only, not `StatusBar` itself — what this file asks is which
          facts the shell decided to put there, which is its own decision and
          not the bar's. */}
      <div data-testid="status-items">
        {status?.items?.map((it, i) => <span key={i}>{it}</span>)}
      </div>
      {tabArea ? tabArea({ leading: null }) : null}
    </div>
  ),
}));
// The panes are terminals and diff views; the strip is what this file reads.
vi.mock("@/frontend/components/tabs/panes", () => ({ TabPane: () => null }));

const { TaskShell } = await import("./TaskShell");
const { TerminalThemeProvider } = await import("../hooks/use-terminal-theme");

/** The shell under the one provider it genuinely needs: the settings dialog
 * reads the terminal theme, and this file renders the real dialog rather than a
 * stub precisely so it can see whether it mounts at all. */
function renderShell(taskId: string | null = TASK_ID) {
  return render(
    <TerminalThemeProvider>
      <TaskShell taskId={taskId} />
    </TerminalThemeProvider>,
  );
}

const TASK_ID = "task-1";

function task(overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    id: TASK_ID,
    projectId: "general",
    ptyId: "agent-pty",
    shellPtyIds: [],
    title: "a task",
    titleSource: "derived",
    terminalTitle: "",
    agentState: "idle",
    lifecycle: "live",
    cwd: "/Users/someone/projects/app",
    worktreePath: null,
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

/** The shell tabs the layout in storage holds, in order. */
function storedShells(): string[] {
  return loadLayout(TASK_ID)
    .groups.flatMap((g) => g.tabs)
    .flatMap((t) => (t.descriptor.kind === "shell" ? [t.descriptor.ptyId] : []));
}

beforeEach(() => {
  clearLayout(TASK_ID);
  stubs.tasks = [task()];
  stubs.openShell.mockReset();
  stubs.closeShell.mockReset();
  stubs.closeShell.mockResolvedValue({ ok: true, value: {} });
  stubs.toast.mockReset();
});

afterEach(() => {
  clearLayout(TASK_ID);
});

test("two presses on + inside one round trip open two tabs, not one", async () => {
  // The failure this exists for: both presses read the layout as it was before
  // either answered, so the second write lands a layout that never held the
  // first shell's tab — and its PTY goes on running with nothing on screen to
  // close it and nothing to reap it short of the task being suspended.
  const answers: Array<(value: unknown) => void> = [];
  stubs.openShell.mockImplementation(
    () => new Promise((resolve) => answers.push(resolve)),
  );

  renderShell();
  const plus = screen.getByLabelText("New shell");
  fireEvent.click(plus);
  fireEvent.click(plus);
  expect(answers).toHaveLength(2);

  await act(async () => {
    answers[0]!({ ok: true, value: { ptyId: "pty-a" } });
    answers[1]!({ ok: true, value: { ptyId: "pty-b" } });
  });

  await waitFor(() => expect(storedShells()).toEqual(["pty-a", "pty-b"]));
});

test("a failed open leaves the layout alone", async () => {
  stubs.openShell.mockResolvedValue({ ok: false, error: { status: 409, message: "suspended" } });

  renderShell();
  await act(async () => {
    fireEvent.click(screen.getByLabelText("New shell"));
  });

  // The refusal already reached the user as a toast from `request`; there is
  // simply no tab to open.
  expect(storedShells()).toEqual([]);
});

test("closing a shell tab kills its PTY; closing anything else does not", async () => {
  saveLayout(TASK_ID, openTab(loadLayout(TASK_ID), { kind: "shell", ptyId: "pty-a" }));
  stubs.tasks = [task({ shellPtyIds: ["pty-a"] })];

  renderShell();
  await act(async () => {
    fireEvent.click(screen.getByLabelText("Close shell"));
  });

  expect(stubs.closeShell).toHaveBeenCalledWith(TASK_ID, "pty-a");
  expect(storedShells()).toEqual([]);
});

test("a suspended task drops its restored shell tabs and says so", async () => {
  saveLayout(TASK_ID, openTab(loadLayout(TASK_ID), { kind: "shell", ptyId: "pty-a" }));
  // A fresh page load onto a task harvested while nothing was watching: this
  // client never saw that PTY alive, so only the lifecycle can be the evidence.
  stubs.tasks = [task({ lifecycle: "suspended", ptyId: null, shellPtyIds: [] })];

  renderShell();

  await waitFor(() => expect(storedShells()).toEqual([]));
  expect(stubs.toast).toHaveBeenCalledWith(
    "Closed a shell tab",
    expect.objectContaining({ description: expect.stringContaining("suspended") }),
  );
});

test("a live task drops a restored shell tab it does not report", async () => {
  saveLayout(TASK_ID, openTab(loadLayout(TASK_ID), { kind: "shell", ptyId: "pty-a" }));
  // The gap the lifecycle rule alone misses: the PTY died while nothing was
  // watching — a daemon restart, or a harvest — and the task was brought back
  // to `live` by the CLI or another client before this one ever connected. The
  // tab was restored from disk, so nothing is in flight for it and its absence
  // is evidence rather than silence.
  stubs.tasks = [task({ lifecycle: "live", shellPtyIds: [] })];

  renderShell();

  await waitFor(() => expect(storedShells()).toEqual([]));
});

test("a shell tab this client just opened survives a delta that predates it", async () => {
  // The race the `seen` set exists for, and the reason the rule above is about
  // knowledge rather than absence: the tab is opened from the POST's answer,
  // and a task delta computed a moment before the spawn carries a
  // `shellPtyIds` without it.
  stubs.openShell.mockResolvedValue({ ok: true, value: { ptyId: "pty-a" } });

  const { rerender } = renderShell();
  await act(async () => {
    fireEvent.click(screen.getByLabelText("New shell"));
  });
  expect(storedShells()).toEqual(["pty-a"]);

  // The stale delta lands.
  stubs.tasks = [task({ lifecycle: "live", shellPtyIds: [] })];
  await act(async () => {
    rerender(
      <TerminalThemeProvider>
        <TaskShell taskId={TASK_ID} />
      </TerminalThemeProvider>,
    );
  });

  expect(storedShells()).toEqual(["pty-a"]);
  expect(stubs.toast).not.toHaveBeenCalled();
});

test("Settings opens on a task page, not only where there is no layout", async () => {
  // `AppShell` draws the Settings button on every page but renders `children`
  // only where no `tabArea` was supplied. A dialog handed to it as a child was
  // therefore mounted at `/` and nowhere else: on a task page the button
  // flipped the state and nothing appeared.
  renderShell();
  await act(async () => {
    fireEvent.click(screen.getByText("Settings"));
  });

  expect(screen.getByRole("dialog")).toBeDefined();
  expect(screen.getByText("Notification Sound")).toBeDefined();
});

test("a shell answered after the user left the task is killed, not abandoned", async () => {
  // The spawn has already succeeded by the time we find out, and there is
  // nowhere to put its tab: the ref now holds another task's layout. Dropping
  // it silently leaves a shell running in the original task's directory with
  // nothing on screen to close it — `reconcileShellTabs` prunes tabs, and
  // nothing reaps a PTY no tab names.
  const answers: Array<(value: unknown) => void> = [];
  stubs.openShell.mockImplementation(() => new Promise((resolve) => answers.push(resolve)));

  const { rerender } = renderShell();
  fireEvent.click(screen.getByLabelText("New shell"));

  // The user moves to another task under the round trip.
  rerender(
    <TerminalThemeProvider>
      <TaskShell taskId="another-task" />
    </TerminalThemeProvider>,
  );
  await act(async () => {
    answers[0]!({ ok: true, value: { ptyId: "pty-orphan" } });
  });

  expect(stubs.closeShell).toHaveBeenCalledWith(TASK_ID, "pty-orphan");
  expect(storedShells()).toEqual([]);
});

// The shell is rendered once for every task: `TaskRoute` changes the slug prop
// rather than remounting, so anything at a stable position in this tree is
// reconciled from one task straight into the next. `WipNotice` holds a local
// "decide later" flag, which makes it exactly the kind of component that must
// not be — and the consequence is not a cosmetic one: a user who dismissed the
// notice on one task would never be told that a *different* task's saved work
// could not be restored, and its ref would wait forever with nothing pointing
// at it.
test("a dismissed WIP notice does not follow the user to the next task", () => {
  stubs.tasks = [
    task({ id: TASK_ID, wipPending: true }),
    task({ id: "task-2", title: "another task", wipPending: true }),
  ];

  const { rerender } = renderShell();
  expect(screen.queryByRole("status")).not.toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Later" }));
  expect(screen.queryByRole("status")).toBeNull();

  rerender(
    <TerminalThemeProvider>
      <TaskShell taskId="task-2" />
    </TerminalThemeProvider>,
  );

  // The second task has said nothing about its own snapshot, so it still asks.
  expect(screen.queryByRole("status")).not.toBeNull();
  expect(stubs.resolveWip).not.toHaveBeenCalled();
});

/**
 * What the status bar says about *where* a task is (TASK-71).
 *
 * The rule is a comparison, not a flag: the path is left out exactly when the
 * task is sitting in the checkout we made for it, because that path is a
 * generated `~/.codetoaster/worktrees/<project>/<uuid>` and the branch beside
 * it says everything it would. The same comparison is what puts the path back
 * when an agent cd's out of its own checkout, which is the case §5.4 exists for
 * and the one where a path is worth the width.
 */
test("the status bar drops a path that is only the task's own worktree", () => {
  const checkout = "/Users/someone/.codetoaster/worktrees/ct/4b55ec75-3bd6-4dbd-a2e1-937affffb044";
  stubs.tasks = [task({ cwd: checkout, worktreePath: checkout })];
  renderShell();

  const status = screen.getByTestId("status-items").textContent ?? "";
  expect(status).not.toContain("worktrees");
  expect(status).not.toContain("4b55ec75");
});

test("an agent that has left its own checkout gets its path back", () => {
  stubs.tasks = [
    task({
      cwd: "/Users/someone/elsewhere",
      worktreePath: "/Users/someone/.codetoaster/worktrees/ct/4b55ec75",
    }),
  ];
  renderShell();

  expect(screen.getByTestId("status-items").textContent).toContain("elsewhere");
});

test("a task with no checkout of its own always shows its path", () => {
  stubs.tasks = [task({ cwd: "/Users/someone/projects/app", worktreePath: null })];
  renderShell();

  expect(screen.getByTestId("status-items").textContent).toContain("projects/app");
});
