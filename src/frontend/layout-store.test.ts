import { test, expect } from "bun:test";
import {
  isTerminalTab,
  tabKey,
  descriptorFromKey,
  resetIdCounter,
  createLayout,
  findTab,
  findByKey,
  activeGroup,
  activeTab,
  allTabs,
  openTab,
  pinTab,
  closeTab,
  focusTab,
  canSplit,
  splitTab,
  moveTab,
  setGroupFlex,
  pruneShellTabs,
  reconcileShellTabs,
  reviveLayout,
  loadLayout,
  saveLayout,
  clearLayout,
  retainLayouts,
} from "./layout-store";
import type { TabDescriptor, TabGroup, TaskLayout } from "./layout-store";

// ── descriptor factories ────────────────────────────────────────────────────

const agent: TabDescriptor = { kind: "agent" };
const diffAll: TabDescriptor = { kind: "diffAll" };
const history: TabDescriptor = { kind: "history" };
const shell = (ptyId: string): TabDescriptor => ({ kind: "shell", ptyId });
const diff = (path: string): TabDescriptor => ({ kind: "diff", path });
const commit = (sha: string): TabDescriptor => ({ kind: "commit", sha });
const file = (path: string, line?: number): TabDescriptor =>
  line === undefined ? { kind: "file", path } : { kind: "file", path, line };

// ── layout helpers ──────────────────────────────────────────────────────────

/** The id of the one tab holding `key`, preferring the active group. */
function idOf(layout: TaskLayout, key: string): string {
  const found = findByKey(layout, key);
  if (!found) throw new Error(`no tab with key ${key}`);
  return found.tab.id;
}

function agentId(layout: TaskLayout): string {
  return idOf(layout, "agent");
}

/** Keys per group, in group order — the shape assertions read off this. */
function keyGrid(layout: TaskLayout): string[][] {
  return layout.groups.map((g) => g.tabs.map((t) => t.key));
}

function groupById(layout: TaskLayout, groupId: string): TabGroup {
  const group = layout.groups.find((g) => g.id === groupId);
  if (!group) throw new Error(`no group ${groupId}`);
  return group;
}

/** Identity-free view of a layout: ids are re-minted on revive by design, so
 * round-trips are compared on descriptors, preview flags, group shape and
 * which tab/group is active (as positions, not id strings). */
function shapeOf(layout: TaskLayout) {
  return {
    activeGroupIndex: layout.groups.findIndex((g) => g.id === layout.activeGroupId),
    groups: layout.groups.map((g) => ({
      flex: g.flex,
      activeTabIndex: g.tabs.findIndex((t) => t.id === g.activeTabId),
      tabs: g.tabs.map((t) => ({ descriptor: t.descriptor, key: t.key, preview: t.preview })),
    })),
  };
}

/** Runs an operation and asserts it did not mutate the layout it was given. */
function pure<T>(layout: TaskLayout, run: (l: TaskLayout) => T): T {
  const before = structuredClone(layout);
  const result = run(layout);
  expect(layout).toEqual(before);
  return result;
}

// ── storage stub (bun test has no DOM) ──────────────────────────────────────

function installStorage(): Map<string, string> {
  const data = new Map<string, string>();
  const stub: Storage = {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.get(key) ?? null;
    },
    key(index: number) {
      return [...data.keys()][index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: stub,
    writable: true,
    configurable: true,
  });
  return data;
}

function installBrokenStorage(): void {
  const stub: Storage = {
    length: 0,
    clear() {},
    getItem() {
      throw new Error("blocked");
    },
    key() {
      throw new Error("blocked");
    },
    removeItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: stub,
    writable: true,
    configurable: true,
  });
}

function removeStorage(): void {
  Reflect.deleteProperty(globalThis, "localStorage");
}

// ── tabKey ──────────────────────────────────────────────────────────────────

test("tabKey is stable for equal descriptors", () => {
  expect(tabKey(agent)).toBe(tabKey({ kind: "agent" }));
  expect(tabKey(diffAll)).toBe(tabKey({ kind: "diffAll" }));
  expect(tabKey(history)).toBe(tabKey({ kind: "history" }));
  expect(tabKey(shell("pty-1"))).toBe(tabKey(shell("pty-1")));
  expect(tabKey(diff("src/a.ts"))).toBe(tabKey(diff("src/a.ts")));
  expect(tabKey(file("src/a.ts"))).toBe(tabKey(file("src/a.ts")));
  expect(tabKey(commit("abc123"))).toBe(tabKey(commit("abc123")));
});

test("tabKey is distinct for different values of the same kind", () => {
  expect(tabKey(shell("pty-1"))).not.toBe(tabKey(shell("pty-2")));
  expect(tabKey(diff("a.ts"))).not.toBe(tabKey(diff("b.ts")));
  expect(tabKey(file("a.ts"))).not.toBe(tabKey(file("b.ts")));
  expect(tabKey(commit("abc"))).not.toBe(tabKey(commit("def")));
});

test("tabKey ignores a file descriptor's line, so go-to-definition dedupes", () => {
  expect(tabKey(file("src/a.ts", 400))).toBe(tabKey(file("src/a.ts", 12)));
  expect(tabKey(file("src/a.ts", 400))).toBe(tabKey(file("src/a.ts")));
});

test("tabKey never collides across kinds that share a payload string", () => {
  const descriptors: TabDescriptor[] = [
    agent,
    diffAll,
    history,
    shell("x"),
    diff("x"),
    file("x"),
    commit("x"),
  ];
  const keys = descriptors.map(tabKey);
  expect(new Set(keys).size).toBe(keys.length);
  expect(tabKey(diff("x"))).not.toBe(tabKey(file("x")));
});

test("isTerminalTab is true for agent and shell only", () => {
  expect(isTerminalTab(agent)).toBe(true);
  expect(isTerminalTab(shell("p"))).toBe(true);
  expect(isTerminalTab(diff("a"))).toBe(false);
  expect(isTerminalTab(diffAll)).toBe(false);
  expect(isTerminalTab(file("a"))).toBe(false);
  expect(isTerminalTab(commit("a"))).toBe(false);
  expect(isTerminalTab(history)).toBe(false);
});

// ── descriptorFromKey ───────────────────────────────────────────────────────

