import { test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TaskRow, type TaskRowWorktreeFacts } from "./TaskRow";

/**
 * What a row says about its checkout (§5.6, TASK-32 AC #5).
 *
 * All of these are really one assertion, made from several directions: **the
 * row states only what has been established.** The facts arrive after the row
 * does — they cost git processes, so the server sends the list first and fills
 * them in — and every one of them is separately unknowable, so there is a
 * standing temptation to draw a zero where the answer has not come back. A
 * zero is a claim. These tests are what stops one being made.
 *
 * A rendering test rather than a `.test.ts` because the question is what ends
 * up on screen for a given set of props, and the answer is conditional markup;
 * there is no pure function underneath it to interrogate instead.
 */

const facts = (over: Partial<TaskRowWorktreeFacts> = {}): TaskRowWorktreeFacts => ({
  branch: "fix/parser",
  dirty: 0,
  unpushed: 0,
  merged: false,
  ...over,
});

test("an unmeasured checkout shows no git facts, and no zero standing in for one", () => {
  render(<TaskRow title="Fix the parser" worktree worktreeFacts={null} meta="4m" />);

  // Not "there is nothing to report" — nobody has looked yet. The row is on
  // screen regardless, which is the whole of "without blocking render".
  screen.getByRole("option", { name: /Fix the parser/ });
  expect(screen.queryByLabelText(/uncommitted/)).toBeNull();
  expect(screen.queryByLabelText(/unpushed/)).toBeNull();
  expect(screen.queryByText("0")).toBeNull();
});

test("a measured checkout shows its branch and the counts that are not zero", () => {
  render(<TaskRow title="Fix the parser" worktree worktreeFacts={facts({ dirty: 3, unpushed: 2 })} />);

  screen.getByText("fix/parser");
  screen.getByLabelText("3 uncommitted files");
  screen.getByLabelText("2 unpushed commits");
});

test("a measured checkout that is clean and unmoved reports neither as a zero", () => {
  render(<TaskRow title="Fix the parser" worktree worktreeFacts={facts()} />);

  // The branch still shows: it is a fact, and one that answers "which of these
  // is that branch I was on". The counts do not, because a row of zeroes in a
  // list of thirty is noise that reads like data.
  screen.getByText("fix/parser");
  expect(screen.queryByLabelText(/uncommitted/)).toBeNull();
  expect(screen.queryByLabelText(/unpushed/)).toBeNull();
});

test("a dirty count git could not establish is left out, not drawn as none", () => {
  render(<TaskRow title="Fix the parser" worktree worktreeFacts={facts({ dirty: null, unpushed: 1 })} />);

  expect(screen.queryByLabelText(/uncommitted/)).toBeNull();
  // The rest of the line is unaffected: one unanswerable question does not
  // suppress the answers we do have.
  screen.getByLabelText("1 unpushed commit");
});

test("a merged task gets the archive nudge, and an unmerged one does not", () => {
  const view = render(<TaskRow title="Fix the parser" worktree worktreeFacts={facts()} />);
  expect(screen.queryByLabelText(/archive/)).toBeNull();

  view.rerender(<TaskRow title="Fix the parser" worktree worktreeFacts={facts({ merged: true })} />);
  screen.getByLabelText("merged into its base — archive?");
});

test("a task with no checkout of its own carries none of this", () => {
  render(<TaskRow title="Fix the parser" meta="4m" />);

  expect(screen.queryByLabelText(/uncommitted/)).toBeNull();
  expect(screen.queryByLabelText(/archive/)).toBeNull();
});

test("an archived row says so, and stops describing a checkout that is gone", () => {
  render(
    <TaskRow
      title="Fix the parser"
      archived
      worktree
      worktreeFacts={facts({ dirty: 3, unpushed: 1 })}
    />,
  );

  screen.getByLabelText("archived");
  // The archive removed the checkout, so the counts describe nothing that is
  // still on disk — and the branch glyph would name a branch it may have
  // deleted.
  expect(screen.queryByLabelText(/uncommitted/)).toBeNull();
  expect(screen.queryByLabelText(/unpushed/)).toBeNull();
});
