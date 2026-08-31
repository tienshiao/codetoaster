import { test, expect, vi, beforeEach, describe } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { TaskInfo } from "../../lib/xtmux/types";
import type { TaskResult } from "../TaskContext";

/**
 * The decision a refused snapshot leaves behind (§5.6, TASK-63).
 *
 * The three answers are tested against the manager in
 * `lib/tasks/worktree.test.ts`, which is where they mean anything. What is only
 * true here is which of them reaches the server at all: "decide later" must
 * send nothing, because the row going on saying the decision is outstanding is
 * the entire mechanism by which it is asked again — and a "Later" that quietly
 * discarded would lose the work.
 */

const stubs = vi.hoisted(() => ({
  resolveWip:
    vi.fn<(id: string, action: "apply" | "discard") => Promise<TaskResult<unknown>>>(),
}));

vi.mock("@/frontend/TaskContext", () => ({
  useTasks: () => ({ resolveWip: stubs.resolveWip }),
}));

const { WipNotice } = await import("./WipNotice");

beforeEach(() => {
  stubs.resolveWip.mockReset();
  stubs.resolveWip.mockResolvedValue({ ok: true, value: {} } as TaskResult<unknown>);
});

test("says what happened and offers all three answers", () => {
  render(<WipNotice taskId="t1" />);

  expect(screen.getByRole("status").textContent)
    .toMatch(/branch moved while the task was away/i);
  for (const label of ["Apply", "Later", "Discard"]) {
    expect(screen.getByRole("button", { name: label })).toBeTruthy();
  }
});

test("discard goes straight through", () => {
  render(<WipNotice taskId="t1" />);

  fireEvent.click(screen.getByRole("button", { name: "Discard" }));

  expect(stubs.resolveWip).toHaveBeenCalledExactlyOnceWith("t1", "discard");
});

// The one with teeth: it writes over a checkout the user may have been working
// in since the restore, so it asks first — and the sentence names what it
// overwrites rather than asking whether they are sure.
describe("apply", () => {
  test("confirms before writing, and sends nothing if cancelled", () => {
    render(<WipNotice taskId="t1" />);

    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByText(/written over whatever is in the checkout now/i)).toBeTruthy();
    expect(stubs.resolveWip).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(stubs.resolveWip).not.toHaveBeenCalled();
    // Still outstanding: cancelling a confirmation is not an answer.
    expect(screen.queryByRole("status")).not.toBeNull();
  });

  test("sends once the confirmation is accepted", () => {
    render(<WipNotice taskId="t1" />);

    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    // The dialog's own affirmative, not the notice's button that opened it.
    const buttons = screen.getAllByRole("button", { name: "Apply" });
    fireEvent.click(buttons[buttons.length - 1]!);

    expect(stubs.resolveWip).toHaveBeenCalledExactlyOnceWith("t1", "apply");
  });
});

// AC #4, and the reason "Later" has no endpoint. Dismissing is local and
// deliberately unpersisted: the work is still sitting in a ref, and a
// dismissal the server remembered would be a promise to forget about it that
// nothing has made.
test("later dismisses without asking the server anything", () => {
  render(<WipNotice taskId="t1" />);

  fireEvent.click(screen.getByRole("button", { name: "Later" }));

  expect(screen.queryByRole("status")).toBeNull();
  expect(stubs.resolveWip).not.toHaveBeenCalled();
});
