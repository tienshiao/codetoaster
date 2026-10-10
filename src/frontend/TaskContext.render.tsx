import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
import type { ServerMessage, TaskInfo } from "../lib/xtmux/types";
import type { SocketSubscriber } from "./pty-router";

/**
 * What the store does with a `notification` frame (§4.2).
 *
 * This is the one piece of behaviour that moved rather than being written here
 * — it lived in v1's `SessionContext` until TASK-28 deleted the adapter — and
 * the failure mode of a move like that is silence: nothing type-checks
 * differently when a sound stops playing. So the three branches are pinned
 * here, against a socket this file drives by hand.
 *
 * Vitest's, not `bun test`'s: it needs a mounted provider and a `document` to
 * ask about focus. See CLAUDE.md, "Testing".
 */

const stubs = vi.hoisted(() => ({
  send: vi.fn(),
  playNotificationSound: vi.fn(),
  subscriber: null as SocketSubscriber | null,
  toastError: vi.fn(),
}));

vi.mock("./PtyContext", () => ({
  usePty: () => ({
    isConnected: true,
    send: stubs.send,
    subscribe: (subscriber: SocketSubscriber) => {
      stubs.subscriber = subscriber;
      return () => {
        stubs.subscriber = null;
      };
    },
  }),
}));
vi.mock("./hooks/use-notification-sound", () => ({
  playNotificationSound: stubs.playNotificationSound,
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: stubs.toastError }) }));

const { TaskProvider, useTasks } = await import("./TaskContext");

function task(id: string, overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    id,
    projectId: "general",
    ptyId: `${id}-pty`,
    shellPtyIds: [],
    title: `${id} · main`,
    titleSource: "derived",
    terminalTitle: "",
    agentState: "idle",
    profile: "claude",
    hooks: true,
    restarted: false,
    lifecycle: "live",
    cwd: "/Users/someone/projects/app",
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
    ...overrides,
  };
}

/** Says which task is on screen the way `TaskShell` does, and nothing else. */
function Viewing({ taskId }: { taskId: string | null }) {
  const { setViewedTask } = useTasks();
  setViewedTask(taskId);
  return null;
}

function deliver(message: ServerMessage) {
  act(() => {
    stubs.subscriber?.onMessage?.(message);
  });
}

const notification = (taskId: string): ServerMessage => ({
  type: "notification",
  taskId,
  title: "Claude needs your attention",
  body: "May I edit src/index.ts?",
});

let notifications: Array<{ title: string; options?: NotificationOptions }>;
let hasFocus: boolean;

