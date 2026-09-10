import { test, expect, describe } from "bun:test";
import { invalidationsFor } from "./change-invalidation";
import type { ServerMessage } from "../lib/xtmux/types";

/**
 * The client half of TASK-103, as a function (AC #7).
 *
 * The mapping is the whole of the client's decision-making — everything else
 * is a `for` loop in `TaskContext` — so it is pinned here, where no DOM, no
 * `QueryClient` and no socket are involved.
 */

type Changed = Extract<ServerMessage, { type: "changed" }>;

function changed(files: string[] | null, history: boolean): Changed {
  return { type: "changed", taskId: "t1", files, history };
}

describe("invalidationsFor", () => {
  test("named files stale the tree, the search, each file, the symbols, the backlog and the diff", () => {
    expect(invalidationsFor(changed(["src/a.ts", "README.md"], false))).toEqual([
      ["tasks", "t1", "files"],
      ["tasks", "t1", "files-search"],
      ["tasks", "t1", "file", "src/a.ts"],
      ["tasks", "t1", "file", "README.md"],
      ["tasks", "t1", "symbols"],
      ["tasks", "t1", "symbol-search"],
      ["tasks", "t1", "backlog"],
      ["tasks", "t1", "diff"],
    ]);
  });

  test("history stales the refs and the diff — not the log, and nothing keyed by sha", () => {
    const keys = invalidationsFor(changed([], true));
    expect(keys).toEqual([
      ["git-refs", "t1"],
      ["tasks", "t1", "diff"],
    ]);
    // The log is reset by `use-git-history` when the refs hash changes, which
    // any commit does. Invalidating it here as well would refetch every loaded
    // page only for that reset to discard them.
    const flat = JSON.stringify(keys);
    expect(flat).not.toContain("git-log");
    // The tree, the file-at-sha and the commit are keyed by a commit hash, and
    // a hash's content does not change. Re-fetching them on every commit would
    // be work with no possible new answer.
    expect(flat).not.toContain("git-tree");
    expect(flat).not.toContain("git-file");
    expect(flat).not.toContain("git-commit");
  });

  test("a batch that is both does not name the diff twice", () => {
    const keys = invalidationsFor(changed(["src/a.ts"], true));
    expect(keys).toEqual([
      ["tasks", "t1", "files"],
      ["tasks", "t1", "files-search"],
      ["tasks", "t1", "file", "src/a.ts"],
      ["tasks", "t1", "symbols"],
      ["tasks", "t1", "symbol-search"],
      ["tasks", "t1", "backlog"],
      ["git-refs", "t1"],
      ["tasks", "t1", "diff"],
    ]);
    expect(keys.filter((k) => JSON.stringify(k) === '["tasks","t1","diff"]')).toHaveLength(1);
  });

  test("a null file list invalidates every open file by prefix", () => {
    // What a checkout or an install produces: too many paths to be worth
    // listing, so the prefix stands in for all of them.
    expect(invalidationsFor(changed(null, false))).toEqual([
      ["tasks", "t1", "files"],
      ["tasks", "t1", "files-search"],
      ["tasks", "t1", "file"],
      ["tasks", "t1", "symbols"],
      ["tasks", "t1", "symbol-search"],
      ["tasks", "t1", "backlog"],
      ["tasks", "t1", "diff"],
    ]);
  });

  test("a batch that says nothing changed invalidates nothing", () => {
    // The watcher does not send this — it drops an empty flush — but the
    // mapping must not invent work from one if a future caller does.
    expect(invalidationsFor(changed([], false))).toEqual([]);
  });
});
