import { test, expect } from "bun:test";
import type { BacklogTask } from "@/types/backlog";
import {
  dateKey,
  defaultBacklogSort,
  groupBacklog,
  matchesBacklogFilter,
  resolveBacklogSort,
  sortBacklogTasks,
} from "./backlog-list";

function task(
  id: string,
  fields: Partial<Omit<BacklogTask, "id">> = {},
): BacklogTask {
  return {
    id,
    title: `title of ${id}`,
    status: "To Do",
    ordinal: null,
    priority: null,
    labels: [],
    assignee: [],
    path: `backlog/tasks/${id.toLowerCase()}.md`,
    description: "",
    createdDate: null,
    updatedDate: null,
    dependencies: [],
    parent: null,
    acceptance: { done: 0, total: 0 },
    ...fields,
  };
}

const ids = (tasks: BacklogTask[]) => tasks.map((t) => t.id);

// ── filter ──────────────────────────────────────────────────────────────────

test("the filter matches id, title, labels and description, ignoring case", () => {
  const t = task("TASK-117", {
    title: "Oversized diffs freeze the page",
    labels: ["frontend"],
    description: "A 44 MB single-line file",
  });
  expect(matchesBacklogFilter(t, "task-117")).toBe(true);
  expect(matchesBacklogFilter(t, "FREEZE")).toBe(true);
  expect(matchesBacklogFilter(t, "Frontend")).toBe(true);
  expect(matchesBacklogFilter(t, "single-line")).toBe(true);
  expect(matchesBacklogFilter(t, "backend")).toBe(false);
});

test("every word has to match, though not in the same field", () => {
  const t = task("TASK-117", { title: "Oversized diffs freeze the page", labels: ["frontend"] });
  expect(matchesBacklogFilter(t, "117 frontend")).toBe(true);
  expect(matchesBacklogFilter(t, "diff   freeze")).toBe(true);
  expect(matchesBacklogFilter(t, "diff backend")).toBe(false);
});

test("an empty or blank filter keeps everything", () => {
  expect(matchesBacklogFilter(task("TASK-1"), "")).toBe(true);
  expect(matchesBacklogFilter(task("TASK-1"), "   ")).toBe(true);
});

// ── dates ───────────────────────────────────────────────────────────────────

test("dates compare as text once padded, a bare date sorting as midnight", () => {
  expect(dateKey("2026-09-26 16:33")).toBe("2026-09-26 16:33");
  expect(dateKey("2026-09-26")).toBe("2026-09-26 00:00");
  expect(dateKey("2026-9-6 7:05")).toBe("2026-09-06 07:05");
  expect(dateKey(null)).toBeNull();
  expect(dateKey("")).toBeNull();
  expect(dateKey("yesterday")).toBeNull();
  expect(dateKey("2026-09-06")! < dateKey("2026-09-26 00:01")!).toBe(true);
});

// ── sorts ───────────────────────────────────────────────────────────────────

test("board order is the input order", () => {
  const tasks = [task("TASK-3"), task("TASK-1"), task("TASK-2")];
  expect(ids(sortBacklogTasks(tasks, "board"))).toEqual(["TASK-3", "TASK-1", "TASK-2"]);
});

test("recently updated puts the last touched first", () => {
  const tasks = [
    task("TASK-1", { createdDate: "2026-09-01", updatedDate: "2026-09-20 10:00" }),
    task("TASK-2", { createdDate: "2026-09-02", updatedDate: "2026-09-26 09:00" }),
    task("TASK-3", { createdDate: "2026-09-03", updatedDate: "2026-09-25" }),
  ];
  expect(ids(sortBacklogTasks(tasks, "updated"))).toEqual(["TASK-2", "TASK-3", "TASK-1"]);
});

test("a task never updated sorts by its created date", () => {
  const tasks = [
    task("TASK-1", { createdDate: "2026-09-01", updatedDate: "2026-09-10" }),
    task("TASK-2", { createdDate: "2026-09-15" }),
    task("TASK-3", { createdDate: "2026-09-05", updatedDate: "2026-09-20" }),
  ];
  expect(ids(sortBacklogTasks(tasks, "updated"))).toEqual(["TASK-3", "TASK-2", "TASK-1"]);
});

test("a task with no dates at all goes last under both date sorts", () => {
  const tasks = [
    task("TASK-1"),
    task("TASK-2", { createdDate: "2026-09-01" }),
    task("TASK-3", { createdDate: "garbled" }),
    task("TASK-4", { createdDate: "2026-09-02" }),
  ];
  expect(ids(sortBacklogTasks(tasks, "updated"))).toEqual(["TASK-4", "TASK-2", "TASK-1", "TASK-3"]);
  expect(ids(sortBacklogTasks(tasks, "created"))).toEqual(["TASK-4", "TASK-2", "TASK-1", "TASK-3"]);
});

test("recently created ignores the updated date", () => {
  const tasks = [
    task("TASK-1", { createdDate: "2026-09-01", updatedDate: "2026-09-30" }),
    task("TASK-2", { createdDate: "2026-09-10" }),
  ];
  expect(ids(sortBacklogTasks(tasks, "created"))).toEqual(["TASK-2", "TASK-1"]);
});

