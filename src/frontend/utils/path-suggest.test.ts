import { test, expect } from "bun:test";
import {
  ancestorsOf,
  childPath,
  expandTilde,
  moveSelection,
  suggestionValue,
  toDisplayPath,
} from "./path-suggest";

const HOME = "/Users/tma";

test("tilde expands only as a whole first segment", () => {
  expect(expandTilde("~", HOME)).toBe(HOME);
  expect(expandTilde("~/Projects", HOME)).toBe("/Users/tma/Projects");
  // A directory that merely starts with a tilde is not the home directory.
  expect(expandTilde("~backup/notes", HOME)).toBe("~backup/notes");
  expect(expandTilde("/etc", HOME)).toBe("/etc");
  // Without a known home there is nothing to expand against.
  expect(expandTilde("~/Projects", "")).toBe("~/Projects");
});

test("display paths are the inverse, and leave anything outside home alone", () => {
  expect(toDisplayPath(HOME, HOME)).toBe("~");
  expect(toDisplayPath("/Users/tma/Projects", HOME)).toBe("~/Projects");
  expect(toDisplayPath("/Users/tmason/Projects", HOME)).toBe("/Users/tmason/Projects");
  expect(toDisplayPath("/etc", HOME)).toBe("/etc");
});

test("joining under root does not double the separator", () => {
  expect(childPath("/", "Users")).toBe("/Users");
  expect(childPath("/Users", "tma")).toBe("/Users/tma");
});

test("the ancestor chain starts at root and includes the path itself", () => {
  expect(ancestorsOf("/Users/tma/Projects")).toEqual([
    "/",
    "/Users",
    "/Users/tma",
    "/Users/tma/Projects",
  ]);
  expect(ancestorsOf("/")).toEqual(["/"]);
});

test("accepting a suggestion keeps the tilde and asks for what is inside", () => {
  expect(suggestionValue("~", "Projects")).toBe("~/Projects/");
  expect(suggestionValue("~/Projects", "codetoaster")).toBe("~/Projects/codetoaster/");
  // Root answers with an empty parent, which is the one case a naive join
  // would turn into "//Users/".
  expect(suggestionValue("", "Users")).toBe("/Users/");
});

test("the highlight clamps at both ends instead of wrapping", () => {
  expect(moveSelection(0, 3, 1)).toBe(1);
  expect(moveSelection(2, 3, 1)).toBe(2);
  expect(moveSelection(0, 3, -1)).toBe(0);
  expect(moveSelection(0, 0, 1)).toBe(0);
});
