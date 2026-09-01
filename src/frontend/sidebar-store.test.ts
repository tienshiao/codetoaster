import { test, expect, beforeEach } from "bun:test";
import {
  SIDEBAR_DEFAULT,
  getSidebarState,
  patchSidebarState,
  resetSidebarState,
  reviveSidebarState,
  toggleSidebarFlag,
  toggleSidebarGroup,
} from "./sidebar-store";
import { installBrokenStorage, installStorage, removeStorage } from "../../test/local-storage";

/**
 * The sidebar's list settings as arithmetic (TASK-67). What *survives a
 * navigation* is a lifecycle question and lives in `TaskSidebar-state.render.tsx`;
 * what is written down, what is read back and what is refused is here, where it
 * needs no DOM.
 */

const KEY = "codetoaster:sidebar";

let stored: Map<string, string>;

// The storage first, then the reset — in that order and not the other way. The
// store caches a hydrated copy in a module binding that outlives the test, so a
// reset run before the stub was swapped in would clear the old world and leave
// this one holding the previous file's state.
beforeEach(() => {
  stored = installStorage();
  resetSidebarState();
});

/** What is actually on disk, rather than what the store is holding. */
function persisted(): unknown {
  const raw = stored.get(KEY);
  return raw === undefined ? undefined : JSON.parse(raw);
}

/**
 * A reload: the module binding goes, the stored entry stays.
 *
 * `resetSidebarState` clears both — it is the "start from nothing" hook the
 * `beforeEach` wants — so the entry is lifted over it here. Reaching straight
 * into the map keeps the test honest about which of the two the value came
 * back from: everything below that claims to survive a reload has to be read
 * off storage, because nothing else is left.
 */
function reload(): void {
  const disk = stored.get(KEY);
  resetSidebarState();
  if (disk !== undefined) stored.set(KEY, disk);
}

// ── defaults and round trip ─────────────────────────────────────────────────

test("nothing stored gives the default: unfiltered, ungrouped, live tasks only", () => {
  expect(getSidebarState()).toEqual({
    filter: "",
    grouped: false,
    showArchived: false,
    closedGroups: {},
  });
  expect(getSidebarState()).toEqual(SIDEBAR_DEFAULT);
});

test("grouping and the archived toggle come back after a reload", () => {
  patchSidebarState({ grouped: true });
  patchSidebarState({ showArchived: true });

  // The reload drops the hydrated copy, so the next read comes off storage or
  // not at all.
  reload();
  expect(getSidebarState().grouped).toBe(true);
  expect(getSidebarState().showArchived).toBe(true);
});

test("the filter survives a navigation but not a reload", () => {
  // Deliberate, and the reason this test names it. The filter is a search, not
  // a setting: it is held in the module binding so a route change keeps it, and
  // left out of the persisted shape so a reload cannot open the app showing two
  // of thirty tasks with the only explanation in a text box nobody looked at.
  patchSidebarState({ filter: "parser", grouped: true });
  expect(getSidebarState().filter).toBe("parser");
  expect(persisted()).not.toHaveProperty("filter");

  reload();
  expect(getSidebarState().filter).toBe("");
  expect(getSidebarState().grouped).toBe(true);
});

test("a patch merges against the store, not against the caller's snapshot", () => {
  // The `use-explorer-panel` bug this store exists to make impossible: two
  // setters fired from one event each spread the same pre-event value, and the
  // second silently undoes the first. `before` is that stale snapshot; the two
  // patches below are the two setters.
  const before = getSidebarState();
  patchSidebarState({ grouped: true });
  const after = patchSidebarState({ showArchived: true });

  expect(before.grouped).toBe(false);
  expect(after).toMatchObject({ grouped: true, showArchived: true });
  expect(getSidebarState()).toMatchObject({ grouped: true, showArchived: true });
});

test("a toggle reads the live value, so two in one event do not agree", () => {
  // What a caller negating `!grouped` from its own render gets wrong: both
  // calls see the same pre-event value, and the second is a no-op instead of
  // putting the setting back.
  toggleSidebarFlag("grouped");
  expect(getSidebarState().grouped).toBe(true);
  toggleSidebarFlag("grouped");
  expect(getSidebarState().grouped).toBe(false);
});

