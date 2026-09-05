import { test, expect, describe } from "bun:test";
import {
  actionEntries,
  changeEntries,
  commitEntries,
  fileEntries,
  refEntries,
  tabEntries,
  taskEntries,
  type PaletteEntry,
  type PaletteTask,
} from "./palette-items";
import { createLayout, openTab, resetIdCounter, type TaskLayout } from "./layout-store";
import type { FileDiff } from "./types/diff";
import type { GitLogCommit, GitRefsResponse } from "./types/git";

/**
 * The palette's rows, as inputs and outputs.
 *
 * What is worth asserting here is the conditionality: which rows a state does
 * and does not earn. The drawing is `CommandPalette.render.tsx`'s problem, and
 * the two are separate files for the reason the whole split exists — none of
 * this needs a DOM.
 */

function task(overrides: Partial<PaletteTask> & Pick<PaletteTask, "id">): PaletteTask {
  return {
    projectId: "p1",
    title: "a task",
    lifecycle: "live",
    lastMessage: null,
    agentState: "idle",
    ...overrides,
  };
}

const labels = new Map<string, string>();
const projectNames = new Map([["p1", "codetoaster"]]);
const stateOf = () => "idle" as const;

function ids(entries: PaletteEntry[]): string[] {
  return entries.map((e) => e.id);
}

describe("tasks", () => {
  test("archived tasks are left out and the current one is marked", () => {
    const entries = taskEntries(
      [task({ id: "a" }), task({ id: "b", lifecycle: "archived" }), task({ id: "c" })],
      { labels, projectNames, currentTaskId: "c", stateOf },
    );

    expect(ids(entries)).toEqual(["task:a", "task:c"]);
    expect(entries[0]!.detail).toBe("codetoaster");
    expect(entries[1]!.detail).toBe("codetoaster · current");
  });

  test("the displayed label wins over the stored title, and the last message is searchable", () => {
    const entries = taskEntries([task({ id: "a", lastMessage: "renamed the parser" })], {
      labels: new Map([["a", "Fix the parser"]]),
      projectNames,
      stateOf,
    });

    expect(entries[0]!.label).toBe("Fix the parser");
    expect(entries[0]!.keywords).toEqual(["renamed the parser"]);
  });
});

describe("tabs", () => {
  test("the detail says what the strip's label could not, and nothing when it agrees", () => {
    resetIdCounter();
    let layout = createLayout();
    layout = openTab(layout, { kind: "file", path: "src/frontend/keymap.ts" });
    layout = openTab(layout, { kind: "file", path: "README.md" });
    layout = openTab(layout, { kind: "diffAll" });

    const entries = tabEntries(layout);
    const byLabel = new Map(entries.map((e) => [e.label, e]));

    // A basename is ambiguous, so the palette shows the path the strip hid.
    expect(byLabel.get("keymap.ts")!.detail).toBe("src/frontend/keymap.ts");
    // A file at the root is its own path, and repeating it would be noise.
    expect(byLabel.get("README.md")!.detail).toBeUndefined();
    // The fixed tabs have a description behind them, not an address, and a
    // gloss in the mono slot would read as an identifier that is not one.
    expect(byLabel.get("Changes")!.detail).toBeUndefined();
  });

  test("no layout, no tabs", () => {
    expect(tabEntries(null)).toEqual([]);
  });
});

