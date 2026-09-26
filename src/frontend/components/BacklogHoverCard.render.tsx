import { test, expect, describe, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BacklogHoverCard } from "./BacklogHoverCard";
import type { BacklogTask } from "@/types/backlog";

/**
 * The Backlog card's contents (TASK-114).
 *
 * As with `CommitHoverCard.render`, what is worth asserting is the projection:
 * which of a task's fields reach the card and which draw nothing. The card is
 * forced open with the `open` prop rather than hovered — Radix's open delay is
 * a `setTimeout` over pointer events and happy-dom has no pointer to move, so a
 * test driving it would be asserting Radix's timers rather than this component.
 */

const TITLE = "Backlog cards in the Explorer: hover card with the description and dates";
const DESCRIPTION =
  "The row truncates the title at 272px.\n\nSo scanning for a task meant opening files one by one.";

function task(over: Partial<BacklogTask> = {}): BacklogTask {
  return {
    id: "TASK-114",
    title: TITLE,
    status: "In Progress",
    ordinal: 1000,
    priority: "medium",
    labels: ["frontend", "ui"],
    assignee: ["@claude", "@tma"],
    path: "backlog/tasks/task-114 - Hover.md",
    description: DESCRIPTION,
    createdDate: "2026-09-26 02:57",
    updatedDate: "2026-09-26 03:43",
    dependencies: ["TASK-102", "TASK-97"],
    parent: "TASK-85",
    acceptance: { done: 2, total: 6 },
    ...over,
  };
}

function open(over: Partial<BacklogTask> = {}) {
  render(
    <BacklogHoverCard open task={task(over)}>
      <button type="button">row</button>
    </BacklogHoverCard>,
  );
}

describe("what the row could not fit", () => {
  test("the title is shown whole, after the id (AC #1)", () => {
    open();
    screen.getByText(TITLE);
    screen.getByText("TASK-114");
  });

  test("the description is shown, newlines and all (AC #1)", () => {
    open();
    // Matched loosely and then compared exactly: Testing Library collapses
    // whitespace when it matches, and the paragraph break is what has to have
    // survived the parser and `whitespace-pre-wrap`.
    const body = screen.getByText(/The row truncates the title/);
    expect(body.textContent).toBe(DESCRIPTION);
  });

  test("each fact comes from its own field (AC #2)", () => {
    open();

    for (const [label, value] of [
      ["Status", "In Progress"],
      ["Priority", "medium"],
      ["Assignee", "@claude, @tma"],
      ["Labels", "frontend, ui"],
      ["Parent", "TASK-85"],
      ["Deps", "TASK-102, TASK-97"],
      ["Criteria", "2/6 done"],
      ["Created", "2026-09-26 02:57"],
      ["Updated", "2026-09-26 03:43"],
    ] as const) {
      const dt = screen.getByText(label);
      expect(dt.tagName).toBe("DT");
      // The value in the same pair, not merely somewhere on the card.
      expect(dt.nextElementSibling?.textContent).toBe(value);
    }
  });
});

describe("a task with little in it", () => {
  test("draws no label for a fact it lacks, and no empty description (AC #2)", () => {
    open({
      description: "",
      priority: null,
      assignee: [],
      labels: [],
      parent: null,
      dependencies: [],
      acceptance: { done: 0, total: 0 },
      createdDate: null,
      updatedDate: null,
    });

    screen.getByText(TITLE);
    // Status is the one fact every task has.
    screen.getByText("Status");
    for (const label of [
      "Priority",
      "Assignee",
      "Labels",
      "Parent",
      "Deps",
      "Criteria",
      "Created",
      "Updated",
    ]) {
      expect(screen.queryByText(label)).toBeNull();
    }
    expect(screen.queryByText(/The row truncates the title/)).toBeNull();
  });

  test("criteria all unchecked still say how many there are", () => {
    open({ acceptance: { done: 0, total: 3 } });
    screen.getByText("0/3 done");
  });
});

describe("closed", () => {
  test("nothing of the card is in the document until it opens", () => {
    render(
      <BacklogHoverCard task={task()}>
        <button type="button">row</button>
      </BacklogHoverCard>,
    );

    screen.getByRole("button", { name: "row" });
    expect(screen.queryByText("Status")).toBeNull();
    expect(screen.queryByText(/The row truncates the title/)).toBeNull();
  });
});

describe("the trigger", () => {
  test("wraps the row rather than replacing it, and keeps its click (AC #3)", () => {
    const onClick = vi.fn();
    render(
      <BacklogHoverCard open task={task()}>
        <button type="button" data-testid="row" className="w-full" onClick={onClick}>
          row
        </button>
      </BacklogHoverCard>,
    );

    const row = screen.getByTestId("row");
    expect(row.className).toContain("w-full");
    row.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
