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
      ["tasks", "t1", "dir-children"],
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

  test("each root id named gets the same keys — a project root beside its task (TASK-106)", () => {
    const keys = invalidationsFor(changed(["src/a.ts"], true), ["t1", "project:web"]);
    const forId = (id: string) => invalidationsFor({ ...changed(["src/a.ts"], true), taskId: id });
    expect(keys).toEqual([...forId("t1"), ...forId("project:web")]);
    expect(keys).toContainEqual(["tasks", "project:web", "file", "src/a.ts"]);
    expect(keys).toContainEqual(["git-refs", "project:web"]);
  });

  test("without root ids it names only the task the frame names", () => {
    expect(invalidationsFor(changed(null, false))).toEqual(
      invalidationsFor(changed(null, false), ["t1"]),
    );
    expect(invalidationsFor(changed(null, false), [])).toEqual([]);
  });
});

/**
 * Ignored paths (TASK-130). The frame names them apart from `files` because
 * the expensive views never show them; what does is a tab on the file, and the
 * tree where its directory has been opened.
 */
describe("invalidationsFor, ignored paths", () => {
  const listed = (dirs: string[], files: string[] = []) => ({ dirs, files: new Set(files) });
  const listing = (dirs: string[] | undefined, files: string[] = []) => () =>
    dirs && listed(dirs, files);

  test("a write under a listed ignored directory stales the file and that directory's children, and nothing else", () => {
    // A build, with `dist` already in the tree. The listing shows `dist` as one
    // entry whatever is inside it, so there is nothing in it to refetch — and
    // the diff and the search never read the directory at all.
    const message = { ...changed([], false), ignored: ["dist/a.js", "dist/b.js", "dist/deep/c.js"] };
    expect(invalidationsFor(message, ["t1"], listing(["dist"]))).toEqual([
      ["tasks", "t1", "file", "dist/a.js"],
      ["tasks", "t1", "file", "dist/b.js"],
      ["tasks", "t1", "file", "dist/deep/c.js"],
      ["tasks", "t1", "dir-children", "dist"],
      ["tasks", "t1", "dir-children", "dist/deep"],
    ]);
  });

  test("an ignored path the listing does not already cover stales the listing and the search", () => {
    // `.env` written for the first time, or `dist/` by the first build: the
    // entry itself is what is new.
    const message = { ...changed([], false), ignored: [".env", "dist/a.js"] };
    expect(invalidationsFor(message, ["t1"], listing([]))).toEqual([
      ["tasks", "t1", "file", ".env"],
      ["tasks", "t1", "file", "dist/a.js"],
      ["tasks", "t1", "dir-children", "dist"],
      ["tasks", "t1", "files"],
      ["tasks", "t1", "files-search"],
    ]);
  });

  test("a write to a listed ignored file stales that file alone", () => {
    // A log a dev server appends to, once a second. The listing already holds
    // the file, and refetching it per write is two git processes and a stat
    // of every file, for each visible terminal.
    const message = { ...changed([], false), ignored: ["server.log"] };
    expect(invalidationsFor(message, ["t1"], listing([], ["server.log"]))).toEqual([
      ["tasks", "t1", "file", "server.log"],
    ]);
  });

  test("a listed ignored file that is gone stales the listing", () => {
    const message = { ...changed([], false), ignored: ["server.log"], gone: ["server.log"] };
    expect(invalidationsFor(message, ["t1"], listing([], ["server.log"]))).toEqual([
      ["tasks", "t1", "file", "server.log"],
      ["tasks", "t1", "files"],
      ["tasks", "t1", "files-search"],
    ]);
  });

  test("a file gone from under a listed ignored directory is that directory's business", () => {
    // `dist` is still one entry, with one file fewer inside it.
    const message = { ...changed([], false), ignored: ["dist/a.js"], gone: ["dist/a.js"] };
    expect(invalidationsFor(message, ["t1"], listing(["dist"]))).toEqual([
      ["tasks", "t1", "file", "dist/a.js"],
      ["tasks", "t1", "dir-children", "dist"],
    ]);
  });

  test("the listed directory itself is not covered by being listed", () => {
    // An event on `dist` is as likely its removal as anything else.
    const message = { ...changed([], false), ignored: ["dist"] };
    expect(invalidationsFor(message, ["t1"], listing(["dist"]))).toContainEqual(["tasks", "t1", "files"]);
  });

  test("with no listing to consult, the listing is staled", () => {
    // Nothing cached means nothing refetches; a listing that is cached but was
    // not handed over is the case to be wrong on the safe side of.
    const message = { ...changed([], false), ignored: ["dist/a.js"] };
    expect(invalidationsFor(message)).toContainEqual(["tasks", "t1", "files"]);
    expect(invalidationsFor(message, ["t1"], listing(undefined))).toContainEqual(["tasks", "t1", "files"]);
  });

  test("an ignored-only batch never stales the diff, the symbols or the backlog", () => {
    const message = { ...changed([], false), ignored: [".env", "dist/a.js"] };
    const flat = JSON.stringify(invalidationsFor(message, ["t1"], listing([])));
    expect(flat).not.toContain('"diff"');
    expect(flat).not.toContain("symbol");
    expect(flat).not.toContain("backlog");
  });

  test("beside ordinary files, the listing is named once", () => {
    const message = { ...changed(["src/a.ts"], false), ignored: [".env"] };
    const keys = invalidationsFor(message, ["t1"], listing([]));
    expect(keys.filter((k) => JSON.stringify(k) === '["tasks","t1","files"]')).toHaveLength(1);
    expect(keys).toContainEqual(["tasks", "t1", "file", ".env"]);
    expect(keys).toContainEqual(["tasks", "t1", "diff"]);
  });

  test("an overflow stales every open directory by prefix", () => {
    expect(invalidationsFor(changed(null, false))).toContainEqual(["tasks", "t1", "dir-children"]);
  });

  test("each root is asked about its own listing", () => {
    // A task with no worktree shares its tree with the project root, but the
    // two caches are fetched separately and one can hold a listing the other
    // does not.
    const message = { ...changed([], false), ignored: ["dist/a.js"] };
    const keys = invalidationsFor(message, ["t1", "project:web"], (id) =>
      listed(id === "t1" ? ["dist"] : []),
    );
    expect(keys).not.toContainEqual(["tasks", "t1", "files"]);
    expect(keys).toContainEqual(["tasks", "project:web", "files"]);
  });
});