test("descriptorFromKey round-trips every kind a tabKey can name", () => {
  const descriptors: TabDescriptor[] = [
    agent,
    diffAll,
    history,
    shell("pty-1"),
    diff("src/a.ts"),
    file("src/a.ts"),
    commit("abc123"),
  ];
  for (const descriptor of descriptors) {
    expect(descriptorFromKey(tabKey(descriptor))).toEqual(descriptor);
  }
});

test("descriptorFromKey splits on the first colon, so a path may contain one", () => {
  // Not hypothetical on the web: a path can hold a colon, and the key is built
  // by concatenation. Splitting on the last one would open "src/a.ts" as a file
  // named "ts" under a kind named "file:src/a".
  expect(descriptorFromKey("file:src/weird:name.ts")).toEqual({
    kind: "file",
    path: "src/weird:name.ts",
  });
  expect(descriptorFromKey("diff:a:b:c")).toEqual({ kind: "diff", path: "a:b:c" });
});

test("descriptorFromKey drops a file's line, matching tabKey's contract", () => {
  // The line is a cursor position, not identity: `tabKey` leaves it out so a
  // second go-to-definition moves the cursor instead of opening the file twice.
  expect(descriptorFromKey(tabKey(file("src/a.ts", 400)))).toEqual(file("src/a.ts"));
});

test("descriptorFromKey rejects what it cannot open", () => {
  expect(descriptorFromKey("")).toBeNull();
  expect(descriptorFromKey("nonsense")).toBeNull();
  expect(descriptorFromKey("settings:theme")).toBeNull();
  // A kind with nothing after the colon names no file, PTY or commit.
  expect(descriptorFromKey("file:")).toBeNull();
  expect(descriptorFromKey("commit:")).toBeNull();
});

// ── createLayout and lookup ─────────────────────────────────────────────────

test("createLayout starts with one group holding a single permanent agent tab", () => {
  resetIdCounter();
  const layout = createLayout();
  expect(layout.groups).toHaveLength(1);
  const group = layout.groups[0]!;
  expect(group.tabs).toHaveLength(1);
  expect(group.tabs[0]!.descriptor).toEqual(agent);
  expect(group.tabs[0]!.key).toBe("agent");
  expect(group.tabs[0]!.preview).toBe(false);
  expect(group.flex).toBe(1);
  expect(group.activeTabId).toBe(group.tabs[0]!.id);
  expect(layout.activeGroupId).toBe(group.id);
});

test("createLayout mints a fresh identity each call", () => {
  const a = createLayout();
  const b = createLayout();
  expect(a.groups[0]!.id).not.toBe(b.groups[0]!.id);
  expect(a.groups[0]!.tabs[0]!.id).not.toBe(b.groups[0]!.tabs[0]!.id);
});

test("findTab reports the group and the indices, and null for an unknown id", () => {
  let layout = createLayout();
  layout = openTab(layout, file("a.ts"));
  const found = findTab(layout, idOf(layout, "file:a.ts"));
  expect(found?.groupIndex).toBe(0);
  expect(found?.tabIndex).toBe(1);
  expect(found?.group.id).toBe(layout.groups[0]!.id);
  expect(findTab(layout, "nope")).toBe(null);
});

test("findByKey prefers the active group when a split put one key in two groups", () => {
  let layout = createLayout();
  layout = openTab(layout, file("a.ts"));
  const originalId = idOf(layout, "file:a.ts");
  layout = splitTab(layout, originalId);
  const copyId = layout.groups[1]!.tabs[0]!.id;

  // The split leaves the new group active, so the copy is what dedupe finds.
  expect(layout.activeGroupId).toBe(layout.groups[1]!.id);
  expect(findByKey(layout, "file:a.ts")?.tab.id).toBe(copyId);

  // Focus the original and the preference flips to it.
  layout = focusTab(layout, originalId);
  expect(findByKey(layout, "file:a.ts")?.tab.id).toBe(originalId);
  expect(findByKey(layout, "file:missing.ts")).toBe(null);
});

test("activeGroup and activeTab fall back when the active ids name nothing", () => {
  const layout = createLayout();
  expect(activeGroup(layout).id).toBe(layout.groups[0]!.id);
  expect(activeTab(layout)?.key).toBe("agent");
  expect(activeGroup({ ...layout, activeGroupId: "gone" }).id).toBe(layout.groups[0]!.id);
  const bogus: TaskLayout = {
    ...layout,
    groups: [{ ...layout.groups[0]!, activeTabId: "gone" }],
  };
  expect(activeTab(bogus)?.key).toBe("agent");
});

test("allTabs lists every tab in group order", () => {
  let layout = createLayout();
  layout = openTab(layout, file("a.ts"));
  layout = splitTab(layout, idOf(layout, "file:a.ts"));
  layout = openTab(layout, commit("abc"));
  expect(allTabs(layout).map((t) => t.key)).toEqual([
    "agent",
    "file:a.ts",
    "file:a.ts",
    "commit:abc",
  ]);
});

// ── openTab ─────────────────────────────────────────────────────────────────

test("openTab appends to the active group and focuses the new tab", () => {
  let layout = createLayout();
  layout = openTab(layout, file("a.ts"));
  const group = layout.groups[0]!;
  expect(group.tabs.map((t) => t.key)).toEqual(["agent", "file:a.ts"]);
  expect(group.activeTabId).toBe(group.tabs[1]!.id);
  expect(layout.activeGroupId).toBe(group.id);
  expect(group.tabs[1]!.preview).toBe(false);
});

test("openTab focuses the existing tab when the key is already open", () => {
  let layout = createLayout();
  layout = openTab(layout, file("a.ts"));
  const openId = idOf(layout, "file:a.ts");
  layout = openTab(layout, commit("abc"));
  layout = openTab(layout, file("a.ts"));
  expect(layout.groups[0]!.tabs).toHaveLength(3);
  expect(layout.groups[0]!.activeTabId).toBe(openId);
});

test("openTab focuses the copy in the active group rather than adding a third", () => {
  let layout = createLayout();
  layout = openTab(layout, file("a.ts"));
  layout = splitTab(layout, idOf(layout, "file:a.ts"));
  const copyId = layout.groups[1]!.tabs[0]!.id;
  layout = openTab(layout, file("a.ts"));
  expect(keyGrid(layout)).toEqual([["agent", "file:a.ts"], ["file:a.ts"]]);
  expect(layout.activeGroupId).toBe(layout.groups[1]!.id);
  expect(layout.groups[1]!.activeTabId).toBe(copyId);
});

