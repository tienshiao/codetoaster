import { test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FrontmatterHeader } from "./FrontmatterHeader";
import type { FrontmatterEntry } from "@/types/frontmatter";

/**
 * The header's rendering of each value kind (TASK-87 AC #2).
 *
 * A rendering test rather than a `.test.ts` because the whole component *is*
 * conditional markup over a discriminated union — there is no function
 * underneath to interrogate instead.
 */
const ENTRIES: FrontmatterEntry[] = [
  { key: "id", value: { kind: "text", text: "TASK-1" } },
  { key: "ordinal", value: { kind: "scalar", text: "87000" } },
  { key: "labels", value: { kind: "list", items: ["frontend", "server"] } },
  { key: "assignee", value: { kind: "empty" } },
  { key: "meta", value: { kind: "block", yaml: "owner: tma\nphase: 4" } },
];

test("each value kind renders as itself", () => {
  const { container } = render(<FrontmatterHeader entries={ENTRIES} />);

  screen.getByText("TASK-1");
  expect(screen.getByText("87000").className).toContain("font-mono");
  // A list is badges, one per item — not a comma-joined string.
  screen.getByText("frontend");
  screen.getByText("server");
  // Written but saying nothing: a dash, so the row does not read as a bug.
  screen.getByText("—");
  const pre = container.querySelector("pre");
  expect(pre?.textContent).toBe("owner: tma\nphase: 4");
});

test("keys keep the file's order", () => {
  const { container } = render(<FrontmatterHeader entries={ENTRIES} />);

  const keys = Array.from(container.querySelectorAll("dt"), (dt) => dt.textContent);
  expect(keys).toEqual(["id", "ordinal", "labels", "assignee", "meta"]);
});

test("every key is paired with a value cell", () => {
  const { container } = render(<FrontmatterHeader entries={ENTRIES} />);

  expect(container.querySelectorAll("dd")).toHaveLength(ENTRIES.length);
});

test("a block with nothing in it draws no rule and no empty grid", () => {
  const { container } = render(<FrontmatterHeader entries={[]} />);

  expect(container.querySelector("dl")).toBeNull();
});
