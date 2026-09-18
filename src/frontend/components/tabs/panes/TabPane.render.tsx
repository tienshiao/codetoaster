import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import type { ILink } from "@xterm/xterm";
import type { TaskInfo } from "../../../../lib/xtmux/types";
import type { BacklogResponse } from "../../../../types/backlog";
import type { FilesResponse } from "../../../types/file";
import type { TabState } from "../../../layout-store";

/**
 * Task-id links (TASK-86, AC #4) and file-path links (TASK-108) reaching the
 * grid.
 *
 * The registration itself lives in `XTerminal` and needs a real xterm, which
 * needs geometry happy-dom does not have — so the grid is stubbed and what is
 * pinned here is the wiring either side of it: that a Backlog.md repository
 * hands both terminal panes a provider, that a repository without one hands
 * them nothing (AC #3), and that activating a link opens the task's file as a
 * permanent tab. The matcher's own rules are in `backlog-links.test.ts`, where
 * they need no DOM at all.
 */

/**
 * Enough of `SearchAddon` for the bar to mount against.
 *
 * It holds its listener and answers a search with a miss, because that is the
 * case the bar got wrong: `-1 / 0` is what it starts at, so a query matching
 * nothing changes no result state at all and only the query itself can make the
 * count say so.
 */
let searchListener: ((e: { resultIndex: number; resultCount: number }) => void) | undefined;
const MISS = { resultIndex: -1, resultCount: 0 };
/** How many times a bar stepped the addon, per direction. Which bar answers a
 * ⌘G is the whole question the chord tests at the bottom of this file ask. */
const steps = { next: 0, previous: 0 };
const searchAddon = {
  onDidChangeResults: (fn: (e: { resultIndex: number; resultCount: number }) => void) => {
    searchListener = fn;
    return {
      dispose() {
        searchListener = undefined;
      },
    };
  },
  findNext() {
    steps.next += 1;
    searchListener?.(MISS);
  },
  findPrevious() {
    steps.previous += 1;
    searchListener?.(MISS);
  },
  clearDecorations() {},
} as unknown as import("@xterm/addon-search").SearchAddon;

const stubs = vi.hoisted(() => ({
  tasks: [] as TaskInfo[],
  backlog: undefined as BacklogResponse | undefined,
  files: undefined as FilesResponse | undefined,
  /** The `enabled` the pane last asked `useTaskFiles` for. */
  filesEnabled: undefined as boolean | undefined,
  /** Every `XTerminal` rendered, in order, with the props it was given. */
  terminals: [] as Array<Record<string, unknown>>,
  /** One entry per `focus()` the pane asked its grid for. */
  focuses: 0,
  /** What the stub repository knows as commits: abbreviation → full sha. */
  commits: {} as Record<string, string>,
  /** One entry per `/git/commits` request, holding the shas it asked about. */
  commitAsks: [] as string[][],
}));