test("openTab refreshes the descriptor of an open tab, which is how a new line arrives", () => {
  let layout = createLayout();
  layout = openTab(layout, file("a.ts", 12));
  const openId = idOf(layout, "file:a.ts");
  layout = openTab(layout, file("a.ts", 400));
  expect(layout.groups[0]!.tabs).toHaveLength(2);
  const tab = findTab(layout, openId)!.tab;
  expect(tab.descriptor).toEqual(file("a.ts", 400));
  expect(tab.key).toBe("file:a.ts");
});

test("openTab honours an explicit groupId and focuses that group", () => {
  let layout = createLayout();
  layout = openTab(layout, file("a.ts"));
  layout = splitTab(layout, idOf(layout, "file:a.ts"));
  const firstGroupId = layout.groups[0]!.id;
  layout = openTab(layout, commit("abc"), { groupId: firstGroupId });
  expect(keyGrid(layout)).toEqual([["agent", "file:a.ts", "commit:abc"], ["file:a.ts"]]);
  expect(layout.activeGroupId).toBe(firstGroupId);
});

test("openTab falls back to the active group when groupId names nothing", () => {
  let layout = createLayout();
  layout = openTab(layout, commit("abc"), { groupId: "gone" });
  expect(keyGrid(layout)).toEqual([["agent", "commit:abc"]]);
});

test("openTab does not mutate the layout it is given", () => {
  const base = openTab(createLayout(), file("a.ts"));
  pure(base, (l) => openTab(l, commit("abc")));
  pure(base, (l) => openTab(l, file("a.ts", 9)));
  pure(base, (l) => openTab(l, diffAll, { preview: true }));
});

// ── preview and pin ─────────────────────────────────────────────────────────

test("a preview open creates an italic tab that the next preview open replaces in place", () => {
  let layout = createLayout();
  layout = openTab(layout, commit("one"), { preview: true });
  expect(layout.groups[0]!.tabs.map((t) => t.key)).toEqual(["agent", "commit:one"]);
  expect(layout.groups[0]!.tabs[1]!.preview).toBe(true);

  layout = openTab(layout, commit("two"), { preview: true });
  expect(layout.groups[0]!.tabs.map((t) => t.key)).toEqual(["agent", "commit:two"]);
  expect(layout.groups[0]!.tabs[1]!.preview).toBe(true);
  expect(layout.groups[0]!.activeTabId).toBe(layout.groups[0]!.tabs[1]!.id);

  // Thirty clicks through a commit list still leave one preview tab.
  for (const sha of ["three", "four", "five"]) {
    layout = openTab(layout, commit(sha), { preview: true });
  }
  expect(layout.groups[0]!.tabs.map((t) => t.key)).toEqual(["agent", "commit:five"]);
});

test("pinTab makes a preview tab permanent, so the next preview open appends", () => {
  let layout = createLayout();
  layout = openTab(layout, commit("one"), { preview: true });
  const pinnedId = idOf(layout, "commit:one");
  layout = pinTab(layout, pinnedId);
  expect(findTab(layout, pinnedId)!.tab.preview).toBe(false);

  layout = openTab(layout, commit("two"), { preview: true });
  expect(layout.groups[0]!.tabs.map((t) => t.key)).toEqual([
    "agent",
    "commit:one",
    "commit:two",
  ]);
});

test("a non-preview open of an already-open key clears preview", () => {
  let layout = createLayout();
  layout = openTab(layout, commit("one"), { preview: true });
  const id = idOf(layout, "commit:one");
  layout = openTab(layout, commit("one"));
  expect(findTab(layout, id)!.tab.preview).toBe(false);
  expect(layout.groups[0]!.tabs).toHaveLength(2);
});

test("a preview open of an already-pinned tab does not put it back into preview", () => {
  let layout = createLayout();
  layout = openTab(layout, file("a.ts"));
  const id = idOf(layout, "file:a.ts");
  layout = openTab(layout, file("a.ts"), { preview: true });
  expect(findTab(layout, id)!.tab.preview).toBe(false);
  expect(layout.groups[0]!.activeTabId).toBe(id);
});

test("a preview open of the existing preview tab leaves it in preview", () => {
  let layout = createLayout();
  layout = openTab(layout, commit("one"), { preview: true });
  const id = idOf(layout, "commit:one");
  layout = openTab(layout, commit("one"), { preview: true });
  expect(findTab(layout, id)!.tab.preview).toBe(true);
  expect(layout.groups[0]!.tabs).toHaveLength(2);
});

test("preview replacement is per group", () => {
  let layout = createLayout();
  layout = openTab(layout, commit("one"), { preview: true });
  layout = splitTab(layout, idOf(layout, "commit:one"));
  // The split copy is permanent, so a preview open in the new group appends.
  layout = openTab(layout, commit("two"), { preview: true });
  expect(keyGrid(layout)).toEqual([
    ["agent", "commit:one"],
    ["commit:one", "commit:two"],
  ]);
  // The first group's preview tab is untouched by opens in the second.
  expect(layout.groups[0]!.tabs[1]!.preview).toBe(true);
});

test("pinTab is a no-op for an unknown id and for a tab that is already permanent", () => {
  let layout = createLayout();
  layout = openTab(layout, file("a.ts"));
  expect(pinTab(layout, "nope")).toBe(layout);
  expect(pinTab(layout, idOf(layout, "file:a.ts"))).toBe(layout);
  expect(pinTab(layout, agentId(layout))).toBe(layout);
});

// ── the agent tab ───────────────────────────────────────────────────────────

test("closeTab refuses the agent tab and returns the layout unchanged", () => {
  let layout = createLayout();
  layout = openTab(layout, file("a.ts"));
  const id = agentId(layout);
  const before = structuredClone(layout);
  const after = closeTab(layout, id);
  expect(after).toBe(layout);
  expect(after).toEqual(before);
  expect(findTab(after, id)?.tab.descriptor).toEqual(agent);
});

test("the agent tab stays unique across opens, splits and moves", () => {
  let layout = createLayout();
  layout = openTab(layout, agent);
  layout = openTab(layout, file("a.ts"));
  layout = splitTab(layout, idOf(layout, "file:a.ts"));
  layout = splitTab(layout, agentId(layout));
  layout = moveTab(layout, agentId(layout), layout.groups[1]!.id, 0);
  expect(allTabs(layout).filter((t) => t.key === "agent")).toHaveLength(1);
});