describe("actions", () => {
  test("the composer offers only what a composer can do", () => {
    const entries = actionEntries({ task: null, layout: null, mac: true });

    expect(ids(entries)).toEqual([
      "action:new-task",
      "action:toggle-sidebar",
      "action:toggle-explorer",
    ]);
  });

  test("a live task can be closed but not resumed", () => {
    const entries = ids(actionEntries({ task: task({ id: "a" }), layout: null, mac: true }));

    expect(entries).toContain("action:close-task");
    expect(entries).not.toContain("action:resume-task");
    expect(entries).toContain("action:archive-task");
    expect(entries).toContain("action:new-shell");
  });

  test("a suspended task can be resumed but not closed", () => {
    const suspended = task({ id: "a", lifecycle: "suspended" });
    const entries = ids(actionEntries({ task: suspended, layout: null, mac: true }));

    expect(entries).toContain("action:resume-task");
    expect(entries).not.toContain("action:close-task");
  });

  test("a live task whose agent would not come back is offered Resume as well", () => {
    const stuck = task({ id: "a", agentState: "could_not_resume" });
    const entries = ids(actionEntries({ task: stuck, layout: null, mac: true }));

    expect(entries).toContain("action:resume-task");
    expect(entries).toContain("action:close-task");
  });

  test("an archived task is not offered to be archived again", () => {
    const archived = task({ id: "a", lifecycle: "archived" });
    const entries = ids(actionEntries({ task: archived, layout: null, mac: true }));

    expect(entries).not.toContain("action:archive-task");
  });

  test("jump-to-tab stops at the tabs there are", () => {
    resetIdCounter();
    let layout = createLayout();
    layout = openTab(layout, { kind: "diffAll" });
    layout = openTab(layout, { kind: "history" });

    const entries = ids(actionEntries({ task: task({ id: "a" }), layout, mac: true }));

    expect(entries).toContain("action:jump-tab-3");
    expect(entries).not.toContain("action:jump-tab-4");
  });

  test("split is offered only for a tab that can be split", () => {
    resetIdCounter();
    const agentOnly = createLayout();
    // The agent tab is a terminal, and a terminal is never split (§7.2).
    expect(ids(actionEntries({ task: task({ id: "a" }), layout: agentOnly, mac: true }))).not.toContain(
      "action:split",
    );

    const withDiff = openTab(agentOnly, { kind: "diffAll" });
    expect(ids(actionEntries({ task: task({ id: "a" }), layout: withDiff, mac: true }))).toContain(
      "action:split",
    );
  });

  test("split drops out entirely on a device that holds one group", () => {
    resetIdCounter();
    // A tab the palette would otherwise list Split for, so what this measures
    // is the device and not the tab kind (§9, risk 6).
    const layout = openTab(createLayout(), { kind: "diffAll" });
    const listed = (env?: { singleGroup?: boolean }) =>
      ids(actionEntries({ task: task({ id: "a" }), layout, env, mac: true }));

    expect(listed()).toContain("action:split");
    expect(listed({ singleGroup: true })).not.toContain("action:split");
    // Only that row: the phone still lists the rest of the map.
    expect(listed({ singleGroup: true })).toContain("action:close-tab");
    expect(listed({ singleGroup: true })).toContain("action:next-tab");
  });

  test("close-tab is not offered in front of the agent tab", () => {
    resetIdCounter();
    const agentOnly = createLayout();
    expect(ids(actionEntries({ task: task({ id: "a" }), layout: agentOnly, mac: true }))).not.toContain(
      "action:close-tab",
    );

    const withDiff = openTab(agentOnly, { kind: "diffAll" });
    expect(ids(actionEntries({ task: task({ id: "a" }), layout: withDiff, mac: true }))).toContain(
      "action:close-tab",
    );
  });

  test("the palette never lists itself", () => {
    resetIdCounter();
    const layout = openTab(createLayout(), { kind: "diffAll" });
    const everywhere = [
      actionEntries({ task: null, layout: null, mac: true }),
      actionEntries({ task: task({ id: "a" }), layout, mac: true }),
      actionEntries({ task: task({ id: "a", lifecycle: "suspended" }), layout, mac: false }),
    ].flatMap(ids);

    expect(everywhere).not.toContain("action:palette");
  });

  test("a chord row prints the platform's caps", () => {
    resetIdCounter();
    const layout = openTab(createLayout(), { kind: "diffAll" });
    const mac = actionEntries({ task: task({ id: "a" }), layout, mac: true });
    const other = actionEntries({ task: task({ id: "a" }), layout, mac: false });

    expect(mac.find((e) => e.id === "action:next-tab")!.keys).toEqual(["⌘", "K", "]"]);
    expect(other.find((e) => e.id === "action:next-tab")!.keys).toEqual(["Ctrl", "⇧", "K", "]"]);
  });

  test("Find in terminal is offered in front of a terminal tab (TASK-58)", () => {
    resetIdCounter();
    // A fresh layout is the agent tab, which is a terminal and so has a grid
    // to search.
    const agentOnly = createLayout();
    const entries = actionEntries({ task: task({ id: "a" }), layout: agentOnly, mac: true });

    expect(ids(entries)).toContain("action:search-terminal");
    expect(entries.find((e) => e.id === "action:search-terminal")!.keys).toEqual(["⌘", "F"]);
  });

  test("...and not in front of anything else, which has nothing to search", () => {
    resetIdCounter();
    // `openTab` focuses what it opens, so Changes is the active tab.
    const withDiff = openTab(createLayout(), { kind: "diffAll" });

    expect(ids(actionEntries({ task: task({ id: "a" }), layout: withDiff, mac: true }))).not.toContain(
      "action:search-terminal",
    );
  });

  test("the search row prints the platform's caps too", () => {
    resetIdCounter();
    const agentOnly = createLayout();
    const other = actionEntries({ task: task({ id: "a" }), layout: agentOnly, mac: false });

    expect(other.find((e) => e.id === "action:search-terminal")!.keys).toEqual(["Ctrl", "F"]);
  });
});

