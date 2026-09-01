import { test, expect, describe, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { chooseOption, selectValue } from "../../../test/v2-select";
import type { CreateTaskOptions, TaskResult } from "../TaskContext";
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
  createTask: vi.fn<(options?: unknown, reporting?: unknown) => Promise<TaskResult<TaskInfo>>>(),
  openTask: vi.fn(),
  projects: [] as ProjectInfo[],
}));

vi.mock("@/frontend/TaskContext", () => ({
  useTasks: () => ({ projects: stubs.projects, createTask: stubs.createTask }),
}));
vi.mock("@/frontend/hooks/use-task-nav", async (importOriginal) => ({
  // The real module, with only the navigation replaced. `COMPOSER_PROMPT_ID`
  // in particular has to be the real one: the composer puts it on the textarea
  // and `useOpenComposer` focuses by it, so a copy of the literal here would
  // keep passing after the constant moved — which is the drift worth catching.
  ...(await importOriginal<typeof import("@/frontend/hooks/use-task-nav")>()),
  useOpenTask: () => stubs.openTask,
}));

const { Composer } = await import("./Composer");

function project(id: string, overrides: Partial<ProjectInfo> = {}): ProjectInfo {
  return {
    id,
    name: id,
    initialPath: "",
    taskIds: [],
    defaultModel: null,
    defaultPermissionMode: null,
    defaultBaseRef: null,
    setupCommand: null,
    worktreeCopy: null,
    worktreeDefault: false,
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

/** The value a text field is showing. Read off the element rather than through
 * jest-dom's matchers, which this project extends `expect` with but has no
 * types for. The two `Select`s are read with `selectValue`, which returns the
 * label Radix shows rather than a value the DOM no longer carries. */
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
    // The model select was not touched and the project's column is unset, so
    // nothing about the model goes on the wire and the server resolves it from
    // the project.
    model: undefined,
    // The grid the agent is spawned at, so its first paint is not laid out for
    // the 80×24 fallback and reflowed on the first attach.
    cols: 120,
    rows: 30,
  });
  // The composer renders its own failures under the textarea, so it asks
  // `request` not to toast them a second time (TASK-57).
  expect(stubs.createTask.mock.calls[0]![1]).toEqual({ inline: true });
  await waitFor(() => expect(stubs.openTask).toHaveBeenCalledWith("task-1", { tab: "agent" }));
});

