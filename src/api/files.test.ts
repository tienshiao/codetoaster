import { test, expect } from "bun:test";
import { serializeFileContent } from "./files";
import type { Frontmatter } from "../types/frontmatter";

/**
 * What the file routes say about a markdown file's frontmatter (TASK-87).
 *
 * The serializer is shared by `GET /api/tasks/:id/file` and the git file route,
 * so these cover both; going through the real function rather than the shaping
 * helper is deliberate, since the field being *absent* — not null, not empty —
 * is half of what the client keys off.
 */
function buffer(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

type TextResult = Awaited<ReturnType<typeof serializeFileContent>> & {
  lines?: { lineNum: number; content: string }[];
  frontmatter?: Frontmatter;
};

const EVERY_KIND = `---
id: TASK-1
title: >-
  A folded title that
  wraps
ordinal: 87000
done: false
labels:
  - frontend
  - server
assignee: []
priority: null
meta:
  owner: tma
  phase: 4
steps:
  - name: one
  - name: two
---
# Title

Body text.
`;

test("every value kind is shaped for the header, in the file's key order", async () => {
  const result = (await serializeFileContent(buffer(EVERY_KIND), "backlog/tasks/task-1.md")) as TextResult;

  expect(result.frontmatter?.entries).toEqual([
    { key: "id", value: { kind: "text", text: "TASK-1" } },
    // A folded scalar arrives from the parser already joined; it is a string
    // like any other by the time it is shaped.
    { key: "title", value: { kind: "text", text: "A folded title that wraps" } },
    { key: "ordinal", value: { kind: "scalar", text: "87000" } },
    { key: "done", value: { kind: "scalar", text: "false" } },
    { key: "labels", value: { kind: "list", items: ["frontend", "server"] } },
    { key: "assignee", value: { kind: "empty" } },
    { key: "priority", value: { kind: "empty" } },
    { key: "meta", value: { kind: "block", yaml: "owner: tma\nphase: 4" } },
    { key: "steps", value: { kind: "block", yaml: "- name: one\n- name: two" } },
  ]);
});

test("lineCount spans the block including both fences", async () => {
  const result = (await serializeFileContent(buffer(EVERY_KIND), "task.md")) as TextResult;

  expect(result.frontmatter?.lineCount).toBe(19);
  // What the preview renders after the slice — the body, starting at its title.
  expect(result.lines?.[19]?.content).toBe("# Title");
  // And the raw block is still in `lines`, because the source view shows it.
  expect(result.lines?.[1]?.content).toBe("id: TASK-1");
});

test("a block that will not parse leaves the field off and the lines intact", async () => {
  const source = "---\ntitle: [unclosed\n---\n# Title\n";
  const result = (await serializeFileContent(buffer(source), "task.md")) as TextResult;

  expect("frontmatter" in result).toBe(false);
  expect(result.lines?.map((l) => l.content)).toEqual(["---", "title: [unclosed", "---", "# Title", ""]);
});

test("a block that parses to a list is not a mapping, so there is no field", async () => {
  const result = (await serializeFileContent(buffer("---\n- a\n- b\n---\n# Title\n"), "task.md")) as TextResult;

  expect("frontmatter" in result).toBe(false);
});

test("a scalar block is not a mapping either", async () => {
  const result = (await serializeFileContent(buffer("---\njust a string\n---\nbody\n"), "task.md")) as TextResult;

  expect("frontmatter" in result).toBe(false);
});

test("a leading --- in a non-markdown file is code, not frontmatter", async () => {
  const source = "---\nid: TASK-1\n---\nconst x = 1;\n";
  const result = (await serializeFileContent(buffer(source), "src/thing.ts")) as TextResult;

  expect("frontmatter" in result).toBe(false);
});

test(".markdown and .mdx are markdown too, whatever the case of the extension", async () => {
  for (const name of ["notes.markdown", "page.mdx", "README.MD"]) {
    const result = (await serializeFileContent(buffer("---\nid: TASK-1\n---\n# Hi\n"), name)) as TextResult;
    expect(result.frontmatter?.entries).toEqual([{ key: "id", value: { kind: "text", text: "TASK-1" } }]);
  }
});

test("a markdown file with no block carries no field", async () => {
  const result = (await serializeFileContent(buffer("# Title\n\nBody.\n"), "task.md")) as TextResult;

  expect("frontmatter" in result).toBe(false);
});