describe("the working tree, git and files", () => {
  const files: FileDiff[] = [
    { oldPath: "README.md", newPath: "README.md", hunks: [], additions: 1, deletions: 0 },
    {
      oldPath: "src/frontend/keymap.ts",
      newPath: "src/frontend/keymap.ts",
      hunks: [],
      additions: 3,
      deletions: 1,
    },
  ];

  test("a change names its basename, with the directory behind it", () => {
    const entries = changeEntries(files);

    expect(entries[1]!.label).toBe("keymap.ts");
    expect(entries[1]!.detail).toBe("src/frontend");
    expect(entries[1]!.keywords).toEqual(["src/frontend/keymap.ts"]);
    // Nothing to disambiguate a root-level file with, so no detail at all.
    expect(entries[0]!.detail).toBeUndefined();
  });

  test("commits are capped and abbreviated", () => {
    const commits: GitLogCommit[] = Array.from({ length: 40 }, (_, i) => ({
      hash: `${i}`.padStart(40, "a"),
      parents: [],
      refs: [],
      author: "T",
      email: "t@example.com",
      date: 0,
      subject: `commit ${i}`,
    }));

    const entries = commitEntries(commits);
    expect(entries).toHaveLength(30);
    expect(entries[0]!.detail).toBe("aaaaaaa");
    expect(commitEntries(commits, 2)).toHaveLength(2);
  });

  test("refs are branches then tags, and never remotes", () => {
    const refs: GitRefsResponse = {
      head: { ref: "v2", sha: "1".repeat(40) },
      branches: [{ name: "v2", sha: "1".repeat(40) }],
      remotes: [{ name: "origin/v2", sha: "1".repeat(40) }],
      tags: [{ name: "v0.1.0", sha: "2".repeat(40) }],
      hash: "h",
    };

    expect(ids(refEntries(refs))).toEqual(["ref:v2", "tag:v0.1.0"]);
    expect(refEntries(undefined)).toEqual([]);
  });

  test("file results are drawn whatever the query, and labelled by path", () => {
    const entries = fileEntries([
      { path: "src/frontend/index.html", name: "index.html", indices: [] },
    ]);

    expect(entries[0]!.label).toBe("src/frontend/index.html");
    expect(entries[0]!.forceMount).toBe(true);
    expect(entries[0]!.action).toEqual({
      type: "open-tab",
      descriptor: { kind: "file", path: "src/frontend/index.html" },
    });
  });
});

test("no two rows share an id, across every builder at once", () => {
  resetIdCounter();
  let layout: TaskLayout = createLayout();
  layout = openTab(layout, { kind: "diffAll" });
  layout = openTab(layout, { kind: "file", path: "src/frontend/keymap.ts" });
  layout = openTab(layout, { kind: "commit", sha: "b".repeat(40) });

  const all = [
    ...taskEntries([task({ id: "a" }), task({ id: "b" })], {
      labels,
      projectNames,
      currentTaskId: "a",
      stateOf,
    }),
    ...tabEntries(layout),
    ...actionEntries({ task: task({ id: "a" }), layout, mac: true }),
    ...changeEntries([
      { oldPath: "src/a.ts", newPath: "src/a.ts", hunks: [], additions: 0, deletions: 0 },
    ]),
    ...commitEntries([
      {
        hash: "b".repeat(40),
        parents: [],
        refs: [],
        author: "T",
        email: "t@example.com",
        date: 0,
        subject: "a commit",
      },
    ]),
    ...refEntries({
      head: { ref: "v2", sha: "b".repeat(40) },
      // The same name under both, which git allows and a shared `ref:` prefix
      // would collapse into one row.
      branches: [{ name: "v2", sha: "b".repeat(40) }],
      remotes: [],
      tags: [{ name: "v2", sha: "c".repeat(40) }],
      hash: "h",
    }),
    ...fileEntries([{ path: "src/a.ts", name: "a.ts", indices: [] }]),
  ];

  expect(new Set(ids(all)).size).toBe(all.length);
});