describe("the worktree options", () => {
  /** A project with somewhere to branch from. The two default fixtures have no
   * `initialPath`, which is the General case: nowhere to add a worktree to. */
  function withRepo(overrides: Partial<ProjectInfo> = {}) {
    stubs.projects = [project("web", { initialPath: "~/projects/web", ...overrides })];
  }

  function worktreeBox(): HTMLInputElement {
    return screen.getByLabelText("worktree") as HTMLInputElement;
  }

  /** The options the composer actually built, typed — the mock records them as
   * `unknown`, and every assertion below is about one field of them. */
  function sent(): CreateTaskOptions {
    return stubs.createTask.mock.calls[0]![0] as CreateTaskOptions;
  }

  test("is off, and unusable, for a project with no directory", () => {
    render(<Composer />);

    // Disabled rather than absent, so the options row does not reflow as the
    // project selection moves between one kind of project and the other.
    expect(worktreeBox().disabled).toBe(true);
    expect(worktreeBox().checked).toBe(false);
    expect(screen.queryByLabelText("Base ref")).toBeNull();
    // And the reason is on the *label*, not the input. `Checkbox` renders its
    // input `sr-only`, and a 1px clipped element that is also disabled takes no
    // pointer events at all — so a tooltip left to land there is one nobody can
    // ever hover, which is worst for the message that most needs reading.
    expect(screen.getByTitle(/no directory to branch from/).tagName).toBe("LABEL");
  });

  test("starts where the project's default puts it", () => {
    withRepo({ worktreeDefault: true, defaultBaseRef: "release" });
    render(<Composer />);

    expect(worktreeBox().checked).toBe(true);
    // Seeded during the render that moves the selection, not in an effect —
    // otherwise ⌘⏎ in the first frame would send the previous project's answer.
    expect(valueOf("Base ref")).toBe("release");
  });

  test("sends nothing when it agrees with the project", async () => {
    withRepo({ worktreeDefault: true, defaultBaseRef: "release" });
    render(<Composer />);
    submitKey(type("inherit it"));

    await waitFor(() => expect(stubs.createTask).toHaveBeenCalledTimes(1));
    // "I did not touch this" and "I chose the same thing" are the same
    // request, so a project whose default later changes moves the tasks that
    // never overrode it.
    expect(sent().worktree).toBeUndefined();
    expect(sent().baseRef).toBe("release");
  });

  test("sends the override when it disagrees", async () => {
    withRepo({ worktreeDefault: false });
    render(<Composer />);
    fireEvent.click(worktreeBox());
    submitKey(type("branch it"));

    await waitFor(() => expect(stubs.createTask).toHaveBeenCalledTimes(1));
    expect(sent().worktree).toBe(true);
  });

  test("the base ref appears with the worktree and not without it", async () => {
    withRepo({ worktreeDefault: false });
    render(<Composer />);

    // It decides nothing on its own: a task in the project's own checkout is
    // on whatever branch the user left it on.
    expect(screen.queryByLabelText("Base ref")).toBeNull();
    fireEvent.click(worktreeBox());
    fireEvent.change(screen.getByLabelText("Base ref"), { target: { value: " main " } });
    submitKey(type("from main"));

    await waitFor(() => expect(stubs.createTask).toHaveBeenCalledTimes(1));
    expect(sent().baseRef).toBe("main");
  });

  test("a blank base ref is no override, not a ref called nothing", async () => {
    withRepo({ worktreeDefault: true });
    render(<Composer />);
    fireEvent.change(screen.getByLabelText("Base ref"), { target: { value: "   " } });
    submitKey(type("default base"));

    await waitFor(() => expect(stubs.createTask).toHaveBeenCalledTimes(1));
    // The server refuses a blank ref outright, so sending one would turn
    // "leave it to the project" into a 400.
    expect(sent().baseRef).toBeUndefined();
  });
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

test("what the select shows is what gets sent", async () => {
  // The project's own column is seeded into the select rather than left as
  // "Project default", so the user can see what they are about to run.
  stubs.projects = [project("general", { defaultModel: "opus" })];
  render(<Composer />);

  expect(selectValue("model")).toBe("Opus");
  chooseOption("model", "Fable");
  submitKey(type("ship it"));

  await waitFor(() => expect(stubs.createTask).toHaveBeenCalledTimes(1));
  // The label is capitalised; what goes on `claude --model` is not.
  expect(stubs.createTask.mock.calls[0]![0]).toMatchObject({ model: "fable" });
});

test("the composer never sends a permission mode", async () => {
  // TASK-80: the mode chip is gone, and with it any `--permission-mode` this
  // surface could put on the agent's argv. The field, the column and the
  // server's resolution of them all stay — the API and the CLI still set one.
  stubs.projects = [project("general", { defaultPermissionMode: "plan" })];
  render(<Composer />);

  expect(screen.queryByRole("combobox", { name: "mode" })).toBeNull();
  submitKey(type("ship it"));

  await waitFor(() => expect(stubs.createTask).toHaveBeenCalledTimes(1));
  expect(stubs.createTask.mock.calls[0]![0]).not.toHaveProperty("permissionMode");
});

test("changing project re-seeds the model from the project it moved to", () => {
  stubs.projects = [project("general", { defaultModel: "opus" }), project("web")];
  render(<Composer />);
  expect(selectValue("model")).toBe("Opus");

  chooseOption("project", "web");
  // Not carried across: the choice belonged to the project it was read from.
  expect(selectValue("model")).toBe("Project default");
});

describe("the project a group's + asked for", () => {
  test("opens on that project, seeded from its columns", () => {
    // TASK-77: `/?project=web`. Not just the select — the project's own
    // defaults come with it, since the seeding is keyed off the selection and
    // this moved the selection.
    stubs.projects = [project("general"), project("web", { defaultModel: "sonnet" })];
    render(<Composer projectId="web" />);

    expect(selectValue("project")).toBe("web");
    expect(selectValue("model")).toBe("Sonnet");
  });

  test("arriving while the user is typing moves the selection and nothing else", () => {
    // The real shape of it: `/` is already showing, so pressing a group's `+`
    // changes a prop on a live composer rather than mounting a new one. The
    // prompt is the user's and the only copy of it.
    const view = render(<Composer />);
    type("ship it");
    expect(selectValue("project")).toBe("general");

    view.rerender(<Composer projectId="web" />);

    expect(selectValue("project")).toBe("web");
    expect((screen.getByLabelText("Prompt") as HTMLTextAreaElement).value).toBe("ship it");
  });

  test("an id that names no project is not honoured", () => {
    // A preference, not an address: a stale link or a project deleted on
    // another client leaves the composer on the first project rather than on
    // nothing at all.
    render(<Composer projectId="nope" />);

    expect(selectValue("project")).toBe("general");
  });
});
