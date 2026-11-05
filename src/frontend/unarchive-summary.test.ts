import { test, expect } from "bun:test";
import { unarchiveSummary } from "./unarchive-summary";
import type { UnarchivePreview } from "@/lib/xtmux/types";

function preview(over: Partial<UnarchivePreview> = {}): UnarchivePreview {
  return {
    checkout: "restore",
    snapshot: { state: "kept", expiresAt: Date.UTC(2026, 11, 5), stale: false },
    branch: "codetoaster/fix-the-parser",
    baseRef: "main",
    ...over,
  };
}

/** Prints the date it was handed, so the sentences do not depend on the
 * machine's locale and zone. */
const CALENDAR = { formatDate: (t: number) => new Date(t).toISOString().slice(0, 10) };

test("a task with no checkout of its own only resumes", () => {
  expect(
    unarchiveSummary(preview({ checkout: "none", snapshot: { state: "none" }, branch: null, baseRef: null })),
  ).toEqual(["It runs in the project's own directory, so unarchiving only resumes its agent."]);
});

test("the ordinary case: the checkout on its branch, the work from the snapshot", () => {
  expect(unarchiveSummary(preview())).toEqual([
    "Its checkout is rebuilt on codetoaster/fix-the-parser.",
    "Its uncommitted work comes back from the snapshot taken when it was archived.",
    "Its agent then resumes.",
  ]);
});

test("a branch the archive deleted is recreated where the snapshot was taken", () => {
  expect(unarchiveSummary(preview({ checkout: "from-snapshot" }))[0]).toBe(
    "codetoaster/fix-the-parser was deleted when it was archived, and is recreated at the commit the snapshot was taken on.",
  );
});

// AC #4: what cannot come back is said before anything is done.
test("an expired snapshot says the uncommitted work is lost, and since when", () => {
  const lines = unarchiveSummary(
    preview({ snapshot: { state: "expired", expiredAt: Date.UTC(2026, 9, 1) } }),
    CALENDAR,
  );
  expect(lines).toContain(
    "Its uncommitted work cannot be restored: the snapshot expired on 2026-10-01.",
  );
  expect(lines.some((l) => /comes back from the snapshot/.test(l))).toBe(false);
});

test("an expired snapshot with no date still says it is gone", () => {
  const lines = unarchiveSummary(preview({ snapshot: { state: "expired", expiredAt: null } }));
  expect(lines).toContain("Its uncommitted work cannot be restored: the snapshot is gone.");
});

test("a branch recreated from the remote says local-only commits are not on it", () => {
  const lines = unarchiveSummary(
    preview({ checkout: "from-remote", snapshot: { state: "expired", expiredAt: null } }),
  );
  expect(lines[0]).toBe(
    "codetoaster/fix-the-parser is gone, so it is recreated from origin/codetoaster/fix-the-parser. Commits that were only local are not on it.",
  );
});

test("a branch recreated from its base says its own commits are lost", () => {
  const lines = unarchiveSummary(
    preview({ checkout: "from-base", snapshot: { state: "expired", expiredAt: null } }),
  );
  expect(lines[0]).toBe(
    "codetoaster/fix-the-parser is gone and nothing else holds it, so it is recreated from main. Its own commits cannot be restored.",
  );
  // A base ref the row never recorded is what a create with none branched from.
  expect(unarchiveSummary(preview({ checkout: "from-base", baseRef: null }))[0]).toContain(
    "recreated from HEAD.",
  );
});

// The restore's guard, said ahead of it: the snapshot is not lost, but it is
// not applied either, and a dialog promising it back would be wrong.
test("a branch that moved says the snapshot is held back rather than applied", () => {
  const lines = unarchiveSummary(
    preview({ snapshot: { state: "kept", expiresAt: null, stale: true } }),
  );
  expect(lines[1]).toBe(
    "codetoaster/fix-the-parser has moved since the snapshot was taken, so its uncommitted work is held back to apply or discard rather than written over the newer commits.",
  );
});

test("no snapshot at all says the checkout comes back clean", () => {
  expect(unarchiveSummary(preview({ snapshot: { state: "none" } }))[1]).toBe(
    "No snapshot was kept, so the checkout comes back with no uncommitted changes.",
  );
});