// ── closeTab bookkeeping ────────────────────────────────────────────────────

test("closeTab focuses the neighbour that slid into the closed tab's place", () => {
  let layout = createLayout();
  layout = openTab(layout, file("a.ts"));
  layout = openTab(layout, file("b.ts"));
  layout = openTab(layout, file("c.ts"));
  layout = focusTab(layout, idOf(layout, "file:b.ts"));
  const cId = idOf(layout, "file:c.ts");

  layout = closeTab(layout, idOf(layout, "file:b.ts"));
  expect(layout.groups[0]!.tabs.map((t) => t.key)).toEqual(["agent", "file:a.ts", "file:c.ts"]);
  expect(layout.groups[0]!.activeTabId).toBe(cId);
});

test("closeTab falls back to the left neighbour when the closed tab was last", () => {
  let layout = createLayout();
  layout = openTab(layout, file("a.ts"));
  layout = openTab(layout, file("b.ts"));
  const aId = idOf(layout, "file:a.ts");
  layout = closeTab(layout, idOf(layout, "file:b.ts"));
  expect(layout.groups[0]!.activeTabId).toBe(aId);
});

test("closeTab leaves activeTabId alone when a non-active tab is closed", () => {
  let layout = createLayout();
  layout = openTab(layout, file("a.ts"));
  layout = openTab(layout, file("b.ts"));
  const bId = idOf(layout, "file:b.ts");
  layout = closeTab(layout, idOf(layout, "file:a.ts"));
  expect(layout.groups[0]!.activeTabId).toBe(bId);
});

test("closing the last tab of a non-active group removes that group", () => {
  let layout = createLayout();
  layout = openTab(layout, file("a.ts"));
  const originalId = idOf(layout, "file:a.ts");
  layout = splitTab(layout, originalId);
  const copyId = layout.groups[1]!.tabs[0]!.id;
  const firstGroupId = layout.groups[0]!.id;
  layout = focusTab(layout, originalId);
  expect(layout.activeGroupId).toBe(firstGroupId);

  layout = closeTab(layout, copyId);
  expect(layout.groups).toHaveLength(1);
  expect(layout.activeGroupId).toBe(firstGroupId);
});

test("closing the last tab of the active group removes it and moves activeGroupId", () => {
  let layout = createLayout();
  layout = openTab(layout, file("a.ts"));
  layout = splitTab(layout, idOf(layout, "file:a.ts"));
  const firstGroupId = layout.groups[0]!.id;
  const copyId = layout.groups[1]!.tabs[0]!.id;
  expect(layout.activeGroupId).toBe(layout.groups[1]!.id);

  layout = closeTab(layout, copyId);
  expect(layout.groups).toHaveLength(1);
  expect(layout.activeGroupId).toBe(firstGroupId);
  expect(keyGrid(layout)).toEqual([["agent", "file:a.ts"]]);
});

test("closeTab is a no-op for an unknown id", () => {
  const layout = openTab(createLayout(), file("a.ts"));
  expect(closeTab(layout, "nope")).toBe(layout);
});

test("closeTab does not mutate the layout it is given", () => {
  let base = createLayout();
  base = openTab(base, file("a.ts"));
  base = openTab(base, file("b.ts"));
  base = splitTab(base, idOf(base, "file:b.ts"));
  const copyId = base.groups[1]!.tabs[0]!.id;
  pure(base, (l) => closeTab(l, copyId));
  pure(base, (l) => closeTab(l, idOf(l, "file:a.ts")));
  pure(base, (l) => closeTab(l, agentId(l)));
});

// ── focusTab ────────────────────────────────────────────────────────────────

test("focusTab sets both activeGroupId and activeTabId", () => {
  let layout = createLayout();
  layout = openTab(layout, file("a.ts"));
  layout = splitTab(layout, idOf(layout, "file:a.ts"));
  const agentTabId = findTab(layout, layout.groups[0]!.tabs[0]!.id)!.tab.id;

  layout = focusTab(layout, agentTabId);
  expect(layout.activeGroupId).toBe(layout.groups[0]!.id);
  expect(layout.groups[0]!.activeTabId).toBe(agentTabId);
  // The other group keeps its own active tab.
  expect(layout.groups[1]!.activeTabId).toBe(layout.groups[1]!.tabs[0]!.id);
});

test("focusTab is a no-op for an unknown id", () => {
  const layout = createLayout();
  expect(focusTab(layout, "nope")).toBe(layout);
});

// ── canSplit and splitTab ───────────────────────────────────────────────────

test("canSplit refuses terminal tabs and unknown ids, and allows read-only ones", () => {
  let layout = createLayout();
  layout = openTab(layout, shell("pty-1"));
  layout = openTab(layout, diff("a.ts"));
  layout = openTab(layout, diffAll);
  layout = openTab(layout, file("a.ts"));
  layout = openTab(layout, commit("abc"));
  layout = openTab(layout, history);

  expect(canSplit(layout, agentId(layout))).toBe(false);
  expect(canSplit(layout, idOf(layout, "shell:pty-1"))).toBe(false);
  expect(canSplit(layout, "nope")).toBe(false);
  for (const key of ["diff:a.ts", "diffAll", "file:a.ts", "commit:abc", "history"]) {
    expect(canSplit(layout, idOf(layout, key))).toBe(true);
  }
});

test("splitTab refuses agent and shell tabs and unknown ids", () => {
  let layout = createLayout();
  layout = openTab(layout, shell("pty-1"));
  expect(splitTab(layout, agentId(layout))).toBe(layout);
  expect(splitTab(layout, idOf(layout, "shell:pty-1"))).toBe(layout);
  expect(splitTab(layout, "nope")).toBe(layout);
  expect(layout.groups).toHaveLength(1);
});

