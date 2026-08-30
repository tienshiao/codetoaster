import { test, expect } from "bun:test";
import {
  groupByProject,
  selectTasks,
  taskMatchesFilter,
  type ListableTask,
} from "./task-list";

function task(id: string, overrides: Partial<ListableTask> = {}): ListableTask {
  return {
    id,
    projectId: "general",
    lifecycle: "live",
    lastMessage: null,
    ...overrides,
  };
}

const NO_NAMES = new Map<string, string>();

test("an empty filter keeps every row, in the order it arrived", () => {
  const tasks = [task("c"), task("a"), task("b")];
  const kept = selectTasks(tasks, { labels: NO_NAMES, projectNames: NO_NAMES });
  expect(kept.map((t) => t.id)).toEqual(["c", "a", "b"]);
});

test("the filter matches the displayed label, not the stored title", () => {
  // The whole point of matching on the projection: this task's stored title is
  // "codetoaster · v2" and nothing the user can see says so.
  const labels = new Map([["t1", "Fix the parser"]]);
  const kept = selectTasks([task("t1")], {
    labels,
    projectNames: NO_NAMES,
    filter: "parser",
  });
  expect(kept.map((t) => t.id)).toEqual(["t1"]);
});

test("the filter matches the project name and the last message too", () => {
  const tasks = [
    task("t1", { projectId: "web" }),
    task("t2", { projectId: "api", lastMessage: "Rebased onto main." }),
    task("t3", { projectId: "api" }),
  ];
  const projectNames = new Map([
    ["web", "Website"],
    ["api", "API"],
  ]);
  const options = { labels: NO_NAMES, projectNames };

  expect(selectTasks(tasks, { ...options, filter: "website" }).map((t) => t.id)).toEqual(["t1"]);
  expect(selectTasks(tasks, { ...options, filter: "rebased" }).map((t) => t.id)).toEqual(["t2"]);
});

test("the filter is case- and whitespace-insensitive", () => {
  const labels = new Map([["t1", "Fix The Parser"]]);
  const kept = selectTasks([task("t1")], {
    labels,
    projectNames: NO_NAMES,
    filter: "  PARSER ",
  });
  expect(kept).toHaveLength(1);
});

test("archived rows are hidden unless the toggle is on", () => {
  const tasks = [task("live"), task("gone", { lifecycle: "archived" })];
  const options = { labels: NO_NAMES, projectNames: NO_NAMES };

  expect(selectTasks(tasks, options).map((t) => t.id)).toEqual(["live"]);
  expect(selectTasks(tasks, { ...options, showArchived: true }).map((t) => t.id)).toEqual([
    "live",
    "gone",
  ]);
});

test("suspended rows are ordinary rows — the archived toggle does not touch them", () => {
  const tasks = [task("resting", { lifecycle: "suspended" })];
  expect(selectTasks(tasks, { labels: NO_NAMES, projectNames: NO_NAMES })).toHaveLength(1);
});

test("archived rows still have to clear the filter", () => {
  const labels = new Map([["gone", "Old experiment"]]);
  const kept = selectTasks([task("gone", { lifecycle: "archived" })], {
    labels,
    projectNames: NO_NAMES,
    showArchived: true,
    filter: "parser",
  });
  expect(kept).toHaveLength(0);
});

test("taskMatchesFilter is total on an empty needle", () => {
  expect(taskMatchesFilter(task("t1"), "", "", "")).toBe(true);
});

test("grouping keys off projectId and orders groups by first appearance", () => {
  const tasks = [
    task("t1", { projectId: "api" }),
    task("t2", { projectId: "web" }),
    task("t3", { projectId: "api" }),
  ];
  const groups = groupByProject(
    tasks,
    new Map([
      ["web", "Website"],
      ["api", "API"],
    ]),
  );
  expect(groups.map((g) => [g.id, g.name, g.tasks.map((t) => t.id)])).toEqual([
    ["api", "API", ["t1", "t3"]],
    ["web", "Website", ["t2"]],
  ]);
});

test("a task whose project is gone still lists, headed by the raw id", () => {
  const groups = groupByProject([task("t1", { projectId: "deleted" })], NO_NAMES);
  expect(groups).toEqual([{ id: "deleted", name: "deleted", tasks: [task("t1", { projectId: "deleted" })] }]);
});

test("a project with no tasks gets a group, after the ones that have some", () => {
  const groups = groupByProject(
    [task("t1", { projectId: "api" })],
    new Map([
      ["api", "API"],
      ["fresh", "Just created"],
    ]),
    ["api", "fresh"],
  );
  expect(groups.map((g) => [g.name, g.tasks.length])).toEqual([
    ["API", 1],
    ["Just created", 0],
  ]);
});

test("grouping preserves recency order inside a group", () => {
  const tasks = [task("newest"), task("older"), task("oldest")];
  const [group] = groupByProject(tasks, NO_NAMES);
  expect(group!.tasks.map((t) => t.id)).toEqual(["newest", "older", "oldest"]);
});