test("ties keep board order, so a poll never reshuffles them", () => {
  const same = { createdDate: "2026-09-26 10:00" };
  const tasks = [task("TASK-9", same), task("TASK-2", same), task("TASK-5", same)];
  expect(ids(sortBacklogTasks(tasks, "updated"))).toEqual(["TASK-9", "TASK-2", "TASK-5"]);
  expect(ids(sortBacklogTasks(tasks, "created"))).toEqual(["TASK-9", "TASK-2", "TASK-5"]);
});

test("the id sort is numeric and newest first, a subtask after its parent", () => {
  const tasks = [task("TASK-99"), task("TASK-100"), task("TASK-12.2"), task("TASK-12"), task("TASK-12.10")];
  expect(ids(sortBacklogTasks(tasks, "id"))).toEqual([
    "TASK-100",
    "TASK-99",
    "TASK-12.10",
    "TASK-12.2",
    "TASK-12",
  ]);
});

test("sorting does not touch its input", () => {
  const tasks = [task("TASK-1"), task("TASK-2")];
  sortBacklogTasks(tasks, "id");
  expect(ids(tasks)).toEqual(["TASK-1", "TASK-2"]);
});

// ── per-tab defaults ────────────────────────────────────────────────────────

test("Closed defaults to recently updated and Open to board order", () => {
  expect(defaultBacklogSort("Closed")).toBe("updated");
  expect(defaultBacklogSort("Open")).toBe("board");
});

test("a stored sort wins, and an unknown one falls back to the tab's default", () => {
  expect(resolveBacklogSort("Closed", "id")).toBe("id");
  expect(resolveBacklogSort("Open", "created")).toBe("created");
  expect(resolveBacklogSort("Closed", null)).toBe("updated");
  expect(resolveBacklogSort("Open", null)).toBe("board");
  expect(resolveBacklogSort("Closed", "priority")).toBe("updated");
  expect(resolveBacklogSort("Open", 3)).toBe("board");
});

// ── grouping ────────────────────────────────────────────────────────────────

const STATUSES = ["To Do", "In Progress", "Done"];

/** Board order, as the route hands it over. */
const TASKS = [
  task("TASK-10", { status: "To Do", title: "first todo", createdDate: "2026-09-01" }),
  task("TASK-11", { status: "To Do", title: "second todo", createdDate: "2026-09-05" }),
  task("TASK-12", { status: "In Progress", title: "in flight", labels: ["frontend"] }),
  task("TASK-13", { status: "Done", title: "shipped long ago", updatedDate: "2026-08-01" }),
  task("TASK-14", { status: "Done", title: "shipped today", updatedDate: "2026-09-26 16:00" }),
  task("TASK-15", { status: "Done", title: "never edited", createdDate: "2026-09-10" }),
  task("TASK-16", { status: "Blocked", title: "typo'd status" }),
];

const data = { statuses: STATUSES, tasks: TASKS };

test("with no view, grouping keeps board order and every task", () => {
  const g = groupBacklog(data);
  expect(g.open.map((s) => [s.status, ids(s.tasks)])).toEqual([
    ["In Progress", ["TASK-12"]],
    ["To Do", ["TASK-10", "TASK-11"]],
    ["Blocked", ["TASK-16"]],
  ]);
  expect(ids(g.closed[0]!.tasks)).toEqual(["TASK-13", "TASK-14", "TASK-15"]);
  expect([g.openCount, g.closedCount]).toEqual([4, 3]);
});

test("with the default sorts, the most recently finished task heads Closed", () => {
  const g = groupBacklog(data, {
    filter: "",
    openSort: defaultBacklogSort("Open"),
    closedSort: defaultBacklogSort("Closed"),
  });
  expect(ids(g.closed[0]!.tasks)).toEqual(["TASK-14", "TASK-15", "TASK-13"]);
  expect(ids(g.open.find((s) => s.status === "To Do")!.tasks)).toEqual(["TASK-10", "TASK-11"]);
});

test("Open keeps its status headers under any sort, sorting within each", () => {
  const g = groupBacklog(data, { filter: "", openSort: "created", closedSort: "board" });
  expect(g.open.map((s) => s.status)).toEqual(["In Progress", "To Do", "Blocked"]);
  expect(g.open.every((s) => s.header)).toBe(true);
  expect(ids(g.open.find((s) => s.status === "To Do")!.tasks)).toEqual(["TASK-11", "TASK-10"]);
});

test("the filter narrows both tabs and the counts follow it", () => {
  const g = groupBacklog(data, { filter: "SHIPPED", openSort: "board", closedSort: "board" });
  expect(g.open).toEqual([]);
  expect(ids(g.closed[0]!.tasks)).toEqual(["TASK-13", "TASK-14"]);
  expect([g.openCount, g.closedCount]).toEqual([0, 2]);
});

test("a status the filter empties loses its header", () => {
  const g = groupBacklog(data, { filter: "frontend", openSort: "board", closedSort: "board" });
  expect(g.open.map((s) => s.status)).toEqual(["In Progress"]);
  expect(g.closed).toEqual([]);
  expect([g.openCount, g.closedCount]).toEqual([1, 0]);
});

test("clearing the filter brings every task back", () => {
  const view = { openSort: "board", closedSort: "board" } as const;
  expect(groupBacklog(data, { ...view, filter: "frontend" }).openCount).toBe(1);
  const g = groupBacklog(data, { ...view, filter: "" });
  expect([g.openCount, g.closedCount]).toEqual([4, 3]);
});
