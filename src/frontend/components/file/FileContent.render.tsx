import { test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FileContent } from "./FileContent";
import type { FileContentResponse } from "@/frontend/types/file";

/**
 * The block appears once, as a header, and not again as body text (TASK-87
 * AC #1 and #5) — the only part of the feature that lives in the seam between
 * the response and the two views, so the only part the unit tests can't reach.
 */
const SOURCE = ["---", "id: TASK-1", "status: To Do", "---", "# Title", "", "Body text."];

const content: FileContentResponse = {
  isBinary: false,
  isImage: false,
  lines: SOURCE.map((content, i) => ({ lineNum: i + 1, content })),
  totalLines: SOURCE.length,
  frontmatter: {
    entries: [
      { key: "id", value: { kind: "text", text: "TASK-1" } },
      { key: "status", value: { kind: "text", text: "To Do" } },
    ],
    lineCount: 4,
  },
};

test("the preview draws the block as a header and drops it from the body", () => {
  const { container } = render(
    <FileContent filePath="task.md" taskId="t1" content={content} loading={false} lineWrap markdownPreview />,
  );

  // Header: the keys, once each, in the definition list.
  expect(Array.from(container.querySelectorAll("dt"), (dt) => dt.textContent)).toEqual(["id", "status"]);
  screen.getByText("TASK-1");

  // Body: the title survives, the raw YAML line does not.
  screen.getByRole("heading", { name: "Title" });
  expect(container.textContent).not.toContain("id: TASK-1");
});

test("the source view is untouched, block and all", () => {
  const { container } = render(
    <FileContent filePath="task.md" taskId="t1" content={content} loading={false} lineWrap />,
  );

  expect(container.querySelector("dl")).toBeNull();
  expect(container.textContent).toContain("id: TASK-1");
});