vi.mock("@/frontend/TaskContext", () => ({
  useTasks: () => ({
    tasks: stubs.tasks,
    taskById: (id: string) => stubs.tasks.find((t) => t.id === id),
    resumeTask: vi.fn(),
  }),
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
vi.mock("@/frontend/hooks/use-task-files", () => ({
  useTaskFiles: (_taskId: string, options?: { enabled?: boolean }) => {
    stubs.filesEnabled = options?.enabled ?? true;
    return { data: stubs.files };
  },
}));
// `AgentPane` reads the daemon's profile list for one label. It is a `useQuery`
// and nothing here mounts a query client — the whole point of the mocks above
// is that this file stands up terminal panes and nothing else.
vi.mock("@/frontend/hooks/use-profiles", () => ({
  useProfiles: () => ({ data: undefined }),
}));
// The one non-terminal pane rendered here, for the frame-focus test below. It
// is a git query and a commit list, neither of which is the subject, and both
// of which want a query client.
vi.mock("./HistoryPane", () => ({ HistoryPane: () => null }));
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
      // A stand-in for xterm's search addon: the bar only ever subscribes and
      // calls these, and a real one needs a grid happy-dom cannot give it.
      getSearchAddon: () => searchAddon,
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

/**
 * The one network call a pane makes on its own: commit links have no index to
 * match against, so the repository is asked (TASK-110). Stubbed for every test
 * in the file, not only the ones below — a pane that reached the real `fetch`
 * would be a test talking to whatever is listening on the port.
 */
const realFetch = globalThis.fetch;

beforeEach(() => {
  stubs.tasks = [task()];
  stubs.backlog = undefined;
  stubs.files = undefined;
  stubs.filesEnabled = undefined;
  stubs.terminals = [];
  stubs.focuses = 0;
  stubs.commits = {};
  stubs.commitAsks = [];
  searchListener = undefined;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const query = /\/git\/commits\?sha=([^&]*)/.exec(url);
    if (!query) throw new Error(`unexpected fetch: ${url}`);
    const shas = decodeURIComponent(query[1]!).split(",");
    stubs.commitAsks.push(shas);
    const commits = Object.fromEntries(
      shas.flatMap((sha) => (stubs.commits[sha] ? [[sha, stubs.commits[sha]!]] : [])),
    );
    return new Response(JSON.stringify({ commits }));
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
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

  const links = linksFor(props, "filed TASK-82 and TASK-8");

  // TASK-8 is not in the list, and would not be matched inside TASK-82 anyway.
  expect(links?.length).toBe(1);
  expect(links![0]!.text).toBe("TASK-82");

  links![0]!.activate(new MouseEvent("click"), "TASK-82");
  // Permanent, not preview: following a link is the user asking for that file
  // by name.
  expect(onOpenTab).toHaveBeenCalledWith({ kind: "file", path: TASK_PATH });
});

test("outside a Backlog.md repository the id provider is not registered (AC #3)", () => {
  // With no file list either, the commit provider is the only one left — it
  // needs no index (TASK-110) — so the count is the assertion, and the id
  // coming back unlinked is the point of it.
  stubs.backlog = { detected: false };
  const { props } = renderPane({ kind: "agent" });
  expect(providersOf(props)).toHaveLength(1);
  expect(linksFor(props, "filed TASK-82")).toBeUndefined();
});

test("a shell tab gets the same providers — it runs the same CLI", () => {
  stubs.backlog = DETECTED;
  const { props } = renderPane({ kind: "shell", ptyId: "pty-2" });
  expect(providersOf(props).length).toBeGreaterThan(1);
  expect(props.ptyId).toBe("pty-2");
});

// ── file paths (TASK-108) ───────────────────────────────────────────────────

const REPO = "/Users/someone/projects/app";

const FILES: FilesResponse = {
  directory: REPO,
  files: [
    { path: "src", name: "src", isDirectory: true, depth: 0 },
    { path: "src/main.ts", name: "main.ts", isDirectory: false, depth: 1 },
  ],
};

type Factory = (term: unknown) => {
  provideLinks(y: number, cb: (links: ILink[] | undefined) => void): void;
};

function providersOf(props: Record<string, unknown>): Factory[] {
  const factories = props.linkProviders as Factory[] | undefined;
  expect(Array.isArray(factories)).toBe(true);
  return factories!;
}

/**
 * Every link the grid would end up with for one row, from all of the pane's
 * providers in registration order.
 *
 * They are registered separately and xterm asks each in turn (TASK-110), so
 * gathering them here is what that side does — and the order the results come
 * back in is the priority order, which is why these tests assert on it.
 */
function linksFor(props: Record<string, unknown>, line: string) {
  const term = terminalWith(line);
  const links: ILink[] = [];
  for (const factory of providersOf(props)) {
    factory(term).provideLinks(1, (result) => {
      if (result) links.push(...result);
    });
  }
  return links.length > 0 ? links : undefined;
}

test("with the file list loaded, a path in the agent's terminal opens at its line", () => {
  stubs.files = FILES;
  const { props, onOpenTab } = renderPane({ kind: "agent" });

  const links = linksFor(props, "edited src/main.ts:42 and src/gone.ts");
  expect(links?.map((l) => l.text)).toEqual(["src/main.ts:42"]);

  links![0]!.activate(new MouseEvent("click"), "src/main.ts:42");
  expect(onOpenTab).toHaveBeenCalledWith({ kind: "file", path: "src/main.ts", line: 42 });
});

test("a path with no line opens the file without one", () => {
  stubs.files = FILES;
  const { props, onOpenTab } = renderPane({ kind: "shell", ptyId: "pty-2" });

  const links = linksFor(props, `cat ${REPO}/src/main.ts`);
  links![0]!.activate(new MouseEvent("click"), links![0]!.text);
  expect(onOpenTab).toHaveBeenCalledWith({ kind: "file", path: "src/main.ts" });
});

test("relative paths resolve against the task's cwd", () => {
  stubs.tasks = [task({ cwd: `${REPO}/src` })];
  stubs.files = FILES;
  const { props } = renderPane({ kind: "agent" });
  expect(linksFor(props, "see main.ts")?.map((l) => l.text)).toEqual(["main.ts"]);
});

test("in a Backlog.md repository both kinds of link reach the same grid", () => {
  stubs.backlog = DETECTED;
  stubs.files = FILES;
  const { props } = renderPane({ kind: "agent" });
  expect(linksFor(props, "TASK-82 touched src/main.ts")?.map((l) => l.text)).toEqual([
    "TASK-82",
    "src/main.ts",
  ]);
});

test("the registration survives a re-render", () => {
  // `XTerminal` re-registers whenever the list's identity changes, and now
  // re-registers *every* provider on it, so a list rebuilt per render would
  // churn the grid's providers three at a time.
  stubs.backlog = DETECTED;
  stubs.files = FILES;
  const view = render(
    <TabPane taskId={TASK_ID} tab={tab({ kind: "agent" })} visible onOpenTab={vi.fn()} onSubmitReview={() => true} />,
  );
  const first = stubs.terminals.at(-1)!.linkProviders;
  view.rerender(
    <TabPane taskId={TASK_ID} tab={tab({ kind: "agent" })} visible onOpenTab={vi.fn()} onSubmitReview={() => true} />,
  );
  expect(stubs.terminals.at(-1)!.linkProviders).toBe(first);
});

// ── names without their directory (TASK-109) ────────────────────────────────

const SHARED_NAMES: FilesResponse = {
  directory: REPO,
  files: [
    { path: "src/main.ts", name: "main.ts", isDirectory: false, depth: 1 },
    { path: "lib/util/main.ts", name: "main.ts", isDirectory: false, depth: 2 },
    { path: "src/ui/Composer.tsx", name: "Composer.tsx", isDirectory: false, depth: 2 },
  ],
};

test("a bare name one file has opens that file", () => {
  stubs.files = SHARED_NAMES;
  const { props, onOpenTab } = renderPane({ kind: "agent" });
  const [link] = linksFor(props, "edited Composer.tsx:7")!;
  act(() => link!.activate(new MouseEvent("click"), link!.text));
  expect(onOpenTab).toHaveBeenCalledWith({ kind: "file", path: "src/ui/Composer.tsx", line: 7 });
  expect(screen.queryByRole("menu")).toBeNull();
});

test("a bare name several files have offers them at the click, and opens the one chosen", () => {
  stubs.files = SHARED_NAMES;
  const { props, onOpenTab } = renderPane({ kind: "shell", ptyId: "pty-2" });
  const [link] = linksFor(props, "util/main.ts or main.ts:3")!.slice(1);
  act(() => link!.activate(new MouseEvent("click", { clientX: 40, clientY: 60 }), link!.text));

  expect(onOpenTab).not.toHaveBeenCalled();
  const menu = screen.getByRole("menu", { name: "Open file" });
  const rows = within(menu).getAllByRole("menuitem");
  // Shortest first.
  expect(rows.map((row) => row.textContent)).toEqual(["src/main.ts", "lib/util/main.ts"]);

  act(() => fireEvent.click(rows[1]!));
  expect(onOpenTab).toHaveBeenCalledWith({ kind: "file", path: "lib/util/main.ts", line: 3 });
  expect(screen.queryByRole("menu")).toBeNull();
});

test("Escape closes the chooser without opening anything", () => {
  stubs.files = SHARED_NAMES;
  const { props, onOpenTab } = renderPane({ kind: "agent" });
  const [link] = linksFor(props, "main.ts")!;
  act(() => link!.activate(new MouseEvent("click"), link!.text));
  const menu = screen.getByRole("menu");
  act(() => fireEvent.keyDown(menu, { key: "Escape" }));
  expect(screen.queryByRole("menu")).toBeNull();
  expect(onOpenTab).not.toHaveBeenCalled();
});

test("only a terminal on screen keeps the file list live", () => {
  // Every pane mounts the link hook; only a visible grid may make the listing
  // refetch on a change (TASK-103 AC #6). The rest read whatever is cached.
  const draw = (descriptor: TabState["descriptor"], visible: boolean) => (
    <TabPane taskId={TASK_ID} tab={tab(descriptor)} visible={visible} onOpenTab={vi.fn()} onSubmitReview={() => true} />
  );
  const view = render(draw({ kind: "agent" }, true));
  expect(stubs.filesEnabled).toBe(true);

  view.rerender(draw({ kind: "agent" }, false));
  expect(stubs.filesEnabled).toBe(false);

  view.rerender(draw({ kind: "history" }, true));
  expect(stubs.filesEnabled).toBe(false);
});

test("a hidden terminal keeps the links from the cached list", () => {
  stubs.files = FILES;
  render(
    <TabPane taskId={TASK_ID} tab={tab({ kind: "agent" })} visible={false} onOpenTab={vi.fn()} onSubmitReview={() => true} />,
  );
  expect(stubs.filesEnabled).toBe(false);
  expect(linksFor(stubs.terminals.at(-1)!, "src/main.ts")?.map((l) => l.text)).toEqual(["src/main.ts"]);
});

// ── commit hashes (TASK-110) ────────────────────────────────────────────────

const SHORT = "31976f6";
const FULL = "31976f69c26b2181b9e8bc402eff248db6435c88";

/** `linksFor`'s asynchronous twin: on a row holding a hash nobody has asked
 * about yet the commit provider answers only once the repository has, so its
 * links arrive a microtask after the other providers'. */
async function commitLinksFor(props: Record<string, unknown>, line: string) {
  const term = terminalWith(line);
  const links: ILink[] = [];
  await act(async () => {
    for (const factory of providersOf(props)) {
      factory(term).provideLinks(1, (result) => {
        if (result) links.push(...result);
      });
    }
  });
  return links.length > 0 ? links : undefined;
}

test("a hash the repository knows opens the commit, at its full sha", async () => {
  stubs.commits = { [SHORT]: FULL };
  const { props, onOpenTab } = renderPane({ kind: "agent" });

  const links = await commitLinksFor(props, `fixed in ${SHORT} today`);
  expect(links?.map((l) => l.text)).toEqual([SHORT]);

  act(() => links![0]!.activate(new MouseEvent("click"), links![0]!.text));
  // Permanent, like the other two links, and keyed on the whole hash so the
  // abbreviation and the full form share one tab.
  expect(onOpenTab).toHaveBeenCalledWith({ kind: "commit", sha: FULL });
});

test("a hex word the repository does not know is left alone", async () => {
  const { props } = renderPane({ kind: "shell", ptyId: "pty-2" });
  expect(await commitLinksFor(props, "took 1234567 ms")).toBeUndefined();
  // It was still asked about: only the repository can say (TASK-110).
  expect(stubs.commitAsks).toEqual([["1234567"]]);
});

test("an answered hash is never asked about twice", async () => {
  stubs.commits = { [SHORT]: FULL };
  const { props } = renderPane({ kind: "agent" });

  await commitLinksFor(props, `fixed in ${SHORT}`);
  const again = await commitLinksFor(props, `${SHORT} again, on another row`);

  expect(again?.map((l) => l.text)).toEqual([SHORT]);
  expect(stubs.commitAsks).toHaveLength(1);
});

test("all three kinds of link reach the same grid, in priority order", async () => {
  stubs.backlog = DETECTED;
  stubs.files = FILES;
  stubs.commits = { [SHORT]: FULL };
  const { props } = renderPane({ kind: "agent" });

  const links = await commitLinksFor(props, `TASK-82 touched src/main.ts in ${SHORT}`);
  expect(links?.map((l) => l.text)).toEqual(["TASK-82", "src/main.ts", SHORT]);
});

test("an unresolved hash does not hold up the links beside it", () => {
  // The whole reason the three are registered separately rather than combined.
  // xterm captures the hovered link on mousedown, so a task id sharing a row
  // with a hash nobody has asked about yet must be clickable at once — and must
  // still be there if that request is slow, or never answers at all. Read
  // synchronously, which is the state the grid is in at that moment.
  stubs.backlog = DETECTED;
  stubs.files = FILES;
  stubs.commits = { [SHORT]: FULL };
  const { props } = renderPane({ kind: "agent" });

  const links = linksFor(props, `${SHORT} TASK-82 touched src/main.ts`);
  expect(links?.map((l) => l.text)).toEqual(["TASK-82", "src/main.ts"]);
});

// ── the caret follows a keyboard navigation (TASK-34) ───────────────────────

/** Renders a pane and hands back a way to re-render it with a new request. */
function renderFocusable(descriptor: TabState["descriptor"], initial = 0) {
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
  const view = render(draw(initial));
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

test("a pane that mounts holding a request was mounted by it, and takes the caret", () => {
  // The shell clears a pulse after the commit it rose in (`TaskShell`), so a
  // non-zero number on mount is never one left standing by an old chord — it
  // is this commit's, and the pane it mounted is the one being addressed. A
  // baseline taken at mount was what left `⌘K ]` onto a diff tab with the
  // caret still in the PTY.
  const pulse = renderFocusable({ kind: "agent" }, 4);
  expect(stubs.focuses).toBe(1);
  // Still answers the next one.
  pulse(5);
  expect(stubs.focuses).toBe(2);
});

test("a non-terminal pane mounted by a chord takes the caret in its frame", () => {
  // `TabArea` mounts a diff or a history pane only while it is in front, so
  // the chord that puts it there mounts it in the same commit the pulse
  // rises in. The frame is what takes focus — DiffLayout's arrow keys stand
  // down while a textarea has focus, and without this they kept going to the
  // other group's terminal.
  render(
    <TabPane
      taskId={TASK_ID}
      tab={tab({ kind: "history" })}
      visible
      focusRequest={1}
      onOpenTab={vi.fn()}
      onSubmitReview={() => true}
    />,
  );
  const frame = document.activeElement as HTMLElement | null;
  expect(frame).not.toBeNull();
  expect(frame).not.toBe(document.body);
  expect(frame?.tabIndex).toBe(-1);
  // The grid was not asked: the pulse went to the frame around the pane.
  expect(stubs.focuses).toBe(0);
});

// ── search opens on a pulse and hands the caret back (TASK-58) ──────────────

/** Renders a pane and hands back a way to re-render it with a new search
 * request — `renderFocusable`'s twin, for the other pulse. */
function renderSearchable(descriptor: TabState["descriptor"], initial = 0) {
  const draw = (searchRequest: number) => (
    <TabPane
      taskId={TASK_ID}
      tab={tab(descriptor)}
      visible
      searchRequest={searchRequest}
      onOpenTab={vi.fn()}
      onSubmitReview={() => true}
    />
  );
  const view = render(draw(initial));
  return {
    pulse: (searchRequest: number) => act(() => view.rerender(draw(searchRequest))),
    bar: () => view.container.querySelector('[role="search"]'),
    type: (value: string) =>
      act(() => {
        fireEvent.change(
          view.container.querySelector<HTMLInputElement>('[aria-label="Search terminal"]')!,
          { target: { value } },
        );
      }),
    text: (value: string) => view.queryByText(value),
    close: () =>
      act(() => {
        view.container
          .querySelector<HTMLElement>('[aria-label="Close search"]')!
          .dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }),
  };
}

test("a rising search request opens the bar over the agent's terminal", () => {
  const pane = renderSearchable({ kind: "agent" });
  expect(pane.bar()).toBeNull();
  pane.pulse(1);
  expect(pane.bar()).not.toBeNull();
});

test("a shell tab gets its own bar the same way", () => {
  const pane = renderSearchable({ kind: "shell", ptyId: "pty-2" });
  pane.pulse(1);
  expect(pane.bar()).not.toBeNull();
});

test("closing the bar puts the caret back in the terminal", () => {
  const pane = renderSearchable({ kind: "agent" });
  pane.pulse(1);
  expect(stubs.focuses).toBe(0);

  pane.close();

  // AC #3: the bar goes, and the grid — not `<body>` — is what has focus after
  // it, so the next keystroke reaches the PTY the user never left.
  expect(pane.bar()).toBeNull();
  expect(stubs.focuses).toBe(1);
});

test("mounting with a search request is a rise too, by the same rule as focus", () => {
  // The shell clears the search pulse after its commit exactly as it does the
  // focus pulse, so a number on mount is this commit's and not one an old
  // press left standing.
  const pane = renderSearchable({ kind: "agent" }, 3);
  expect(pane.bar()).not.toBeNull();
});

test("dropping to zero is another pane being addressed, not this one closing", () => {
  const pane = renderSearchable({ kind: "agent" });
  pane.pulse(1);
  pane.pulse(0);
  expect(pane.bar()).not.toBeNull();
});

test("a query with no match says so, not nothing", () => {
  const pane = renderSearchable({ kind: "agent" });
  pane.pulse(1);
  // `-1 / 0` is where the counts already stood, so the miss changes none of
  // them: the query itself is what has to re-render the span.
  pane.type("zzz");
  expect(pane.text("No results")).not.toBeNull();
});

// ── ⌘G steps the active pane's matches, from wherever the caret is ──────────

/**
 * The chord is platform-gated (`isSearchChord`), and happy DOM leaves
 * `navigator.platform` as a bare "" — so without this every press below is a
 * bare ⌘G on a machine the keymap thinks is not a Mac, and matches nothing.
 */
beforeEach(() => {
  Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true });
  steps.next = 0;
  steps.previous = 0;
});

/**
 * An agent pane with its bar already open — mounting with a request is a rise,
 * as the test above pins — and its group's active flag set either way.
 *
 * With a query in the box, because the bar steps nothing without one: an empty
 * field has no match to be next of. The search that typing itself kicks off is
 * counted out again, so what the tests below count is the chord's doing alone.
 */
function renderWithBar(active: boolean) {
  const view = render(
    <TabPane
      taskId={TASK_ID}
      tab={tab({ kind: "agent" })}
      visible
      searchRequest={1}
      active={active}
      onOpenTab={vi.fn()}
      onSubmitReview={() => true}
    />,
  );
  const input = view.container.querySelector<HTMLInputElement>('[aria-label="Search terminal"]');
  expect(input).not.toBeNull();
  act(() => {
    fireEvent.change(input!, { target: { value: "needle" } });
  });
  steps.next = 0;
  steps.previous = 0;
  return view;
}

/** A ⌘G as the browser reports it, from wherever the caret happens to be. */
function pressStep(target: EventTarget) {
  const event = new KeyboardEvent("keydown", {
    key: "g",
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

test("⌘G from outside the pane steps the active pane's matches", () => {
  renderWithBar(true);

  // The Explorer, the tab strip, the body: anywhere that is not a terminal. The
  // bar was bound to its pane's root, so the chord it advertises on its own
  // buttons did nothing the moment the caret left the pane.
  const event = pressStep(document.body);

  expect(steps.next).toBe(1);
  expect(event.defaultPrevented).toBe(true);
});

test("⌘G from outside the pane does nothing for an inactive pane", () => {
  renderWithBar(false);

  // The other half of listening on the document: a split with two bars open
  // would otherwise step both terminals on one press, including the one the
  // user is not looking at.
  pressStep(document.body);

  expect(steps.next).toBe(0);
});

test("⌘G with the caret in another terminal pane is that pane's", () => {
  renderWithBar(true);

  // Standing in for the other half of a split, which the bar recognises by the
  // `data-terminal-pane` marker its own root carries: a press from in there
  // belongs to that pane's bar, active group or not.
  const other = document.createElement("div");
  other.setAttribute("data-terminal-pane", "");
  const textarea = document.createElement("textarea");
  other.appendChild(textarea);
  document.body.appendChild(other);

  pressStep(textarea);
  other.remove();

  expect(steps.next).toBe(0);
});

test("the terminal is told whether a bar is up, so it yields ⌃G to nobody", () => {
  // What the grid does with it is `terminalMustYield`'s: with no bar mounted the
  // step chord is the PTY's — off a Mac it is readline's abort — and swallowing
  // it for nobody was the bug.
  const pane = renderSearchable({ kind: "agent" });
  expect(stubs.terminals.at(-1)!.searchOpen).toBe(false);

  pane.pulse(1);
  expect(stubs.terminals.at(-1)!.searchOpen).toBe(true);
});
