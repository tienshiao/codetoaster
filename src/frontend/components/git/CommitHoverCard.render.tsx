import { test, expect, describe, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CommitHoverCard } from "./CommitHoverCard";
import { absoluteDate } from "../../utils/relativeDate";
import type { GitLogCommit } from "../../types/git";

/**
 * The commit card's contents (TASK-102).
 *
 * As with `TaskHoverCard.render`, what is worth asserting is the projection:
 * which of a commit's fields reach the card and which draw nothing. The card is
 * forced open with the `open` prop rather than hovered — Radix's open delay is
 * a `setTimeout` over pointer events and happy-dom has no pointer to move, so a
 * test driving it would be asserting Radix's timers rather than this component.
 */

const SUBJECT =
  "fix: the log window no longer resets when a fetch lands during pagination";
const BODY =
  "The drift check ran against the page that was in flight.\n\nSo a 409 during an append reset a window the user was reading.";

function commit(over: Partial<GitLogCommit> = {}): GitLogCommit {
  return {
    hash: "9f2c1ab7d3e4f5061728394a5b6c7d8e9f001122",
    parents: ["a".repeat(40)],
    refs: [],
    author: "Ada Lovelace",
    email: "ada@example.com",
    date: 1700000000,
    subject: SUBJECT,
    body: BODY,
    ...over,
  };
}

function open(over: Partial<GitLogCommit> = {}) {
  render(
    <CommitHoverCard open commit={commit(over)}>
      <button type="button">row</button>
    </CommitHoverCard>,
  );
}

describe("what the row could not fit", () => {
  test("the subject is shown whole (AC #1)", () => {
    // Truncated to whatever is left beside the graph and the chips in the row;
    // here, all of it.
    open();
    screen.getByText(SUBJECT);
  });

  test("the body is shown, newlines and all (AC #2)", () => {
    open();
    // Matched loosely and then compared exactly: Testing Library collapses
    // whitespace when it matches, and the paragraph break is precisely what has
    // to have survived the parser and `whitespace-pre-wrap`.
    const body = screen.getByText(/The drift check ran against/);
    expect(body.textContent).toBe(BODY);
  });

  test("the sha, author and date are named (AC #2)", () => {
    open();

    screen.getByText("SHA");
    screen.getByText("9f2c1ab7");
    screen.getByText("Author");
    screen.getByText("Ada Lovelace");
    screen.getByText("Date");
    screen.getByText(absoluteDate(1700000000));
  });
});

describe("a subject-only commit", () => {
  test("draws no body block rather than an empty one", () => {
    open({ body: "" });

    screen.getByText(SUBJECT);
    // Nothing but the subject and the facts: an empty paragraph would leave a
    // gap the card has no reason for.
    expect(screen.queryByText(/The drift check ran against/)).toBeNull();
    // The facts are still there — the row shows neither in the compact panel.
    screen.getByText("9f2c1ab7");
  });
});

describe("closed", () => {
  test("nothing of the card is in the document until it opens", () => {
    render(
      <CommitHoverCard commit={commit()}>
        <button type="button">row</button>
      </CommitHoverCard>,
    );

    screen.getByRole("button", { name: "row" });
    expect(screen.queryByText(SUBJECT)).toBeNull();
    expect(screen.queryByText("SHA")).toBeNull();
  });
});

describe("the trigger", () => {
  test("wraps the row rather than replacing it, and keeps its click (AC #4)", () => {
    const onClick = vi.fn();
    render(
      <CommitHoverCard open commit={commit()}>
        <button type="button" data-testid="row" className="w-full h-7" onClick={onClick}>
          row
        </button>
      </CommitHoverCard>,
    );

    // `asChild`: the element the virtualizer positioned is still the element on
    // screen, with its own classes and its own handler.
    const row = screen.getByTestId("row");
    expect(row.className).toContain("w-full");
    row.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("on a device with no pointer", () => {
  test("the row is drawn bare, with no trigger wrapped around it", () => {
    // Radix's trigger calls `preventDefault()` on `touchstart`, which would
    // suppress the emulated click and stop the tap selecting the commit.
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({
          matches: false,
          media: query,
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList,
    );

    render(
      <CommitHoverCard open commit={commit()}>
        <button type="button">row</button>
      </CommitHoverCard>,
    );

    screen.getByRole("button", { name: "row" });
    // Forced open and still nothing: the card is not merely closed here, it
    // does not exist.
    expect(screen.queryByText(SUBJECT)).toBeNull();
    expect(screen.queryByText("SHA")).toBeNull();
  });
});
