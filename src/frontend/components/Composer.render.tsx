import { test, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { TaskResult } from "../TaskContext";
import type { ProjectInfo, TaskInfo } from "../../lib/xtmux/types";

/**
 * The composer's submit path: what ⌘⏎ does, what it refuses to do, and what
 * happens to the user's text when the create fails. All of it needs a mounted
 * tree, so this is Vitest's, not `bun test`'s — see CLAUDE.md, "Testing".
 *
 * The store and the navigation are both stubbed, because neither is the
 * subject: what matters is the payload the composer builds and the state it
 * keeps when the answer comes back.
 */

const stubs = vi.hoisted(() => ({
  createTask: vi.fn<(options?: unknown) => Promise<TaskResult<TaskInfo>>>(),
  openTask: vi.fn(),
  projects: [] as ProjectInfo[],
}));

vi.mock("@/frontend/TaskContext", () => ({
  useTasks: () => ({ projects: stubs.projects, createTask: stubs.createTask }),
}));
vi.mock("@/frontend/hooks/use-task-nav", () => ({ useOpenTask: () => stubs.openTask }));

const { Composer } = await import("./Composer");

function project(id: string, overrides: Partial<ProjectInfo> = {}): ProjectInfo {
  return {
    id,
    name: id,
    initialPath: "",
    taskIds: [],
    defaultModel: null,
    defaultPermissionMode: null,
    ...overrides,
  };
}

const created = { id: "task-1" } as TaskInfo;

beforeEach(() => {
  stubs.projects = [project("general"), project("web")];
  stubs.createTask.mockReset();
  stubs.createTask.mockResolvedValue({ ok: true, value: created });
  stubs.openTask.mockReset();
});

function type(text: string) {
  const box = screen.getByLabelText("Prompt");
  fireEvent.change(box, { target: { value: text } });
  return box;
}

/** The value a field is showing. Read off the element rather than through
 * jest-dom's matchers, which this project extends `expect` with but has no
 * types for. */
function valueOf(name: string): string {
  return (screen.getByLabelText(name) as HTMLInputElement).value;
}

function startButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: /start task/i }) as HTMLButtonElement;
}

/** ⌘⏎ as the browser reports it. Ctrl is the other half of the same binding. */
function submitKey(target: Element, key: Record<string, boolean> = { metaKey: true }) {
  fireEvent.keyDown(target, { key: "Enter", ...key });
}

test("⌘⏎ starts the task and opens its agent tab", async () => {
  render(<Composer />);
  submitKey(type("ship it"));

  await waitFor(() => expect(stubs.createTask).toHaveBeenCalledTimes(1));
  expect(stubs.createTask.mock.calls[0]![0]).toEqual({
    prompt: "ship it",
    projectId: "general",
    // Neither select was touched, and neither project column is set — so
    // nothing about the model or the mode goes on the wire, and the server
    // resolves both from the project.
    model: undefined,
    permissionMode: undefined,
  });
  await waitFor(() => expect(stubs.openTask).toHaveBeenCalledWith("task-1", { tab: "agent" }));
});

test("Ctrl+⏎ is the same binding", async () => {
  render(<Composer />);
  submitKey(type("ship it"), { ctrlKey: true });
  await waitFor(() => expect(stubs.createTask).toHaveBeenCalledTimes(1));
});

test("a whitespace-only prompt is not a task", async () => {
  render(<Composer />);
  const box = type("   \n  ");

  // Both halves: the button says so, and the keystroke that bypasses the button
  // has to agree with it.
  expect(startButton().disabled).toBe(true);
  submitKey(box);
  await Promise.resolve();
  expect(stubs.createTask).not.toHaveBeenCalled();
});

test("a failed create keeps the prompt and says why", async () => {
  stubs.createTask.mockResolvedValue({
    ok: false,
    error: { status: 500, message: "spawn ENOENT" },
  });
  render(<Composer />);
  submitKey(type("ship it"));

  expect((await screen.findByRole("alert")).textContent).toBe("spawn ENOENT");
  // The only copy of what the user wrote.
  expect(valueOf("Prompt")).toBe("ship it");
  expect(stubs.openTask).not.toHaveBeenCalled();
  // And it can be tried again.
  expect(startButton().disabled).toBe(false);
});

test("what the selects show is what gets sent", async () => {
  // The project's own column is seeded into the select rather than left as
  // "Project default", so the user can see what they are about to run.
  stubs.projects = [project("general", { defaultModel: "opus" })];
  render(<Composer />);

  expect(valueOf("model")).toBe("opus");
  fireEvent.change(screen.getByLabelText("mode"), { target: { value: "plan" } });
  submitKey(type("ship it"));

  await waitFor(() => expect(stubs.createTask).toHaveBeenCalledTimes(1));
  expect(stubs.createTask.mock.calls[0]![0]).toMatchObject({
    model: "opus",
    permissionMode: "plan",
  });
});

test("changing project re-seeds the model from the project it moved to", () => {
  stubs.projects = [project("general", { defaultModel: "opus" }), project("web")];
  render(<Composer />);
  expect(valueOf("model")).toBe("opus");

  fireEvent.change(screen.getByLabelText("project"), { target: { value: "web" } });
  // Not carried across: the choice belonged to the project it was read from.
  expect(valueOf("model")).toBe("");
});
