import { test, expect, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import type { LoadSample } from "@/lib/xtmux/types";
import type { SocketSubscriber } from "@/frontend/pty-router";

/**
 * The rail meter, fed the way the app feeds it (TASK-149): frames into the task
 * store's one socket subscriber, through the load store, out of the meter —
 * live, with no reload in between.
 */

const stubs = vi.hoisted(() => ({ subscriber: null as SocketSubscriber | null }));

vi.mock("@/frontend/PtyContext", () => ({
  usePty: () => ({
    isConnected: true,
    send: vi.fn(),
    subscribe: (subscriber: SocketSubscriber) => {
      stubs.subscriber = subscriber;
      return () => {
        stubs.subscriber = null;
      };
    },
  }),
}));
vi.mock("@/frontend/hooks/use-notification-sound", () => ({ playNotificationSound: vi.fn() }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

const { TaskProvider } = await import("@/frontend/TaskContext");
const { SystemLoad } = await import("./SystemLoad");

const sample = (at: number, cpu: number): LoadSample => ({ at, cpu, load: [1, 1, 1], cores: 4 });

test("the history on connect, then each tick, then a dash when the socket drops", () => {
  render(
    <TaskProvider>
      <SystemLoad />
    </TaskProvider>,
  );
  const meter = screen.getByRole("meter", { name: "System load" });
  expect(meter.textContent).toBe("–");

  act(() =>
    stubs.subscriber!.onMessage!({
      type: "loadHistory",
      intervalMs: 2_000,
      capacity: 300,
      samples: [sample(1_000, 12), sample(3_000, 17)],
    }),
  );
  expect(meter.textContent).toBe("17%");

  act(() => stubs.subscriber!.onMessage!({ type: "load", sample: sample(5_000, 91) }));
  expect(meter.textContent).toBe("91%");
  expect(meter.getAttribute("aria-valuetext")).toBe("CPU 91%, high");

  // A stale figure shown as live is worse than none; the reconnect's history
  // puts it back.
  act(() => stubs.subscriber!.onDisconnect!());
  expect(meter.textContent).toBe("–");
});