test("splitTab puts a second tab with the same key in a new group beside the original", () => {
  let layout = createLayout();
  layout = openTab(layout, file("a.ts"));
  layout = setGroupFlex(layout, [2]);
  const originalId = idOf(layout, "file:a.ts");
  const firstGroupId = layout.groups[0]!.id;

  layout = splitTab(layout, originalId);
  expect(layout.groups).toHaveLength(2);
  expect(layout.groups[0]!.id).toBe(firstGroupId);
  expect(keyGrid(layout)).toEqual([["agent", "file:a.ts"], ["file:a.ts"]]);

  const copy = layout.groups[1]!.tabs[0]!;
  expect(copy.id).not.toBe(originalId);
  expect(copy.descriptor).toEqual(file("a.ts"));
  expect(copy.preview).toBe(false);
  expect(layout.groups[1]!.flex).toBe(2);
  expect(layout.groups[1]!.activeTabId).toBe(copy.id);
  expect(layout.activeGroupId).toBe(layout.groups[1]!.id);
  // The original stays exactly where it was.
  expect(findTab(layout, originalId)!.groupIndex).toBe(0);
});

test("splitTab inserts the new group immediately after the source group", () => {
  let layout = createLayout();
  layout = openTab(layout, file("a.ts"));
  layout = openTab(layout, file("b.ts"));
  layout = splitTab(layout, idOf(layout, "file:b.ts"));
  layout = splitTab(layout, idOf(layout, "file:a.ts"));
  expect(keyGrid(layout)).toEqual([
    ["agent", "file:a.ts", "file:b.ts"],
    ["file:a.ts"],
    ["file:b.ts"],
  ]);
});

test("a split copy of a preview tab is permanent", () => {
  let layout = createLayout();
  layout = openTab(layout, commit("abc"), { preview: true });
  layout = splitTab(layout, idOf(layout, "commit:abc"));
  expect(layout.groups[1]!.tabs[0]!.preview).toBe(false);
});

test("splitTab does not mutate the layout it is given", () => {
  const base = openTab(createLayout(), file("a.ts"));
  pure(base, (l) => splitTab(l, idOf(l, "file:a.ts")));
  pure(base, (l) => splitTab(l, agentId(l)));
});

// ── moveTab ─────────────────────────────────────────────────────────────────

test("moveTab reorders within a group and focuses the moved tab", () => {
  let layout = createLayout();
  layout = openTab(layout, file("a.ts"));
  layout = openTab(layout, file("b.ts"));
  const aId = idOf(layout, "file:a.ts");
  const groupId = layout.groups[0]!.id;

  layout = moveTab(layout, aId, groupId, 0);
  expect(keyGrid(layout)).toEqual([["file:a.ts", "agent", "file:b.ts"]]);
  expect(layout.groups[0]!.activeTabId).toBe(aId);
  expect(layout.activeGroupId).toBe(groupId);
});

test("moveTab clamps an out-of-range index within a group", () => {
  let layout = createLayout();
  layout = openTab(layout, file("a.ts"));
  layout = openTab(layout, file("b.ts"));
  const groupId = layout.groups[0]!.id;
  const agentTab = agentId(layout);

  const toEnd = moveTab(layout, agentTab, groupId, 99);
  expect(keyGrid(toEnd)).toEqual([["file:a.ts", "file:b.ts", "agent"]]);

  const toStart = moveTab(layout, idOf(layout, "file:b.ts"), groupId, -5);
  expect(keyGrid(toStart)).toEqual([["file:b.ts", "agent", "file:a.ts"]]);
});

test("moveTab across groups removes from the source, inserts at the index and moves focus", () => {
  let layout = createLayout();
  layout = openTab(layout, diff("a.ts"));
  layout = splitTab(layout, idOf(layout, "diff:a.ts"));
  layout = openTab(layout, shell("pty-1"));
  // g0: [agent, diff:a.ts]   g1: [diff:a.ts, shell:pty-1]
  expect(keyGrid(layout)).toEqual([
    ["agent", "diff:a.ts"],
    ["diff:a.ts", "shell:pty-1"],
  ]);
  const firstGroupId = layout.groups[0]!.id;
  const shellId = idOf(layout, "shell:pty-1");

  layout = moveTab(layout, shellId, firstGroupId, 1);
  expect(keyGrid(layout)).toEqual([
    ["agent", "shell:pty-1", "diff:a.ts"],
    ["diff:a.ts"],
  ]);
  expect(layout.activeGroupId).toBe(firstGroupId);
  expect(groupById(layout, firstGroupId).activeTabId).toBe(shellId);
  // The source group re-focuses the tab that slid into place.
  expect(layout.groups[1]!.activeTabId).toBe(layout.groups[1]!.tabs[0]!.id);
});

test("moveTab collapses the source group when it empties", () => {
  let layout = createLayout();
  layout = openTab(layout, file("a.ts"));
  layout = splitTab(layout, idOf(layout, "file:a.ts"));
  layout = openTab(layout, shell("pty-1"));
  layout = closeTab(layout, layout.groups[1]!.tabs[0]!.id);
  // g0: [agent, file:a.ts]   g1: [shell:pty-1]
  expect(keyGrid(layout)).toEqual([["agent", "file:a.ts"], ["shell:pty-1"]]);
  const firstGroupId = layout.groups[0]!.id;

  layout = moveTab(layout, idOf(layout, "shell:pty-1"), firstGroupId, 0);
  expect(layout.groups).toHaveLength(1);
  expect(keyGrid(layout)).toEqual([["shell:pty-1", "agent", "file:a.ts"]]);
  expect(layout.activeGroupId).toBe(firstGroupId);
});

test("moveTab leaves the source group's active tab alone when a non-active tab moves", () => {
  let layout = createLayout();
  layout = openTab(layout, diff("a.ts"));
  layout = splitTab(layout, idOf(layout, "diff:a.ts"));
  layout = openTab(layout, file("b.ts"));
  layout = openTab(layout, commit("abc"));
  // g1: [diff:a.ts, file:b.ts, commit:abc] with commit active
  const secondGroupId = layout.groups[1]!.id;
  const commitId = idOf(layout, "commit:abc");
  expect(groupById(layout, secondGroupId).activeTabId).toBe(commitId);

  layout = moveTab(layout, idOf(layout, "file:b.ts"), layout.groups[0]!.id, 0);
  expect(groupById(layout, secondGroupId).activeTabId).toBe(commitId);
});

test("moveTab refuses a move that would put a duplicate key into the target group", () => {
  let layout = createLayout();
  layout = openTab(layout, file("a.ts"));
  layout = splitTab(layout, idOf(layout, "file:a.ts"));
  const copyId = layout.groups[1]!.tabs[0]!.id;
  const firstGroupId = layout.groups[0]!.id;
  expect(moveTab(layout, copyId, firstGroupId, 0)).toBe(layout);
});

