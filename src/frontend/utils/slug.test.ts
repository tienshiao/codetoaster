import { test, expect } from "bun:test";
import { buildTaskSlug, parseTaskSlug } from "./slug";

const ID = "0b7f3a2e-4c11-4b8a-9d1e-6f2a5c9e7d34";

test("a slug carries the title as a prefix and the id as the address", () => {
  expect(buildTaskSlug({ title: "Fix the resume ladder", id: ID })).toBe(
    `fix-the-resume-ladder-${ID}`,
  );
  expect(parseTaskSlug(`fix-the-resume-ladder-${ID}`)).toEqual({
    title: "fix-the-resume-ladder",
    id: ID,
  });
});

test("a rename changes only the prefix, so links written before it still resolve", () => {
  const before = buildTaskSlug({ title: "Untitled task", id: ID });
  const after = buildTaskSlug({ title: "Port the git view to v2", id: ID });

  expect(before).not.toBe(after);
  expect(parseTaskSlug(before).id).toBe(ID);
  expect(parseTaskSlug(after).id).toBe(ID);
});

test("a title that slugifies to nothing still addresses its task", () => {
  // Terminal titles arrive from OSC sequences, so a title can be punctuation
  // alone. The slug degrades to a leading hyphen rather than to a broken link.
  const slug = buildTaskSlug({ title: "!!!", id: ID });
  expect(parseTaskSlug(slug).id).toBe(ID);
});

test("unicode and separators collapse to one hyphen each", () => {
  expect(buildTaskSlug({ title: "  Fix   TASK-47 / résumé  ", id: ID })).toBe(
    `fix-task-47-r-sum-${ID}`,
  );
});
