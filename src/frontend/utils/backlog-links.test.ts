import { test, expect } from "bun:test";
import type { BacklogResponse } from "../../types/backlog";
import {
  createBacklogLinkProvider,
  findBacklogLinks,
  indexBacklog,
  type BacklogLinkIndex,
} from "./backlog-links";
import type { ILink } from "@xterm/xterm";

/**
 * The matcher behind task-id links in a terminal (TASK-86).
 *
 * Everything here is the rule set from AC #2 — the prefix comes from the route,
 * a whole word is a whole word, an id nobody has filed is not a link — pinned
 * without a grid, which is the reason this module has no DOM in it.
 */

function index(prefix: string, entries: Record<string, string>): BacklogLinkIndex {
  return { prefix, paths: new Map(Object.entries(entries)) };
}

const TASKS = index("TASK", {
  "TASK-8": "backlog/tasks/task-8 - Eight.md",
  "TASK-82": "backlog/tasks/task-82 - Eighty-two.md",
});

test("the prefix is the index's, not a hard-coded name", () => {
  const bugs = index("BUG", { "BUG-3": "backlog/tasks/bug-3 - Three.md" });
  expect(findBacklogLinks("fixed BUG-3", bugs).map((m) => m.id)).toEqual(["BUG-3"]);
  // A repository whose prefix is BUG has no TASK ids, however task-shaped the
  // text looks.
  expect(findBacklogLinks("fixed TASK-3", bugs)).toEqual([]);
});

test("TASK-8 is not matched inside TASK-82", () => {
  const [link, ...rest] = findBacklogLinks("closing TASK-82", TASKS);
  expect(rest).toEqual([]);
  expect(link?.id).toBe("TASK-82");
  expect(link?.path).toBe("backlog/tasks/task-82 - Eighty-two.md");
});

test("a word character or dash on either side is not a boundary", () => {
  expect(findBacklogLinks("xTASK-8", TASKS)).toEqual([]);
  expect(findBacklogLinks("TASK-8a", TASKS)).toEqual([]);
  expect(findBacklogLinks("PRETASK-8", TASKS)).toEqual([]);
  expect(findBacklogLinks("TASK-8-2", TASKS)).toEqual([]);
});

test("the punctuation an agent actually writes around an id still matches", () => {
  for (const line of ["(TASK-82)", "TASK-82,", "TASK-82.", "see TASK-82: done", "[TASK-82]"]) {
    expect(findBacklogLinks(line, TASKS).map((m) => m.id)).toEqual(["TASK-82"]);
  }
});

test("lowercase is matched and looked up uppercased", () => {
  const [link] = findBacklogLinks("filed task-82", TASKS);
  // The id is reported as it appeared — that is what the grid is showing.
  expect(link?.id).toBe("task-82");
  expect(link?.path).toBe("backlog/tasks/task-82 - Eighty-two.md");
});

test("an id the list does not know is not a link", () => {
  expect(findBacklogLinks("filed TASK-999", TASKS)).toEqual([]);
});

test("several ids on one line come back with their own offsets", () => {
  const line = "filed TASK-82 and TASK-8 today";
  const links = findBacklogLinks(line, TASKS);
  expect(links.map((m) => m.id)).toEqual(["TASK-82", "TASK-8"]);
  for (const link of links) {
    expect(line.slice(link.start, link.end)).toBe(link.id);
  }
  expect(links[0]!.start).toBe(6);
  expect(links[0]!.end).toBe(13);
});

test("a sub-id is part of the id rather than a trailing full stop", () => {
  const subs = index("TASK", { "TASK-82.1": "backlog/tasks/task-82.1 - Sub.md" });
  expect(findBacklogLinks("split into TASK-82.1.", subs).map((m) => m.id)).toEqual(["TASK-82.1"]);
});

test("indexBacklog is null outside a Backlog.md repository", () => {
  expect(indexBacklog({ detected: false })).toBeNull();
  expect(indexBacklog(undefined)).toBeNull();
});

test("indexBacklog keys the list by uppercased id", () => {
  const data: BacklogResponse = {
    detected: true,
    prefix: "TASK",
    statuses: ["To Do", "Done"],
    tasks: [
      {
        id: "TASK-82",
        title: "Eighty-two",
        status: "To Do",
        ordinal: 82000,
        priority: null,
        labels: [],
        assignee: [],
        path: "backlog/tasks/task-82 - Eighty-two.md",
      },
    ],
  };
  const built = indexBacklog(data);
  expect(built?.prefix).toBe("TASK");
  expect(built?.paths.get("TASK-82")).toBe("backlog/tasks/task-82 - Eighty-two.md");
});

// ── the provider ────────────────────────────────────────────────────────────

function buffer(...lines: string[]) {
  return {
    buffer: {
      active: {
        getLine: (y: number) =>
          lines[y] === undefined ? undefined : { translateToString: () => lines[y]! },
      },
    },
  };
}

function provide(provider: ReturnType<typeof createBacklogLinkProvider>, y: number) {
  let links: ILink[] | undefined;
  provider.provideLinks(y, (result) => {
    links = result;
  });
  return links;
}

test("the provider maps a line to 1-based inclusive ranges, and activates", () => {
  const opened: string[] = [];
  const provider = createBacklogLinkProvider(
    buffer("filed TASK-82 and TASK-8"),
    () => TASKS,
    (path) => opened.push(path),
  );

  const links = provide(provider, 1);
  expect(links?.length).toBe(2);
  // "TASK-82" occupies 0-based [6, 13); xterm columns are 1-based with an
  // inclusive end, so that is cols 7 through 13 on row 1.
  expect(links![0]!.range).toEqual({ start: { x: 7, y: 1 }, end: { x: 13, y: 1 } });
  expect(links![0]!.text).toBe("TASK-82");
  expect(links![0]!.decorations).toEqual({ pointerCursor: true, underline: true });

  // No DOM in this runner, and the handler does not read the event: activation
  // is a plain click and the link already knows which path it stands for.
  links![0]!.activate({} as MouseEvent, "TASK-82");
  expect(opened).toEqual(["backlog/tasks/task-82 - Eighty-two.md"]);
});

test("the provider offers nothing without an index", () => {
  const provider = createBacklogLinkProvider(buffer("filed TASK-82"), () => null, () => {});
  expect(provide(provider, 1)).toBeUndefined();
});

test("the provider reads the index afresh, so a poll's result is honoured", () => {
  // The registration outlives the list: `useBacklog` polls, and a task filed
  // after the terminal mounted has to become a link without re-registering.
  let current: BacklogLinkIndex | null = index("TASK", {});
  const provider = createBacklogLinkProvider(buffer("filed TASK-82"), () => current, () => {});
  expect(provide(provider, 1)).toBeUndefined();

  current = TASKS;
  expect(provide(provider, 1)?.map((link) => link.text)).toEqual(["TASK-82"]);
});

test("a line the buffer does not have offers nothing", () => {
  const provider = createBacklogLinkProvider(buffer("filed TASK-82"), () => TASKS, () => {});
  expect(provide(provider, 9)).toBeUndefined();
});