test("moveTab is a no-op for an unknown tab or an unknown group", () => {
  let layout = createLayout();
  layout = openTab(layout, file("a.ts"));
  expect(moveTab(layout, "nope", layout.groups[0]!.id, 0)).toBe(layout);
  expect(moveTab(layout, idOf(layout, "file:a.ts"), "nope", 0)).toBe(layout);
});

test("moveTab does not mutate the layout it is given", () => {
  let base = createLayout();
  base = openTab(base, diff("a.ts"));
  base = splitTab(base, idOf(base, "diff:a.ts"));
  base = openTab(base, shell("pty-1"));
  const firstGroupId = base.groups[0]!.id;
  const secondGroupId = base.groups[1]!.id;
  pure(base, (l) => moveTab(l, idOf(l, "shell:pty-1"), firstGroupId, 0));
  pure(base, (l) => moveTab(l, idOf(l, "shell:pty-1"), secondGroupId, 0));
  pure(base, (l) => moveTab(l, agentId(l), secondGroupId, 0));
});

// ── setGroupFlex ────────────────────────────────────────────────────────────

test("setGroupFlex applies a full set of shares", () => {
  let layout = createLayout();
  layout = openTab(layout, file("a.ts"));
  layout = splitTab(layout, idOf(layout, "file:a.ts"));
  const next = setGroupFlex(layout, [0.3, 0.7]);
  expect(next.groups.map((g) => g.flex)).toEqual([0.3, 0.7]);
});

test("setGroupFlex ignores a partial set, and zero, negative or non-finite shares", () => {
  let layout = createLayout();
  layout = openTab(layout, file("a.ts"));
  layout = splitTab(layout, idOf(layout, "file:a.ts"));
  expect(setGroupFlex(layout, [1])).toBe(layout);
  expect(setGroupFlex(layout, [1, 1, 1])).toBe(layout);
  expect(setGroupFlex(layout, [])).toBe(layout);
  expect(setGroupFlex(layout, [1, 0])).toBe(layout);
  expect(setGroupFlex(layout, [1, -2])).toBe(layout);
  expect(setGroupFlex(layout, [1, Number.NaN])).toBe(layout);
  expect(setGroupFlex(layout, [1, Number.POSITIVE_INFINITY])).toBe(layout);
  expect(layout.groups.map((g) => g.flex)).toEqual([1, 1]);
});

// ── pruneShellTabs ──────────────────────────────────────────────────────────

test("pruneShellTabs drops only shell tabs whose PTY is gone", () => {
  let layout = createLayout();
  layout = openTab(layout, shell("live"));
  layout = openTab(layout, shell("dead"));
  layout = openTab(layout, file("a.ts"));
  layout = openTab(layout, diff("a.ts"));
  layout = openTab(layout, diffAll);
  layout = openTab(layout, commit("abc"));
  layout = openTab(layout, history);

  const pruned = pruneShellTabs(layout, new Set(["live"]));
  expect(keyGrid(pruned)).toEqual([
    [
      "agent",
      "shell:live",
      "file:a.ts",
      "diff:a.ts",
      "diffAll",
      "commit:abc",
      "history",
    ],
  ]);
});

test("pruneShellTabs is a no-op when every shell is live", () => {
  let layout = createLayout();
  layout = openTab(layout, shell("p1"));
  layout = openTab(layout, file("a.ts"));
  expect(pruneShellTabs(layout, new Set(["p1"]))).toBe(layout);
  expect(pruneShellTabs(layout, new Set(["p1", "p2"]))).toBe(layout);
});

test("pruneShellTabs collapses a group left empty by a dead shell", () => {
  let layout = createLayout();
  layout = openTab(layout, file("a.ts"));
  layout = splitTab(layout, idOf(layout, "file:a.ts"));
  layout = openTab(layout, shell("dead"));
  layout = closeTab(layout, layout.groups[1]!.tabs[0]!.id);
  expect(keyGrid(layout)).toEqual([["agent", "file:a.ts"], ["shell:dead"]]);

  const pruned = pruneShellTabs(layout, new Set());
  expect(keyGrid(pruned)).toEqual([["agent", "file:a.ts"]]);
  expect(pruned.activeGroupId).toBe(pruned.groups[0]!.id);
});

test("pruneShellTabs does not mutate the layout it is given", () => {
  let base = createLayout();
  base = openTab(base, shell("dead"));
  base = openTab(base, shell("live"));
  pure(base, (l) => pruneShellTabs(l, new Set(["live"])));
});

// ── persistence ─────────────────────────────────────────────────────────────

test("a layout round-trips through localStorage keyed by task id", () => {
  installStorage();
  let layout = createLayout();
  layout = openTab(layout, file("a.ts", 42));
  layout = openTab(layout, commit("abc"), { preview: true });
  layout = splitTab(layout, idOf(layout, "file:a.ts"));
  layout = openTab(layout, shell("pty-1"));
  layout = setGroupFlex(layout, [0.4, 0.6]);
  layout = focusTab(layout, idOf(layout, "file:a.ts"));

  saveLayout("task-1", layout);
  const loaded = loadLayout("task-1");
  expect(shapeOf(loaded)).toEqual(shapeOf(layout));
  // Ids are re-minted by design, so nothing carries over verbatim.
  expect(loaded.groups[0]!.id).not.toBe(layout.groups[0]!.id);
});

test("saved layouts are isolated per task id", () => {
  installStorage();
  const one = openTab(createLayout(), file("one.ts"));
  const two = openTab(createLayout(), commit("two"));
  saveLayout("task-a", one);
  saveLayout("task-b", two);
  expect(keyGrid(loadLayout("task-a"))).toEqual([["agent", "file:one.ts"]]);
  expect(keyGrid(loadLayout("task-b"))).toEqual([["agent", "commit:two"]]);
});

test("loadLayout gives a fresh layout for an unknown task", () => {
  installStorage();
  const loaded = loadLayout("never-saved");
  expect(keyGrid(loaded)).toEqual([["agent"]]);
  expect(loaded.activeGroupId).toBe(loaded.groups[0]!.id);
});

test("loadLayout falls back to a fresh layout when the stored string is not JSON", () => {
  const data = installStorage();
  data.set("codetoaster:layout:task-1", "{not json at all");
  expect(keyGrid(loadLayout("task-1"))).toEqual([["agent"]]);
});