test("a filter keystroke is not a write", () => {
  // `setItem` is synchronous and on the main thread, and the filter is not in
  // the persisted shape — so a write per character would be a write of bytes
  // identical to the ones already there.
  patchSidebarState({ grouped: true });
  const written = stored.get(KEY);
  stored.delete(KEY);
  patchSidebarState({ filter: "parser" });
  expect(stored.has(KEY)).toBe(false);
  expect(written).toBeDefined();
});

test("only one key is written, for the window and not for a task", () => {
  patchSidebarState({ grouped: true });
  expect([...stored.keys()]).toEqual([KEY]);
});

// ── closed groups ───────────────────────────────────────────────────────────

test("a group closes, and toggling it again reopens it", () => {
  expect(toggleSidebarGroup("website").closedGroups).toEqual({ website: true });
  expect(toggleSidebarGroup("website").closedGroups).toEqual({});
});

test("reopening a group removes its entry rather than storing it as open", () => {
  // The record means "the groups the user closed". Writing `false` for a group
  // that is simply open would grow it on every toggle and store a preference
  // identical to having none.
  toggleSidebarGroup("website");
  toggleSidebarGroup("website");
  expect(getSidebarState().closedGroups).not.toHaveProperty("website");
  expect(persisted()).toMatchObject({ closedGroups: {} });
});

test("closed groups survive a reload", () => {
  toggleSidebarGroup("website");
  toggleSidebarGroup("infra");
  reload();
  expect(getSidebarState().closedGroups).toEqual({ website: true, infra: true });
});

test("an open group is dropped on the way out and on the way back in", () => {
  patchSidebarState({ closedGroups: { website: true, infra: false } });
  expect(persisted()).toMatchObject({ closedGroups: { website: true } });

  // And again on the read, because the entry may have been written by an older
  // build that stored the open groups too.
  resetSidebarState();
  stored.set(KEY, JSON.stringify({ closedGroups: { website: true, infra: false } }));
  expect(getSidebarState().closedGroups).toEqual({ website: true });
});

// ── rejecting what was not written by this file ─────────────────────────────

test("reviveSidebarState refuses anything that is not an object", () => {
  expect(reviveSidebarState(null)).toEqual({});
  expect(reviveSidebarState(undefined)).toEqual({});
  expect(reviveSidebarState("grouped")).toEqual({});
  expect(reviveSidebarState([])).toEqual({});
});

test("a malformed field does not condemn the fields beside it", () => {
  // Why it hands back a Partial rather than the whole state or nothing: a
  // record written by a build with one fewer setting, or one whose single bad
  // entry would otherwise take the rest down, still gives the user back what
  // they did set.
  expect(reviveSidebarState({ grouped: "yes", showArchived: true })).toEqual({
    showArchived: true,
  });
  expect(reviveSidebarState({ grouped: true, closedGroups: ["website"] })).toEqual({
    grouped: true,
  });
  expect(reviveSidebarState({ grouped: true, closedGroups: "website" })).toEqual({
    grouped: true,
  });
});

test("a closedGroups entry that is not `true` is not a closed group", () => {
  expect(
    reviveSidebarState({ closedGroups: { a: true, b: false, c: 1, d: "true", e: null } }),
  ).toEqual({ closedGroups: { a: true } });
});

test("a non-JSON entry leaves the defaults standing", () => {
  stored.set(KEY, "not json");
  expect(getSidebarState()).toEqual(SIDEBAR_DEFAULT);
});

// ── storage that refuses to work ────────────────────────────────────────────

test("storage that throws neither throws back nor loses the defaults", () => {
  installBrokenStorage();
  resetSidebarState();
  expect(() => patchSidebarState({ grouped: true })).not.toThrow();
  resetSidebarState();
  expect(getSidebarState()).toEqual(SIDEBAR_DEFAULT);
});

test("no localStorage at all neither throws nor loses the defaults", () => {
  removeStorage();
  resetSidebarState();
  expect(() => patchSidebarState({ showArchived: true })).not.toThrow();
  resetSidebarState();
  expect(getSidebarState()).toEqual(SIDEBAR_DEFAULT);
  installStorage();
});
