import { test, expect, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { taskRoot } from "@/frontend/repo-root";
import { FileContent } from "./FileContent";
import type { FileContentResponse } from "@/frontend/types/file";

/**
 * The seam between FileContent and the table (TASK-119): which files become a
 * table, that a quoted field spanning lines is one cell, and that the body is
 * virtualized. The parser's cases live in delimited.test.ts.
 */

function contentOf(text: string): FileContentResponse {
  const lines = text.split("\n");
  return {
    isBinary: false,
    isImage: false,
    lines: lines.map((content, i) => ({ lineNum: i + 1, content })),
    totalLines: lines.length,
  };
}

// Happy DOM has no layout, and the virtualizer sizes its viewport and rows from
// offsetHeight/offsetWidth: make the scroll container 240px tall (about ten
// rows) and every other element one 24px row.
const realHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!;
const realWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth")!;
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains("overflow-auto") ? 240 : 24;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 800 });
});
afterEach(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", realHeight);
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", realWidth);
});

function cells(row: Element): string[] {
  return Array.from(row.querySelectorAll('[role="cell"]'), (c) => c.textContent ?? "");
}

test("a CSV renders as a table with a header, and a quoted newline stays in its cell", () => {
  const { container } = render(
    <FileContent
      filePath="people.csv"
      root={taskRoot("t1")}
      content={contentOf('name,note\nada,"first\nprogrammer"\nbob,x\n')}
      loading={false}
      lineWrap={false}
      markdownPreview
    />,
  );
  const rows = container.querySelectorAll('[role="row"]');
  expect(cells(rows[0]!)).toEqual(["name", "note"]);
  expect(cells(rows[1]!)).toEqual(["ada", "first\nprogrammer"]);
  expect(cells(rows[2]!)).toEqual(["bob", "x"]);
});

test("a TSV splits on tabs, and a ragged row is padded to the widest", () => {
  const { container } = render(
    <FileContent
      filePath="t.tsv"
      root={taskRoot("t1")}
      content={contentOf("a\tb\n1,5\n1\t2\t3")}
      loading={false}
      lineWrap={false}
      markdownPreview
    />,
  );
  const rows = container.querySelectorAll('[role="row"]');
  expect(cells(rows[0]!)).toEqual(["a", "b", ""]);
  expect(cells(rows[1]!)).toEqual(["1,5", "", ""]);
  expect(cells(rows[2]!)).toEqual(["1", "2", "3"]);
});

test("with the preview off, a CSV is source lines", () => {
  const { container } = render(
    <FileContent
      filePath="people.csv"
      root={taskRoot("t1")}
      content={contentOf("name,age\nada,36")}
      loading={false}
      lineWrap={false}
      markdownPreview={false}
    />,
  );
  expect(container.querySelector('[role="table"]')).toBeNull();
  expect(container.querySelector('[data-line="2"]')?.textContent).toContain("ada,36");
});

test("a long file renders only a window of its rows", () => {
  const text = ["id,value", ...Array.from({ length: 50_000 }, (_, i) => `${i},${i * 2}`)].join("\n");
  const { container } = render(
    <FileContent
      filePath="big.csv"
      root={taskRoot("t1")}
      content={contentOf(text)}
      loading={false}
      lineWrap={false}
      markdownPreview
    />,
  );
  const rendered = container.querySelectorAll('[role="row"]').length;
  expect(rendered).toBeGreaterThan(1);
  expect(rendered).toBeLessThan(100);
  expect(container.querySelector('[role="table"]')?.getAttribute("aria-rowcount")).toBe("50001");
});
