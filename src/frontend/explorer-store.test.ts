import { test, expect, beforeEach } from "bun:test";
import {
  EXPLORER_DEFAULT,
  loadExplorerState,
  reviveExplorerState,
  saveExplorerState,
} from "./explorer-store";
import { installBrokenStorage, installStorage, removeStorage } from "../../test/local-storage";

const KEY = "codetoaster:explorer";

let stored: Map<string, string>;

beforeEach(() => {
  stored = installStorage();
});

// ── defaults and round trip ─────────────────────────────────────────────────

test("nothing stored gives the default: open, on Changes, Backlog on Open", () => {
  expect(loadExplorerState()).toEqual({ open: true, section: "Changes", backlogTab: "Open" });
  expect(loadExplorerState()).toEqual(EXPLORER_DEFAULT);
});

test("a saved state comes back", () => {
  saveExplorerState({ open: true, section: "Refs", backlogTab: "Open" });
  expect(loadExplorerState()).toEqual({ open: true, section: "Refs", backlogTab: "Open" });
});

test("a shut panel comes back shut", () => {
  saveExplorerState({ open: false, section: "History", backlogTab: "Open" });
  expect(loadExplorerState()).toEqual({ open: false, section: "History", backlogTab: "Open" });
});

test("the panel is one window-wide key, not one per task", () => {
  saveExplorerState({ open: false, section: "Files", backlogTab: "Open" });
  expect([...stored.keys()]).toEqual([KEY]);
});

// ── the Backlog tab (TASK-85) ───────────────────────────────────────────────

test("the Backlog section's Closed tab survives a reload", () => {
  saveExplorerState({ open: true, section: "Backlog", backlogTab: "Closed" });
  expect(loadExplorerState()).toEqual({ open: true, section: "Backlog", backlogTab: "Closed" });
});

test("a state written before the tab existed keeps its section", () => {
  // Every build before TASK-85 wrote an entry with no `backlogTab`. Rejecting
  // the whole object over a field added later would throw away the section and
  // the open flag of everyone who upgrades.
  stored.set(KEY, JSON.stringify({ open: false, section: "Refs" }));
  expect(loadExplorerState()).toEqual({ open: false, section: "Refs", backlogTab: "Open" });
});

test("an unknown backlogTab costs the tab, not the state", () => {
  stored.set(KEY, JSON.stringify({ open: false, section: "Refs", backlogTab: "Archived" }));
  expect(loadExplorerState()).toEqual({ open: false, section: "Refs", backlogTab: "Open" });
});

// ── rejecting what was not written by this file ─────────────────────────────

test("a non-JSON entry falls back to the default", () => {
  stored.set(KEY, "not json");
  expect(loadExplorerState()).toEqual(EXPLORER_DEFAULT);
});

test("a missing `open` falls back", () => {
  stored.set(KEY, JSON.stringify({ section: "Refs", backlogTab: "Open" }));
  expect(loadExplorerState()).toEqual(EXPLORER_DEFAULT);
});

test("a non-boolean `open` falls back", () => {
  stored.set(KEY, JSON.stringify({ open: "yes", section: "Refs", backlogTab: "Open" }));
  expect(loadExplorerState()).toEqual(EXPLORER_DEFAULT);
});

test("a section that is not one of EXPLORER_SECTIONS falls back", () => {
  // The case that matters: a build that renamed or dropped a section would
  // otherwise leave the rail pointing at one that no longer exists.
  stored.set(KEY, JSON.stringify({ open: true, section: "Commits", backlogTab: "Open" }));
  expect(loadExplorerState()).toEqual(EXPLORER_DEFAULT);
});

// ── storage that refuses to work ────────────────────────────────────────────

test("broken storage neither throws nor loses the default", () => {
  installBrokenStorage();
  expect(() => saveExplorerState({ open: false, section: "Files", backlogTab: "Open" })).not.toThrow();
  expect(loadExplorerState()).toEqual(EXPLORER_DEFAULT);
});

test("no localStorage at all neither throws nor loses the default", () => {
  removeStorage();
  expect(() =>
    saveExplorerState({ open: false, section: "Files", backlogTab: "Open" }),
  ).not.toThrow();
  expect(loadExplorerState()).toEqual(EXPLORER_DEFAULT);
  installStorage();
});

// ── reviveExplorerState ─────────────────────────────────────────────────────

test("reviveExplorerState rejects everything that is not the shape", () => {
  expect(reviveExplorerState(null)).toBeNull();
  expect(reviveExplorerState(undefined)).toBeNull();
  expect(reviveExplorerState([])).toBeNull();
  expect(reviveExplorerState("Changes")).toBeNull();
  expect(reviveExplorerState({})).toBeNull();
  expect(reviveExplorerState({ open: true })).toBeNull();
  expect(reviveExplorerState({ open: true, section: "changes" })).toBeNull();
  // But a bad `backlogTab` is a field, not the state — see below.
});

test("reviveExplorerState accepts the shape it wrote", () => {
  expect(reviveExplorerState({ open: false, section: "History", backlogTab: "Closed" })).toEqual({
    open: false,
    section: "History",
    backlogTab: "Closed",
  });
});
