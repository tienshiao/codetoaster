import { test, expect, describe, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { applyMigrations } from "../db";
import { TaskStore, type NewTask } from "./store";

let db: Database;
let store: TaskStore;

beforeEach(() => {
  db = new Database(":memory:");
  applyMigrations(db);
  store = new TaskStore(db);
});

function seed(overrides: Partial<NewTask> = {}): NewTask {
  return {
    id: crypto.randomUUID(),
    project_id: "general",
    title: "Fix the parser",
    initial_prompt: "fix the parser",
    repo_root: "/repo",
    cwd: "/repo",
    ...overrides,
  };
}

describe("create", () => {
  test("returns the inserted row", () => {
    const row = store.create(seed({ id: "t1", title: "Rename things" }));
    expect(row.id).toBe("t1");
    expect(row.title).toBe("Rename things");
    expect(row.repo_root).toBe("/repo");
  });

  test("a task starts live, starting, unpinned, with no worktree", () => {
    const row = store.create(seed({ id: "t1" }));
    expect(row.lifecycle).toBe("live");
    expect(row.agent_state).toBe("starting");
    expect(row.worktree_state).toBe("none");
    expect(row.title_source).toBe("derived");
    expect(row.pinned).toBe(0);
    expect(row.worktree_path).toBeNull();
    expect(row.exit_code).toBeNull();
  });

  test("a new task is the most recent thing that happened", () => {
    const row = store.create(seed({ id: "t1", created_at: 1000 }));
    expect(row.created_at).toBe(1000);
    expect(row.last_active_at).toBe(1000);
    expect(row.rank_at).toBe(1000);
  });

  // TASK-116: the sort key starts where the age stamp does, so a task created
  // with a back-dated last_active_at ranks by it rather than by now.
  test("rank_at defaults to last_active_at, and an explicit one wins", () => {
    expect(store.create(seed({ id: "t1", created_at: 10, last_active_at: 50 })).rank_at).toBe(50);
    expect(store.create(seed({ id: "t2", last_active_at: 50, rank_at: 7 })).rank_at).toBe(7);
  });

  test("explicit values win over the defaults", () => {
    const row = store.create(seed({
      id: "t1",
      title_source: "manual",
      lifecycle: "suspended",
      agent_state: "idle",
      worktree_state: "present",
      worktree_path: "/wt/t1",
      branch: "feature",
      base_ref: "main",
      model: "opus",
      permission_mode: "acceptEdits",
      pinned: true,
      created_at: 10,
      last_active_at: 99,
    }));
    expect(row.title_source).toBe("manual");
    expect(row.lifecycle).toBe("suspended");
    expect(row.agent_state).toBe("idle");
    expect(row.worktree_path).toBe("/wt/t1");
    expect(row.branch).toBe("feature");
    expect(row.base_ref).toBe("main");
    expect(row.model).toBe("opus");
    expect(row.permission_mode).toBe("acceptEdits");
    expect(row.pinned).toBe(1);
    expect(row.last_active_at).toBe(99);
  });

  // TASK-89: which agent the task runs on. A column and not a lookup, because
  // a resume months from now has to render the argv the conversation was
  // opened with — whatever the project's default has become since.
  test("a task with no profile named runs on claude", () => {
    expect(store.create(seed({ id: "t1" })).agent_profile).toBe("claude");
  });

  test("the profile round-trips through the row", () => {
    expect(store.create(seed({ id: "t1", agent_profile: "pi" })).agent_profile).toBe("pi");
    expect(store.get("t1")!.agent_profile).toBe("pi");
    // And is updatable, which is what a task moved onto another agent needs.
    expect(store.update("t1", { agent_profile: "shell" })!.agent_profile).toBe("shell");
  });

  test("a duplicate id is rejected", () => {
    store.create(seed({ id: "t1" }));
    expect(() => store.create(seed({ id: "t1" }))).toThrow();
  });
});

describe("get", () => {
  test("returns the row, or undefined when there is none", () => {
    store.create(seed({ id: "t1" }));
    expect(store.get("t1")?.id).toBe("t1");
    expect(store.get("nope")).toBeUndefined();
  });
});

describe("list", () => {
  beforeEach(() => {
    store.create(seed({ id: "old", last_active_at: 100, lifecycle: "live" }));
    store.create(seed({ id: "newest", last_active_at: 300, lifecycle: "suspended" }));
    store.create(seed({ id: "middle", last_active_at: 200, lifecycle: "archived" }));
  });

  test("is ordered by rank, most recent first", () => {
    expect(store.list().map((t) => t.id)).toEqual(["newest", "middle", "old"]);
  });

  // TASK-116: a task that has been busy all along keeps its place even though
  // its last_active_at is newer than everything above it.
  test("rank_at decides the order over last_active_at", () => {
    store.update("old", { last_active_at: 900 });
    expect(store.list().map((t) => t.id)).toEqual(["newest", "middle", "old"]);
    store.update("old", { rank_at: 400 });
    expect(store.list().map((t) => t.id)).toEqual(["old", "newest", "middle"]);
  });

  // Only immutable keys break a tie, matching the client's stable sort on
  // rankAt alone — a tie that fell to the age stamp would flip on each
  // snapshot as the two tasks' ages leapfrogged.
  test("a rank tie falls to created_at, whatever last_active_at says", () => {
    store.update("old", { rank_at: 300, created_at: 20 });
    store.update("newest", { created_at: 10 });
    store.update("old", { last_active_at: 250 });
    expect(store.list().map((t) => t.id)).toEqual(["old", "newest", "middle"]);
    store.update("old", { last_active_at: 350 });
    expect(store.list().map((t) => t.id)).toEqual(["old", "newest", "middle"]);
    store.update("newest", { created_at: 30 });
    expect(store.list().map((t) => t.id)).toEqual(["newest", "old", "middle"]);
  });

  test("includes archived tasks when no filter is given", () => {
    expect(store.list().map((t) => t.id)).toContain("middle");
  });

  test("filters to one lifecycle", () => {
    expect(store.list({ lifecycle: "live" }).map((t) => t.id)).toEqual(["old"]);
  });

  test("filters to several, still in recency order", () => {
    expect(store.list({ lifecycle: ["live", "suspended"] }).map((t) => t.id))
      .toEqual(["newest", "old"]);
  });

  test("an empty lifecycle list matches nothing rather than everything", () => {
    expect(store.list({ lifecycle: [] })).toEqual([]);
  });

  test("is empty on a fresh database", () => {
    const empty = new TaskStore((() => { const d = new Database(":memory:"); applyMigrations(d); return d; })());
    expect(empty.list()).toEqual([]);
  });
});

describe("update", () => {
  beforeEach(() => {
    store.create(seed({ id: "t1", title: "Original", model: "opus", last_active_at: 100 }));
  });

  test("touches only the columns it was given", () => {
    const row = store.update("t1", { title: "Renamed" })!;
    expect(row.title).toBe("Renamed");
    expect(row.model).toBe("opus");
    expect(row.last_active_at).toBe(100);
  });

  test("undefined leaves a column alone; null clears it", () => {
    const row = store.update("t1", { title: undefined, model: null })!;
    expect(row.title).toBe("Original");
    expect(row.model).toBeNull();
  });

  test("an empty update is a no-op that still returns the row", () => {
    expect(store.update("t1", {})!.title).toBe("Original");
  });

  test("returns undefined for a task that isn't there", () => {
    expect(store.update("nope", { title: "x" })).toBeUndefined();
  });

  test("moves a task through its lifecycle", () => {
    store.update("t1", { lifecycle: "suspended", agent_state: "exited", exit_code: 0 });
    const row = store.get("t1")!;
    expect(row.lifecycle).toBe("suspended");
    expect(row.agent_state).toBe("exited");
    expect(row.exit_code).toBe(0);
  });

  // The SET clause is built from caller-supplied keys, and a key reaches SQL
  // as an identifier rather than a bound parameter.
  test("refuses a column name that isn't one of ours", () => {
    expect(() => store.update("t1", { "title = 'x' --": "y" } as any))
      .toThrow(/Not an updatable task column/);
    expect(() => store.update("t1", { id: "t2" } as any)).toThrow();
    expect(store.get("t1")!.title).toBe("Original");
  });
});

describe("delete", () => {
  test("removes the row and reports whether it did", () => {
    store.create(seed({ id: "t1" }));
    expect(store.delete("t1")).toBe(true);
    expect(store.get("t1")).toBeUndefined();
    expect(store.delete("t1")).toBe(false);
  });

  test("leaves the other tasks alone", () => {
    store.create(seed({ id: "t1" }));
    store.create(seed({ id: "t2" }));
    store.delete("t1");
    expect(store.list().map((t) => t.id)).toEqual(["t2"]);
  });
});
