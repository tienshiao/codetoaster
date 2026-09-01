import { test, expect } from "bun:test";
import { elidePath, pathLabel, tildePath } from "./path-label";

const HOME = "/Users/someone";

test("home becomes ~, and a trailing slash on home does not defeat it", () => {
  expect(tildePath("/Users/someone/projects/app", HOME)).toBe("~/projects/app");
  expect(tildePath("/Users/someone/projects/app", HOME + "/")).toBe("~/projects/app");
  expect(tildePath("/Users/someone", HOME)).toBe("~");
});

// The prefix has to be a whole segment. `/Users/someone2` is not inside
// `/Users/someone`, and a `startsWith` without the separator says it is.
test("a sibling directory that merely starts with home is left alone", () => {
  expect(tildePath("/Users/someone2/projects", HOME)).toBe("/Users/someone2/projects");
});

// The client is told `home` by the task snapshot, so there is a window before
// it has one — and an empty prefix that matched everything would turn every
// path into `~`-something.
test("no home yet means no abbreviation, not a prefix that matches everything", () => {
  expect(tildePath("/Users/someone/projects/app", "")).toBe("/Users/someone/projects/app");
});

test("a path that fits is returned untouched", () => {
  expect(elidePath("~/projects/app", 40)).toBe("~/projects/app");
});

// The tail is the answer to "where am I", so it is what survives — and the
// head stays so the path still says whether it is under home.
test("eliding drops from the middle and keeps the tail", () => {
  const long = "~/.codetoaster/worktrees/ct/4b55ec75-3bd6-4dbd";
  const short = elidePath(long, 30);
  expect(short.startsWith("~/…/")).toBe(true);
  expect(short.endsWith("4b55ec75-3bd6-4dbd")).toBe(true);
  expect(short.length).toBeLessThanOrEqual(30);
});

test("an absolute path keeps its leading slash", () => {
  const short = elidePath("/var/folders/sd/wpjz/T/some/deep/place", 20);
  expect(short.startsWith("/…/")).toBe(true);
  expect(short.endsWith("place")).toBe(true);
});

// Half a directory name is a name that does not exist, and a reader cannot tell
// it from a directory really called that. The container's overflow is the
// better place to lose characters.
test("a single segment too long to fit is returned whole rather than cut", () => {
  const one = "~/4b55ec75-3bd6-4dbd-a2e1-937affffb044";
  expect(elidePath(one, 10)).toBe(one);
});

test("pathLabel abbreviates before it elides, so the budget is not spent twice", () => {
  // Under home and short enough once `~` has done its work: no elision at all.
  expect(pathLabel("/Users/someone/projects/app", HOME, 20)).toBe("~/projects/app");
});
