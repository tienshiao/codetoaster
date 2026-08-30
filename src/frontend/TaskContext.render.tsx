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
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

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
