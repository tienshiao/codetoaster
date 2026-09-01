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

test("nothing stored gives the default: open, on Changes", () => {
  expect(loadExplorerState()).toEqual({ open: true, section: "Changes" });
  expect(loadExplorerState()).toEqual(EXPLORER_DEFAULT);
});

test("a saved state comes back", () => {
  saveExplorerState({ open: true, section: "Refs" });
  expect(loadExplorerState()).toEqual({ open: true, section: "Refs" });
});

test("a shut panel comes back shut", () => {
  saveExplorerState({ open: false, section: "History" });
  expect(loadExplorerState()).toEqual({ open: false, section: "History" });
});

test("the panel is one window-wide key, not one per task", () => {
  saveExplorerState({ open: false, section: "Files" });
  expect([...stored.keys()]).toEqual([KEY]);
});

// ── rejecting what was not written by this file ─────────────────────────────

test("a non-JSON entry falls back to the default", () => {
  stored.set(KEY, "not json");
  expect(loadExplorerState()).toEqual(EXPLORER_DEFAULT);
});

test("a missing `open` falls back", () => {
  stored.set(KEY, JSON.stringify({ section: "Refs" }));
  expect(loadExplorerState()).toEqual(EXPLORER_DEFAULT);
});

test("a non-boolean `open` falls back", () => {
  stored.set(KEY, JSON.stringify({ open: "yes", section: "Refs" }));
  expect(loadExplorerState()).toEqual(EXPLORER_DEFAULT);
});

test("a section that is not one of EXPLORER_SECTIONS falls back", () => {
  // The case that matters: a build that renamed or dropped a section would
  // otherwise leave the rail pointing at one that no longer exists.
  stored.set(KEY, JSON.stringify({ open: true, section: "Commits" }));
  expect(loadExplorerState()).toEqual(EXPLORER_DEFAULT);
});

// ── storage that refuses to work ────────────────────────────────────────────

test("broken storage neither throws nor loses the default", () => {
  installBrokenStorage();
  expect(() => saveExplorerState({ open: false, section: "Files" })).not.toThrow();
  expect(loadExplorerState()).toEqual(EXPLORER_DEFAULT);
});

test("no localStorage at all neither throws nor loses the default", () => {
  removeStorage();
  expect(() => saveExplorerState({ open: false, section: "Files" })).not.toThrow();
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
});

test("reviveExplorerState accepts the shape it wrote", () => {
  expect(reviveExplorerState({ open: false, section: "History" })).toEqual({
    open: false,
    section: "History",
  });
});