test("loadLayout falls back to a fresh layout when the stored JSON does not validate", () => {
  const data = installStorage();
  data.set("codetoaster:layout:task-1", JSON.stringify({ groups: [] }));
  expect(keyGrid(loadLayout("task-1"))).toEqual([["agent"]]);
});

test("clearLayout removes a task's stored layout", () => {
  const data = installStorage();
  saveLayout("task-1", openTab(createLayout(), file("a.ts")));
  expect(data.has("codetoaster:layout:task-1")).toBe(true);
  clearLayout("task-1");
  expect(data.has("codetoaster:layout:task-1")).toBe(false);
  expect(keyGrid(loadLayout("task-1"))).toEqual([["agent"]]);
});

test("retainLayouts drops layouts for unknown task ids and leaves everything else alone", () => {
  const data = installStorage();
  saveLayout("keep-1", openTab(createLayout(), file("a.ts")));
  saveLayout("keep-2", openTab(createLayout(), file("b.ts")));
  saveLayout("drop", openTab(createLayout(), file("c.ts")));
  data.set("codetoaster:viewstate:other", "untouched");
  data.set("unrelated", "untouched");

  retainLayouts(new Set(["keep-1", "keep-2"]));

  expect(data.has("codetoaster:layout:keep-1")).toBe(true);
  expect(data.has("codetoaster:layout:keep-2")).toBe(true);
  expect(data.has("codetoaster:layout:drop")).toBe(false);
  expect(data.get("codetoaster:viewstate:other")).toBe("untouched");
  expect(data.get("unrelated")).toBe("untouched");
});

test("persistence degrades quietly when storage throws", () => {
  installBrokenStorage();
  expect(() => saveLayout("task-1", createLayout())).not.toThrow();
  expect(() => clearLayout("task-1")).not.toThrow();
  expect(() => retainLayouts(new Set(["task-1"]))).not.toThrow();
  expect(keyGrid(loadLayout("task-1"))).toEqual([["agent"]]);
});

test("persistence degrades quietly when there is no localStorage at all", () => {
  removeStorage();
  expect(() => saveLayout("task-1", createLayout())).not.toThrow();
  expect(() => clearLayout("task-1")).not.toThrow();
  expect(() => retainLayouts(new Set())).not.toThrow();
  expect(keyGrid(loadLayout("task-1"))).toEqual([["agent"]]);
});

// ── reviveLayout ────────────────────────────────────────────────────────────

function rawTab(descriptor: unknown, id = "t1", preview = false) {
  // `key` is deliberately wrong: revive recomputes it from the descriptor.
  return { id, descriptor, key: "stale", preview };
}

function rawLayout(groups: unknown[], activeGroupId?: string) {
  return { groups, activeGroupId };
}

test("reviveLayout rebuilds a valid payload, re-minting ids and recomputing keys", () => {
  const payload = rawLayout(
    [
      {
        id: "g1",
        flex: 2,
        activeTabId: "t2",
        tabs: [rawTab({ kind: "agent" }, "t1"), rawTab({ kind: "file", path: "a.ts", line: 9 }, "t2", true)],
      },
      {
        id: "g2",
        flex: 3,
        activeTabId: "t3",
        tabs: [rawTab({ kind: "commit", sha: "abc" }, "t3")],
      },
    ],
    "g2",
  );
  const layout = reviveLayout(payload)!;
  expect(layout).not.toBe(null);
  expect(keyGrid(layout)).toEqual([["agent", "file:a.ts"], ["commit:abc"]]);
  expect(layout.groups.map((g) => g.flex)).toEqual([2, 3]);
  expect(layout.groups[0]!.tabs[1]!.preview).toBe(true);
  expect(layout.groups[0]!.tabs[1]!.descriptor).toEqual(file("a.ts", 9));
  expect(layout.groups[0]!.activeTabId).toBe(layout.groups[0]!.tabs[1]!.id);
  expect(layout.activeGroupId).toBe(layout.groups[1]!.id);
  // Stored ids are never trusted.
  expect(layout.groups[0]!.id).not.toBe("g1");
  expect(layout.groups[0]!.tabs[0]!.id).not.toBe("t1");
});

test("reviveLayout repairs an unusable flex, active tab and active group", () => {
  const layout = reviveLayout(
    rawLayout(
      [{ id: "g1", flex: 0, activeTabId: "gone", tabs: [rawTab({ kind: "agent" }, "t1")] }],
      "also-gone",
    ),
  )!;
  expect(layout.groups[0]!.flex).toBe(1);
  expect(layout.groups[0]!.activeTabId).toBe(layout.groups[0]!.tabs[0]!.id);
  expect(layout.activeGroupId).toBe(layout.groups[0]!.id);
});

test("reviveLayout drops groups that hold no tabs", () => {
  const layout = reviveLayout(
    rawLayout([
      { id: "g1", tabs: [] },
      { id: "g2", tabs: [rawTab({ kind: "agent" }, "t1")] },
    ]),
  )!;
  expect(layout.groups).toHaveLength(1);
  expect(keyGrid(layout)).toEqual([["agent"]]);
  expect(layout.activeGroupId).toBe(layout.groups[0]!.id);
});

test("reviveLayout returns null rather than throwing for a non-object", () => {
  for (const value of [null, undefined, 42, "layout", true, [] as unknown]) {
    expect(reviveLayout(value)).toBe(null);
  }
});

test("reviveLayout returns null when groups are missing or empty", () => {
  expect(reviveLayout({})).toBe(null);
  expect(reviveLayout({ groups: null })).toBe(null);
  expect(reviveLayout({ groups: "nope" })).toBe(null);
  expect(reviveLayout(rawLayout([]))).toBe(null);
});

test("reviveLayout returns null for a malformed group", () => {
  expect(reviveLayout(rawLayout([null]))).toBe(null);
  expect(reviveLayout(rawLayout(["group"]))).toBe(null);
  expect(reviveLayout(rawLayout([{ id: "g1" }]))).toBe(null);
  expect(reviveLayout(rawLayout([{ id: "g1", tabs: {} }]))).toBe(null);
  expect(reviveLayout(rawLayout([{ id: "g1", tabs: [null] }]))).toBe(null);
});