beforeEach(() => {
  stubs.send.mockReset();
  stubs.playNotificationSound.mockReset();
  stubs.toastError.mockReset();
  stubs.subscriber = null;
  hasFocus = true;
  vi.spyOn(document, "hasFocus").mockImplementation(() => hasFocus);

  notifications = [];
  // Happy DOM has no Notification API, so the desktop half is stubbed rather
  // than asserted through a real one — what matters is that it is reached with
  // the right text, not that a browser drew it.
  class FakeNotification {
    static permission: NotificationPermission = "granted";
    static requestPermission = vi.fn();
    close = vi.fn();
    constructor(title: string, options?: NotificationOptions) {
      notifications.push({ title, options });
    }
  }
  vi.stubGlobal("Notification", FakeNotification);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * The dot, where lifecycle and agent state disagree.
 *
 * `agent_state` is frozen at whatever the agent was doing when the process was
 * put down, and neither suspending nor archiving clears it — so this is the
 * only thing standing between the archived list and a row pulsing "busy" for a
 * process that died a month ago.
 */
test("lifecycle wins over a frozen agent state", async () => {
  const { taskStateOf } = await import("./TaskContext");
  expect(taskStateOf({ lifecycle: "archived", agentState: "busy" })).toBe("exited");
  expect(taskStateOf({ lifecycle: "suspended", agentState: "busy" })).toBe("suspended");
  // And does not win where there is no disagreement to settle.
  expect(taskStateOf({ lifecycle: "live", agentState: "busy" })).toBe("busy");
  expect(taskStateOf({ lifecycle: "live", agentState: "needs_attention" })).toBe("attention");
});

/**
 * The list this store keeps is `listTasks`'s — live and suspended — and an
 * archived row belongs to the fetched list instead.
 *
 * The trap is timing, not classification: archiving a task emits deltas from
 * the suspend, the eviction and the dying PTY's exit callback, and any one of
 * them landing after the archive's snapshot would put the row back. It then
 * shows twice, once here as an ordinary row and once in the archived list.
 */
test("a delta for an archived task takes the row out rather than putting it back", () => {
  let ids: string[] = [];
  function Watch() {
    ids = useTasks().tasks.map((t) => t.id);
    return null;
  }
  render(
    <TaskProvider>
      <Watch />
    </TaskProvider>,
  );

  deliver({ type: "tasks", list: [task("t1"), task("t2")], projects: [] });
  expect(ids).toEqual(["t1", "t2"]);

  deliver({ type: "task", task: task("t1", { lifecycle: "archived" }) });
  expect(ids).toEqual(["t2"]);

  // And one for a task this list never held is not inserted by the back door.
  deliver({ type: "task", task: task("t3", { lifecycle: "archived" }) });
  expect(ids).toEqual(["t2"]);

  // An ordinary delta still upserts, which is what makes the guard a guard
  // rather than a change of shape.
  deliver({ type: "task", task: task("t4") });
  expect(ids).toEqual(["t2", "t4"]);
});

/**
 * The list is `rank_at DESC`, and between snapshots the only things that say
 * so are a `task` delta and an `activity` stamp (TASK-101). The rank is apart
 * from the age stamp (TASK-116): an activity frame always carries the age, and
 * carries a rank only when the task woke after a real quiet gap. The client
 * applies the age on a falling edge or alongside a rank move, and nowhere else.
 *
 * A rendering test rather than a `task-list` one because what is being pinned
 * is the store's *application* of the sort — that both frames reach it, and
 * that the one carrying no rank leaves the order alone. `byRecency` itself is
 * covered as a function in `task-list.test.ts`.
 */
function renderList() {
  let rows: TaskInfo[] = [];
  function Watch() {
    rows = useTasks().tasks;
    return null;
  }
  render(
    <TaskProvider>
      <Watch />
    </TaskProvider>,
  );
  const ids = () => rows.map((t) => t.id);
  ids.rows = () => rows;
  return ids;
}

/** A row whose age and rank agree, which is every row until something pulls
 * them apart. */
const ranked = (id: string, at: number, overrides: Partial<TaskInfo> = {}) =>
  task(id, { lastActiveAt: at, rankAt: at, ...overrides });

test("a delta whose row is now the most recent moves it to the top", () => {
  const ids = renderList();
  deliver({
    type: "tasks",
    list: [ranked("t1", 30), ranked("t2", 20), ranked("t3", 10)],
    projects: [],
  });
  expect(ids()).toEqual(["t1", "t2", "t3"]);

  // One row, at its old index, carrying a rank fresher than the one the
  // snapshot gave it — what any row broadcast that follows a wake looks like:
  // a title change, a shell tab's rising edge, a hook transition landing after
  // one. Without the re-sort the list would still read t1, t2, t3.
  deliver({ type: "task", task: ranked("t3", 99, { agentState: "busy" }) });
  expect(ids()).toEqual(["t3", "t1", "t2"]);

  // A delta that does not change rank leaves the order alone — even one whose
  // age stamp is now the newest in the list (TASK-116).
  deliver({ type: "task", task: ranked("t1", 30, { lastActiveAt: 500, agentState: "busy" }) });
  expect(ids()).toEqual(["t3", "t1", "t2"]);
});

test("an activity frame with a rank moves the row without a row being sent", () => {
  const ids = renderList();
  deliver({
    type: "tasks",
    list: [ranked("t1", 30), ranked("t2", 20)],
    projects: [],
  });

  deliver({ type: "activity", taskId: "t2", active: true, at: 99, rankAt: 99 });
  expect(ids()).toEqual(["t2", "t1"]);
  expect(ids.rows()[0]).toMatchObject({ lastActiveAt: 99, rankAt: 99 });
});

test("a falling edge with only an age stamp updates the age and keeps the order", () => {
  // TASK-116: a busy agent's edges, several a minute. The age column follows
  // them — from the falling edge, when output stopped — and the list does not
  // move.
  const ids = renderList();
  deliver({
    type: "tasks",
    list: [ranked("t1", 30), ranked("t2", 20)],
    projects: [],
  });
  const before = ids.rows();

  deliver({ type: "activity", taskId: "t2", active: false, at: 120 });
  expect(ids()).toEqual(["t1", "t2"]);
  expect(ids.rows()[1]).toMatchObject({ lastActiveAt: 120, rankAt: 20 });
  // The row that did not change is the object it was.
  expect(ids.rows()[0]).toBe(before[0]);
});

test("a rising edge with only an age stamp leaves the rows as they were", () => {
  // Its stamp is 300ms from being overtaken by the falling edge's, so applying
  // it would be a new array and row per burst for an age nobody could read.
  const ids = renderList();
  deliver({
    type: "tasks",
    list: [ranked("t1", 30), ranked("t2", 20)],
    projects: [],
  });
  const before = ids.rows();

  deliver({ type: "activity", taskId: "t2", active: true, at: 99 });
  expect(ids.rows()).toBe(before);
});

test("an activity message with no stamp leaves the rows as they were", () => {
  // An older daemon. The dot still moves; the list does not guess a time it
  // was not given, and does not re-render for nothing.
  const ids = renderList();
  deliver({
    type: "tasks",
    list: [ranked("t1", 30), ranked("t2", 20)],
    projects: [],
  });
  const before = ids.rows();

  deliver({ type: "activity", taskId: "t2", active: true });
  expect(ids()).toEqual(["t1", "t2"]);
  expect(ids.rows()).toBe(before);
});

test("a notification for the task on screen is acknowledged, not rung", () => {
  render(
    <TaskProvider>
      <Viewing taskId="t1" />
    </TaskProvider>,
  );
  deliver({ type: "tasks", list: [task("t1")], projects: [] });

  deliver(notification("t1"));

  // `AgentPane` is showing whatever provoked this, so ringing would be telling
  // the user about something already on their screen.
  expect(stubs.send).toHaveBeenCalledWith({ type: "acknowledge", taskId: "t1" });
  expect(stubs.playNotificationSound).not.toHaveBeenCalled();
  expect(notifications).toHaveLength(0);
});

test("a notification for another task rings", () => {
  render(
    <TaskProvider>
      <Viewing taskId="t1" />
    </TaskProvider>,
  );
  deliver({ type: "tasks", list: [task("t1"), task("t2")], projects: [] });

  deliver(notification("t2"));

  expect(stubs.playNotificationSound).toHaveBeenCalledTimes(1);
  expect(stubs.send).not.toHaveBeenCalledWith({ type: "acknowledge", taskId: "t2" });
  // The window has focus, so the sound is the whole of it: a desktop
  // notification for a window the user is looking at is noise.
  expect(notifications).toHaveLength(0);
});

test("with the window in the background it reaches the desktop, named", () => {
  hasFocus = false;
  render(
    <TaskProvider>
      <Viewing taskId="t1" />
    </TaskProvider>,
  );
  deliver({
    type: "tasks",
    list: [task("t1", { terminalTitle: "Implementing the latch" })],
    projects: [],
  });

  // The task on screen, even — being on screen is no help when the window is
  // behind something else, which is the case the desktop notification exists
  // for. It is deliberately not an `else` of the acknowledge branch.
  deliver(notification("t1"));

  expect(stubs.send).not.toHaveBeenCalledWith({ type: "acknowledge", taskId: "t1" });
  expect(stubs.playNotificationSound).toHaveBeenCalledTimes(1);
  expect(notifications).toHaveLength(1);
  expect(notifications[0]!.title).toBe("Claude needs your attention");
  // The projected label and the stable name, so a notification arriving over
  // another app says which task wants you (naming.ts).
  expect(notifications[0]!.options?.body).toBe(
    "Implementing the latch — t1 · main\nMay I edit src/index.ts?",
  );
  expect(notifications[0]!.options?.tag).toBe("codetoaster-t1");
});

test("a user who has refused notifications is not asked again", () => {
  hasFocus = false;
  (Notification as unknown as { permission: string }).permission = "denied";
  render(<TaskProvider>{null}</TaskProvider>);
  deliver({ type: "tasks", list: [task("t1")], projects: [] });

  deliver(notification("t1"));

  // Asking on every notification is how a permission prompt becomes a
  // nuisance. The sound still plays; only the desktop half is withheld.
  expect(notifications).toHaveLength(0);
  expect(Notification.requestPermission).not.toHaveBeenCalled();
  expect(stubs.playNotificationSound).toHaveBeenCalledTimes(1);
});

/**
 * TASK-103: a `changed` frame reaches the query cache.
 *
 * `invalidationsFor` is tested as a function next door; what is pinned here is
 * the wiring — that the branch exists in `onMessage`, and that it hands the
 * keys to the shared `queryClient` rather than to a client of its own, which
 * would invalidate nothing anything is subscribed to.
 */
test("a changed frame invalidates the task's file, diff and search queries", async () => {
  const { queryClient } = await import("./query-client");
  const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
  render(<TaskProvider>{null}</TaskProvider>);

  deliver({ type: "changed", taskId: "t1", files: ["src/a.ts"], history: false });

  const keys = invalidate.mock.calls.map(([arg]) => arg?.queryKey);
  expect(keys).toEqual([
    ["tasks", "t1", "files"],
    ["tasks", "t1", "files-search"],
    ["tasks", "t1", "file", "src/a.ts"],
    ["tasks", "t1", "symbols"],
    ["tasks", "t1", "symbol-search"],
    ["tasks", "t1", "backlog"],
    ["tasks", "t1", "diff"],
  ]);
});

// TASK-130. The mapping takes the listed ignored directories as an argument;
// what is pinned here is that the argument is the shared cache's listing, under
// the key the Files tree fetches it by. A build writing into a `dist` the
// listing already holds must not refetch that listing.
test("a changed frame naming ignored paths is checked against the cached listing", async () => {
  const { queryClient } = await import("./query-client");
  queryClient.setQueryData(["tasks", "t1", "files"], {
    directory: "/repo",
    files: [{ path: "dist", name: "dist", isDirectory: true, depth: 0, ignored: true }],
  });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
  render(<TaskProvider>{null}</TaskProvider>);

  deliver({ type: "changed", taskId: "t1", files: [], history: false, ignored: ["dist/a.js"] });

  try {
    expect(invalidate.mock.calls.map(([arg]) => arg?.queryKey)).toEqual([
      ["tasks", "t1", "file", "dist/a.js"],
      ["tasks", "t1", "dir-children", "dist"],
    ]);
  } finally {
    queryClient.removeQueries({ queryKey: ["tasks", "t1", "files"] });
  }
});

// TASK-57. Where a mutation's failure is reported is decided once, in
// `request`: it toasts unless the caller says it is showing the message itself.
// The alternative — every caller doing its own reporting — is how the composer
// ended up saying the same thing twice.
test("a failed mutation is toasted, unless the caller renders it inline", async () => {
  let created: ReturnType<typeof useTasks>["createTask"];
  function Capture() {
    created = useTasks().createTask;
    return null;
  }
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ error: "spawn ENOENT" }), { status: 500 })),
  );
  render(
    <TaskProvider>
      <Capture />
    </TaskProvider>,
  );

  await act(async () => {
    await created!({ prompt: "no toast" }, { inline: true });
  });
  expect(stubs.toastError).not.toHaveBeenCalled();

  // The sidebar's New task button is the same mutation with nowhere to put a
  // message, and it must not fail in silence.
  await act(async () => {
    await created!({ prompt: "toast" });
  });
  expect(stubs.toastError).toHaveBeenCalledWith(
    "Could not start the task",
    expect.objectContaining({ description: "spawn ENOENT" }),
  );
});
