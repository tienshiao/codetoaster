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
}));

vi.mock("@/frontend/TaskContext", () => ({
  useTasks: () => ({
    tasks: stubs.tasks,
    loaded: true,
    openShell: stubs.openShell,
    closeShell: stubs.closeShell,
    setViewedTask: stubs.setViewedTask,
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
vi.mock("@/frontend/components/SettingsDialog", () => ({ SettingsDialog: () => null }));
// Only the slot. Everything else `AppShell` draws is chrome this file has no
// question about, and all of it wants data from the contexts stubbed above.
vi.mock("@/frontend/components/v2/AppShell", () => ({
  AppShell: ({ tabArea }: { tabArea?: (chrome: { leading: ReactNode }) => ReactNode }) => (
    <div>{tabArea ? tabArea({ leading: null }) : null}</div>
  ),
}));
// The panes are terminals and diff views; the strip is what this file reads.
vi.mock("@/frontend/components/tabs/panes", () => ({ TabPane: () => null }));

const { TaskShell } = await import("./TaskShell");

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
    lastMessage: null,
    clientCount: 0,
    size: { cols: 80, rows: 24 },
    createdAt: 0,
    lastActiveAt: 0,
    exited: false,
    hasNotification: false,
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

  render(<TaskShell taskId={TASK_ID} />);
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

  render(<TaskShell taskId={TASK_ID} />);
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

  render(<TaskShell taskId={TASK_ID} />);
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

  render(<TaskShell taskId={TASK_ID} />);

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

  render(<TaskShell taskId={TASK_ID} />);

  await waitFor(() => expect(storedShells()).toEqual([]));
});

test("a shell tab this client just opened survives a delta that predates it", async () => {
  // The race the `seen` set exists for, and the reason the rule above is about
  // knowledge rather than absence: the tab is opened from the POST's answer,
  // and a task delta computed a moment before the spawn carries a
  // `shellPtyIds` without it.
  stubs.openShell.mockResolvedValue({ ok: true, value: { ptyId: "pty-a" } });

  const { rerender } = render(<TaskShell taskId={TASK_ID} />);
  await act(async () => {
    fireEvent.click(screen.getByLabelText("New shell"));
  });
  expect(storedShells()).toEqual(["pty-a"]);

  // The stale delta lands.
  stubs.tasks = [task({ lifecycle: "live", shellPtyIds: [] })];
  await act(async () => {
    rerender(<TaskShell taskId={TASK_ID} />);
  });

  expect(storedShells()).toEqual(["pty-a"]);
  expect(stubs.toast).not.toHaveBeenCalled();
});
