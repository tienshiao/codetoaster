import { test, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { TaskInfo } from "../../../../lib/xtmux/types";
import type { TaskResult } from "../../../TaskContext";

/**
 * The reopen a suspended task gets when its tab mounts (§5.5) — specifically
 * where its failures are reported.
 *
 * A resume can fail two ways and they do not look alike from here: the request
 * itself fails, which carries a message, or the ladder runs every rung and
 * gives up, which arrives as a 200 whose row says `could_not_resume` and
 * carries nothing. The overlay is the one place either is reported, so the one
 * with a message has to show it — otherwise asking `request` not to toast drops
 * the only account of what went wrong.
 *
 * `XTerminal` is stubbed: it builds a real xterm grid, which needs geometry
 * happy-dom does not have, and none of it is the subject here.
 */

const stubs = vi.hoisted(() => ({
  tasks: [] as TaskInfo[],
  resumeTask: vi.fn<(id: string, options?: unknown, reporting?: unknown) => Promise<TaskResult<TaskInfo>>>(),
}));

vi.mock("@/frontend/TaskContext", () => ({
  useTasks: () => ({ tasks: stubs.tasks, resumeTask: stubs.resumeTask }),
}));
vi.mock("@/frontend/PtyContext", () => ({
  usePty: () => ({
    attach: vi.fn(),
    detach: vi.fn(),
    resize: vi.fn(),
    send: vi.fn(),
    isConnected: true,
  }),
}));
vi.mock("@/frontend/Terminal", () => ({
  XTerminal: () => null,
}));

const { AgentPane } = await import("./AgentPane");

const TASK_ID = "task-1";

function task(overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    id: TASK_ID,
    projectId: "general",
    ptyId: null,
    shellPtyIds: [],
    title: "a task",
    titleSource: "derived",
    terminalTitle: "",
    agentState: "idle",
    lifecycle: "suspended",
    cwd: "/Users/someone/projects/app",
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

beforeEach(() => {
  // The reopen asks for the stored screen in parallel with the resume; a task
  // with none is a normal answer and the phase goes on waiting for the PTY.
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
  stubs.tasks = [task()];
  stubs.resumeTask.mockReset();
});

test("opening a suspended task resumes it, and asks not to be toasted", async () => {
  stubs.resumeTask.mockResolvedValue({ ok: true, value: task({ lifecycle: "live" }) });

  await act(async () => {
    render(<AgentPane taskId={TASK_ID} visible />);
  });

  await waitFor(() => expect(stubs.resumeTask).toHaveBeenCalledTimes(1));
  // The overlay below is where a failure is reported, so `request` must not
  // also raise a toast saying almost the same sentence (TASK-57's rule).
  expect(stubs.resumeTask.mock.calls[0]![2]).toEqual({ inline: true });
});

test("a failed request shows its reason on the overlay", async () => {
  stubs.resumeTask.mockResolvedValue({
    ok: false,
    error: { status: 0, message: "Failed to fetch" },
  });

  await act(async () => {
    render(<AgentPane taskId={TASK_ID} visible />);
  });

  await screen.findByText("Could not resume this task");
  // The cause, which the toast used to be the only carrier of.
  expect(screen.getByText("Failed to fetch")).toBeDefined();
  expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
});

test("a ladder that gave up shows the failure without inventing a reason", async () => {
  // A 200 whose row says the agent could not be brought back (§4.3). Nothing
  // was ever toasted for this one, and there is no message to show.
  stubs.resumeTask.mockResolvedValue({
    ok: true,
    value: task({ agentState: "could_not_resume" }),
  });

  await act(async () => {
    render(<AgentPane taskId={TASK_ID} visible />);
  });

  await screen.findByText("Could not resume this task");
  expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
});

test("a live task is not reopened, and shows no overlay", async () => {
  stubs.tasks = [task({ lifecycle: "live", ptyId: "pty-1" })];

  await act(async () => {
    render(<AgentPane taskId={TASK_ID} visible />);
  });

  // Auto-reopening anything but a resting task is what would spawn
  // `claude --resume` the instant a user closed one.
  expect(stubs.resumeTask).not.toHaveBeenCalled();
  expect(screen.queryByText("Could not resume this task")).toBeNull();
  expect(screen.queryByText("Suspended")).toBeNull();
});

/**
 * The two states the tests above never reached (TASK-70).
 *
 * They are the ones the overlay's *chrome* changed under — it stopped being the
 * only `rounded-full` thing in the app and picked up the system's radius,
 * surface, shadow, control size and status dot — so this is where "all three
 * still render" is pinned rather than asserted by hand in a browser: the
 * restoring state lasts a few hundred milliseconds and is not a thing a
 * screenshot reliably catches.
 */
test("a resume in flight says so, and offers nothing to press", async () => {
  // Never resolves: the pane is left in the phase it enters on mount.
  stubs.resumeTask.mockReturnValue(new Promise(() => {}));

  await act(async () => {
    render(<AgentPane taskId={TASK_ID} visible />);
  });

  await screen.findByText("Suspended — resuming…");
  // Nothing to press while it is working — a second Reopen would race the
  // first, and the ladder is not idempotent.
  expect(screen.queryByRole("button", { name: "Reopen" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
});

test("a task suspended out from under the view offers the way back", async () => {
  stubs.tasks = [task({ lifecycle: "live", ptyId: "pty-1" })];

  const view = await act(async () => render(<AgentPane taskId={TASK_ID} visible />));
  expect(screen.queryByText("Suspended")).toBeNull();

  // Harvested, or closed from another client. The phase never left "live", so
  // this is the plain resting state and not the tail of a reopen.
  stubs.tasks = [task({ lifecycle: "suspended", ptyId: null })];
  await act(async () => {
    view.rerender(<AgentPane taskId={TASK_ID} visible />);
  });

  await screen.findByText("Suspended");
  expect(screen.getByRole("button", { name: "Reopen" })).toBeDefined();
});