test("reviveLayout returns null for an unknown descriptor kind", () => {
  expect(
    reviveLayout(
      rawLayout([
        { id: "g1", tabs: [rawTab({ kind: "agent" }, "t1"), rawTab({ kind: "wat" }, "t2")] },
      ]),
    ),
  ).toBe(null);
  expect(reviveLayout(rawLayout([{ id: "g1", tabs: [rawTab(null, "t1")] }]))).toBe(null);
  expect(reviveLayout(rawLayout([{ id: "g1", tabs: [rawTab({}, "t1")] }]))).toBe(null);
});

test("reviveLayout returns null for a shell with no ptyId", () => {
  expect(
    reviveLayout(
      rawLayout([
        { id: "g1", tabs: [rawTab({ kind: "agent" }, "t1"), rawTab({ kind: "shell" }, "t2")] },
      ]),
    ),
  ).toBe(null);
});

test("reviveLayout returns null for a file whose line is a string", () => {
  expect(
    reviveLayout(
      rawLayout([
        {
          id: "g1",
          tabs: [
            rawTab({ kind: "agent" }, "t1"),
            rawTab({ kind: "file", path: "a.ts", line: "9" }, "t2"),
          ],
        },
      ]),
    ),
  ).toBe(null);
  // An absent line is fine; it is optional.
  expect(
    reviveLayout(
      rawLayout([
        {
          id: "g1",
          tabs: [rawTab({ kind: "agent" }, "t1"), rawTab({ kind: "file", path: "a.ts" }, "t2")],
        },
      ]),
    ),
  ).not.toBe(null);
});

test("reviveLayout returns null for a diff or commit with a non-string payload", () => {
  const withTab = (descriptor: unknown) =>
    rawLayout([
      { id: "g1", tabs: [rawTab({ kind: "agent" }, "t1"), rawTab(descriptor, "t2")] },
    ]);
  expect(reviveLayout(withTab({ kind: "diff", path: 3 }))).toBe(null);
  expect(reviveLayout(withTab({ kind: "commit", sha: null }))).toBe(null);
});

test("reviveLayout returns null when there is not exactly one agent tab", () => {
  expect(
    reviveLayout(rawLayout([{ id: "g1", tabs: [rawTab({ kind: "history" }, "t1")] }])),
  ).toBe(null);
  expect(
    reviveLayout(
      rawLayout([
        { id: "g1", tabs: [rawTab({ kind: "agent" }, "t1")] },
        { id: "g2", tabs: [rawTab({ kind: "agent" }, "t2")] },
      ]),
    ),
  ).toBe(null);
});

test("reviveLayout returns null when the same terminal key appears in two groups", () => {
  expect(
    reviveLayout(
      rawLayout([
        {
          id: "g1",
          tabs: [rawTab({ kind: "agent" }, "t1"), rawTab({ kind: "shell", ptyId: "p1" }, "t2")],
        },
        { id: "g2", tabs: [rawTab({ kind: "shell", ptyId: "p1" }, "t3")] },
      ]),
    ),
  ).toBe(null);
});

test("reviveLayout returns null for a duplicate key inside one group", () => {
  expect(
    reviveLayout(
      rawLayout([
        {
          id: "g1",
          tabs: [
            rawTab({ kind: "agent" }, "t1"),
            rawTab({ kind: "file", path: "a.ts", line: 1 }, "t2"),
            rawTab({ kind: "file", path: "a.ts", line: 99 }, "t3"),
          ],
        },
      ]),
    ),
  ).toBe(null);
});

test("reviveLayout accepts the same read-only key in two groups, as a split produces", () => {
  const layout = reviveLayout(
    rawLayout([
      { id: "g1", tabs: [rawTab({ kind: "agent" }, "t1"), rawTab({ kind: "file", path: "a.ts" }, "t2")] },
      { id: "g2", tabs: [rawTab({ kind: "file", path: "a.ts" }, "t3")] },
    ]),
  )!;
  expect(keyGrid(layout)).toEqual([["agent", "file:a.ts"], ["file:a.ts"]]);
});

// ── reconcileShellTabs ──────────────────────────────────────────────────────
//
// §5.5's "shell tabs are not resumable", as a rule: drop one only on positive
// knowledge that its PTY is gone, never on its absence from a list.

test("a task that is not live drops every shell tab", () => {
  let layout = createLayout();
  layout = openTab(layout, shell("p1"));
  layout = openTab(layout, shell("p2"));
  layout = openTab(layout, file("a.ts"));

  // Suspension is exactly "this task holds no processes", so nothing has to
  // have been seen alive for this to be knowledge — which is what makes it
  // survive a page reload across a harvest, where this client never saw them.
  const pruned = reconcileShellTabs(
    layout,
    { lifecycle: "suspended", shellPtyIds: [] },
    new Set<string>(),
  );
  expect(keyGrid(pruned)).toEqual([["agent", "file:a.ts"]]);
});

test("a live task drops a shell it had reported and no longer reports", () => {
  let layout = createLayout();
  layout = openTab(layout, shell("gone"));
  layout = openTab(layout, shell("here"));

  // "gone" was reported once — it exited, or another client closed it.
  const pruned = reconcileShellTabs(
    layout,
    { lifecycle: "live", shellPtyIds: ["here"] },
    new Set(["gone", "here"]),
  );
  expect(keyGrid(pruned)).toEqual([["agent", "shell:here"]]);
});

test("a live task keeps a shell nobody has reported yet", () => {
  let layout = createLayout();
  layout = openTab(layout, shell("just-opened"));

  // The tab is opened from the response to POST …/shell, which races the task
  // deltas on the socket: a delta computed a moment before the spawn carries a
  // shellPtyIds without it. Pruning on absence would close the tab the user
  // just asked for.
  expect(
    reconcileShellTabs(layout, { lifecycle: "live", shellPtyIds: [] }, new Set<string>()),
  ).toBe(layout);
  // ...and once it has been reported, the rule applies to it like any other.
  expect(
    keyGrid(
      reconcileShellTabs(
        layout,
        { lifecycle: "live", shellPtyIds: [] },
        new Set(["just-opened"]),
      ),
    ),
  ).toEqual([["agent"]]);
});

test("a live task with every shell reported changes nothing", () => {
  let layout = createLayout();
  layout = openTab(layout, shell("p1"));
  layout = openTab(layout, file("a.ts"));
  expect(
    reconcileShellTabs(layout, { lifecycle: "live", shellPtyIds: ["p1"] }, new Set(["p1"])),
  ).toBe(layout);
});
