import { test, expect, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import type { ILink } from "@xterm/xterm";
import type { TaskInfo } from "../../../../lib/xtmux/types";
import type { BacklogResponse } from "../../../../types/backlog";
import type { TabState } from "../../../layout-store";

/**
 * Task-id links reaching the grid (TASK-86, AC #4).
 *
 * The registration itself lives in `XTerminal` and needs a real xterm, which
 * needs geometry happy-dom does not have — so the grid is stubbed and what is
 * pinned here is the wiring either side of it: that a Backlog.md repository
 * hands both terminal panes a provider, that a repository without one hands
 * them nothing (AC #3), and that activating a link opens the task's file as a
 * permanent tab. The matcher's own rules are in `backlog-links.test.ts`, where
 * they need no DOM at all.
 */

const stubs = vi.hoisted(() => ({
  tasks: [] as TaskInfo[],
  backlog: undefined as BacklogResponse | undefined,
  /** Every `XTerminal` rendered, in order, with the props it was given. */
  terminals: [] as Array<Record<string, unknown>>,
  /** One entry per `focus()` the pane asked its grid for. */
  focuses: 0,
}));

vi.mock("@/frontend/TaskContext", () => ({
  useTasks: () => ({ tasks: stubs.tasks, resumeTask: vi.fn() }),
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
vi.mock("@/frontend/hooks/use-backlog", () => ({
  useBacklog: () => ({ data: stubs.backlog }),
}));
vi.mock("@/frontend/Terminal", () => ({
  // Through `forwardRef` with a handle, because a pane reaches its grid by ref
  // and a plain function stub silently drops it — leaving a focus test that
  // passes for the wrong reason.
  XTerminal: forwardRef((props: Record<string, unknown>, ref) => {
    stubs.terminals.push(props);
    // The whole `TerminalHandle`, not only the method under test: the panes
    // call `resetAttached` on attach and a partial handle turns a `?.` that
    // used to be a harmless no-op into a TypeError.
    useImperativeHandle(ref, () => ({
      handleMessage: () => {},
      send: () => {},
      getSize: () => null,
      resetAttached: () => {},
      beginRestore: () => {},
      paintSnapshot: () => {},
      endRestore: () => {},
      getSearchAddon: () => null,
      focus: () => {
        stubs.focuses += 1;
      },
    }));
    return null;
  }),
}));

const { TabPane } = await import("./TabPane");

const TASK_ID = "task-1";
const TASK_PATH = "backlog/tasks/task-82 - x.md";

function task(overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    id: TASK_ID,
    projectId: "general",
    ptyId: "pty-1",
    shellPtyIds: [],
    title: "a task",
    titleSource: "derived",
    terminalTitle: "",
    agentState: "idle",
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
    exited: false,
    hasNotification: false,
    worktreeState: "none",
    wipPending: false,
    worktree: null,
    ...overrides,
  };
}

function tab(descriptor: TabState["descriptor"]): TabState {
  return { id: "t", key: "agent", descriptor, preview: false };
}

/** A grid holding one line, which is all a provider reads. */
function terminalWith(line: string) {
  return {
    buffer: {
      active: {
        getLine: (y: number) => (y === 0 ? { translateToString: () => line } : undefined),
      },
    },
  };
}

const DETECTED: BacklogResponse = {
  detected: true,
  prefix: "TASK",
  statuses: ["To Do", "Done"],
  tasks: [
    {
      id: "TASK-82",
      title: "x",
      status: "To Do",
      ordinal: 82000,
      priority: null,
      labels: [],
      assignee: [],
      path: TASK_PATH,
    },
  ],
};

beforeEach(() => {
  stubs.tasks = [task()];
  stubs.backlog = undefined;
  stubs.terminals = [];
  stubs.focuses = 0;
});

function renderPane(descriptor: TabState["descriptor"], onOpenTab = vi.fn()) {
  act(() => {
    render(
      <TabPane
        taskId={TASK_ID}
        tab={tab(descriptor)}
        visible
        onOpenTab={onOpenTab}
        onSubmitReview={() => true}
      />,
    );
  });
  const props = stubs.terminals.at(-1);
  expect(props).toBeDefined();
  return { props: props!, onOpenTab };
}

test("in a Backlog.md repository the agent's terminal links known ids to their files", () => {
  stubs.backlog = DETECTED;
  const { props, onOpenTab } = renderPane({ kind: "agent" });

  const factory = props.linkProvider as ((term: unknown) => {
    provideLinks(y: number, cb: (links: ILink[] | undefined) => void): void;
  }) | undefined;
  expect(typeof factory).toBe("function");

  const provider = factory!(terminalWith("filed TASK-82 and TASK-8"));
  let links: ILink[] | undefined;
  provider.provideLinks(1, (result) => {
    links = result;
  });

  // TASK-8 is not in the list, and would not be matched inside TASK-82 anyway.
  expect(links?.length).toBe(1);
  expect(links![0]!.text).toBe("TASK-82");

  links![0]!.activate(new MouseEvent("click"), "TASK-82");
  // Permanent, not preview: following a link is the user asking for that file
  // by name.
  expect(onOpenTab).toHaveBeenCalledWith({ kind: "file", path: TASK_PATH });
});

test("outside a Backlog.md repository no provider is registered", () => {
  stubs.backlog = { detected: false };
  const { props } = renderPane({ kind: "agent" });
  expect(props.linkProvider).toBeUndefined();
});

test("a shell tab gets the same provider — it runs the same CLI", () => {
  stubs.backlog = DETECTED;
  const { props } = renderPane({ kind: "shell", ptyId: "pty-2" });
  expect(typeof props.linkProvider).toBe("function");
  expect(props.ptyId).toBe("pty-2");
});

// ── the caret follows a keyboard navigation (TASK-34) ───────────────────────

/** Renders a pane and hands back a way to re-render it with a new request. */
function renderFocusable(descriptor: TabState["descriptor"]) {
  const draw = (focusRequest: number) => (
    <TabPane
      taskId={TASK_ID}
      tab={tab(descriptor)}
      visible
      focusRequest={focusRequest}
      onOpenTab={vi.fn()}
      onSubmitReview={() => true}
    />
  );
  const view = render(draw(0));
  return (focusRequest: number) => act(() => view.rerender(draw(focusRequest)));
}

test("a rising focus request puts the caret in the agent's terminal", () => {
  const pulse = renderFocusable({ kind: "agent" });
  expect(stubs.focuses).toBe(0);
  pulse(1);
  expect(stubs.focuses).toBe(1);
});

test("a shell tab takes the caret the same way", () => {
  const pulse = renderFocusable({ kind: "shell", ptyId: "pty-2" });
  pulse(1);
  expect(stubs.focuses).toBe(1);
});

test("the same pane can be asked twice — ⌘K ] round a two-tab strip", () => {
  const pulse = renderFocusable({ kind: "agent" });
  pulse(1);
  pulse(2);
  expect(stubs.focuses).toBe(2);
});

test("dropping to zero is a pane being told it is no longer the one in front", () => {
  const pulse = renderFocusable({ kind: "agent" });
  pulse(1);
  pulse(0);
  // The falling edge must not focus: that pane has just lost the caret to
  // another, and taking it back is the bug.
  expect(stubs.focuses).toBe(1);
});
