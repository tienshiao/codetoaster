import { test, expect, describe, vi, afterEach, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { chooseOption, selectValue } from "../../../test/v2-select";
import type { ProfileSummary } from "../hooks/use-profiles";
import {
  requestComposerProject,
  resetComposerRequest,
} from "../composer-request-store";
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
// The real constant, through the mock above, which spreads the real module.
const { COMPOSER_PROMPT_ID } = await import("@/frontend/hooks/use-task-nav");

function project(id: string, overrides: Partial<ProjectInfo> = {}): ProjectInfo {
  return {
    id,
    name: id,
    initialPath: "",
    taskIds: [],
    defaultModel: null,
    defaultProfile: null,
    defaultPermissionMode: null,
    defaultBaseRef: null,
    setupCommand: null,
    worktreeCopy: null,
    worktreeDefault: false,
    ...overrides,
  };
}

const created = { id: "task-1" } as TaskInfo;

/** A profile row as `GET /api/profiles` answers it. Only `model` varies here —
 * it is the one capability the composer renders anything from — so the rest is
 * spelled once rather than at three call sites. */
function profile(name: string, label: string, model: boolean): ProfileSummary {
  return {
    name,
    label,
    capabilities: {
      sessionId: model, resume: model, continue: model,
      hooks: false, model, permissionMode: false, prompt: model,
    },
  };
}

/** The daemon's real built-ins, which is what the composer offers. `shell` is
 * the one that takes no model — the profile that runs a plain shell and is
 * passed nothing at all — so it is what the disabled-control tests use. */
let profiles: ProfileSummary[];

beforeEach(() => {
  // Module state, so a request made by one test is one the next would open on.
  resetComposerRequest();
  stubs.projects = [project("general"), project("web")];
  stubs.createTask.mockReset();
  stubs.createTask.mockResolvedValue({ ok: true, value: created });
  stubs.openTask.mockReset();
  profiles = [
    profile("claude", "Claude Code", true),
    profile("shell", "Shell (no agent)", false),
    profile("pi", "pi", true),
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(profiles), {
          headers: { "content-type": "application/json" },
        }),
    ),
  );
});

afterEach(() => vi.unstubAllGlobals());

/** The composer under a query client, because the agent list is fetched.
 *
 * As a `wrapper` rather than a wrapping element, so `rerender` keeps the
 * provider — the `?project=` tests re-render the composer in place and would
 * otherwise remount it without one.
 */
function mount(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(node, { wrapper: Wrapper });
}

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
  mount(<Composer />);
  submitKey(type("ship it"));

  await waitFor(() => expect(stubs.createTask).toHaveBeenCalledTimes(1));
  expect(stubs.createTask.mock.calls[0]![0]).toEqual({
    prompt: "ship it",
    projectId: "general",
    // The model select was not touched and the project's column is unset, so
    // nothing about the model goes on the wire and the server resolves it from
    // the project. The agent select says the same thing the same way.
    model: undefined,
    profile: undefined,
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
    mount(<Composer />);

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
    mount(<Composer />);

    expect(worktreeBox().checked).toBe(true);
    // Seeded during the render that moves the selection, not in an effect —
    // otherwise ⌘⏎ in the first frame would send the previous project's answer.
    expect(valueOf("Base ref")).toBe("release");
  });

  test("sends nothing when it agrees with the project", async () => {
    withRepo({ worktreeDefault: true, defaultBaseRef: "release" });
    mount(<Composer />);
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
    mount(<Composer />);
    fireEvent.click(worktreeBox());
    submitKey(type("branch it"));

    await waitFor(() => expect(stubs.createTask).toHaveBeenCalledTimes(1));
    expect(sent().worktree).toBe(true);
  });

  test("the base ref appears with the worktree and not without it", async () => {
    withRepo({ worktreeDefault: false });
    mount(<Composer />);

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
    mount(<Composer />);
    fireEvent.change(screen.getByLabelText("Base ref"), { target: { value: "   " } });
    submitKey(type("default base"));

    await waitFor(() => expect(stubs.createTask).toHaveBeenCalledTimes(1));
    // The server refuses a blank ref outright, so sending one would turn
    // "leave it to the project" into a 400.
    expect(sent().baseRef).toBeUndefined();
  });
});

test("Ctrl+⏎ is the same binding", async () => {
  mount(<Composer />);
  submitKey(type("ship it"), { ctrlKey: true });
  await waitFor(() => expect(stubs.createTask).toHaveBeenCalledTimes(1));
});

test("a whitespace-only prompt is not a task", async () => {
  mount(<Composer />);
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
  mount(<Composer />);
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
  mount(<Composer />);

  expect(selectValue("model")).toBe("Opus");
  chooseOption("model", "Fable");
  submitKey(type("ship it"));

  await waitFor(() => expect(stubs.createTask).toHaveBeenCalledTimes(1));
  // The label is capitalised; what goes on `claude --model` is not.
  expect(stubs.createTask.mock.calls[0]![0]).toMatchObject({ model: "fable" });
});

/**
 * Choosing the agent (TASK-89.3).
 *
 * The list is fetched, so every assertion here is about a control that renders
 * once before the answer exists and again after — which is the whole reason
 * the agent has a seeding key of its own.
 */
describe("the agent select", () => {
  test("seeds from the project's default once the list arrives", async () => {
    stubs.projects = [project("general", { defaultProfile: "pi" })];
    mount(<Composer />);

    // The frame before the fetch lands: "pi" is not an option yet, so the
    // control shows the only thing it honestly can.
    expect(selectValue("agent")).toBe("Project default");
    // And it corrects itself rather than staying wrong, which a seed keyed
    // only on the project selection would not have done — nothing about the
    // selection changed when the answer came back.
    await waitFor(() => expect(selectValue("agent")).toBe("pi"));
  });

  test("changing project re-seeds it from the project it moved to", async () => {
    stubs.projects = [
      project("general", { defaultProfile: "pi" }),
      project("web", { defaultProfile: "shell" }),
    ];
    mount(<Composer />);
    await waitFor(() => expect(selectValue("agent")).toBe("pi"));

    chooseOption("project", "web");

    // Not carried across: the choice belonged to the project it was read from.
    expect(selectValue("agent")).toBe("Shell (no agent)");
  });

  test("an untouched select on a project that decided nothing sends nothing", async () => {
    // The default fixtures have no `default_profile`, so the control is on the
    // unset choice and stays there — and an absent field is what lets the
    // server resolve it, which is what gives the API and the CLI the same
    // answer for free.
    mount(<Composer />);
    submitKey(type("ship it"));

    await waitFor(() => expect(stubs.createTask).toHaveBeenCalledTimes(1));
    expect(stubs.createTask.mock.calls[0]![0]).toMatchObject({ profile: undefined });
  });

  test("a chosen agent is sent by name", async () => {
    // Seeded from a project that names one, which is also the only
    // deterministic signal that the fetched list has landed: the control
    // cannot show a label the list does not hold.
    stubs.projects = [project("general", { defaultProfile: "claude" })];
    mount(<Composer />);
    await waitFor(() => expect(selectValue("agent")).toBe("Claude Code"));

    chooseOption("agent", "pi");
    submitKey(type("ship it"));

    await waitFor(() => expect(stubs.createTask).toHaveBeenCalledTimes(1));
    // A name, never a command: the templates stay in the daemon's
    // configuration and only the name goes over the wire (TASK-42).
    expect(stubs.createTask.mock.calls[0]![0]).toMatchObject({ profile: "pi" });
  });

  test("an agent that takes no model disables the model select", async () => {
    stubs.projects = [project("general", { defaultProfile: "claude" })];
    mount(<Composer />);
    await waitFor(() => expect(selectValue("agent")).toBe("Claude Code"));

    // Nothing is disabled for claude, which takes one.
    const model = () => screen.getByRole("combobox", { name: "model" }) as HTMLButtonElement;
    expect(model().disabled).toBe(false);

    // The shell profile is passed nothing at all — no prompt, no model — so a
    // model chosen beside it would be silently dropped at the spawn. Disabled
    // rather than hidden, so the row does not reflow.
    chooseOption("agent", "Shell (no agent)");
    expect(model().disabled).toBe(true);
    expect(model().title).toBe("This agent takes no model");

    chooseOption("agent", "pi");
    expect(model().disabled).toBe(false);
  });

  test("the project's default decides it too, not just an explicit choice", async () => {
    // The effective profile is what the *server* will resolve to, so a project
    // defaulting to the shell disables the model with the select still on
    // "Project default".
    stubs.projects = [project("general", { defaultProfile: "shell" })];
    mount(<Composer />);

    await waitFor(() =>
      expect((screen.getByRole("combobox", { name: "model" }) as HTMLButtonElement).disabled)
        .toBe(true),
    );
  });

  test("nothing is disabled while the list has not arrived", () => {
    stubs.projects = [project("general", { defaultProfile: "shell" })];
    mount(<Composer />);

    // "We have not been told yet" is not "this agent takes no model": a
    // control greyed out on a guess is worse than one that lets the server
    // give the real answer.
    expect((screen.getByRole("combobox", { name: "model" }) as HTMLButtonElement).disabled)
      .toBe(false);
    expect(selectValue("agent")).toBe("Project default");
  });
});

test("the composer never sends a permission mode", async () => {
  // TASK-80: the mode chip is gone, and with it any `--permission-mode` this
  // surface could put on the agent's argv. The field, the column and the
  // server's resolution of them all stay — the API and the CLI still set one.
  stubs.projects = [project("general", { defaultPermissionMode: "plan" })];
  mount(<Composer />);

  expect(screen.queryByRole("combobox", { name: "mode" })).toBeNull();
  submitKey(type("ship it"));

  await waitFor(() => expect(stubs.createTask).toHaveBeenCalledTimes(1));
  expect(stubs.createTask.mock.calls[0]![0]).not.toHaveProperty("permissionMode");
});

test("changing project re-seeds the model from the project it moved to", () => {
  stubs.projects = [project("general", { defaultModel: "opus" }), project("web")];
  mount(<Composer />);
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
    mount(<Composer projectId="web" />);

    expect(selectValue("project")).toBe("web");
    expect(selectValue("model")).toBe("Sonnet");
  });

  test("a changed ?project= moves the selection and nothing else", () => {
    // Back and Forward. Every `+` pushes a history entry, so navigating across
    // them changes this prop on a composer that is already mounted — and that
    // is all that happens: no remount to re-read the seed, and no request in
    // the store either.
    const view = mount(<Composer />);
    type("ship it");
    expect(selectValue("project")).toBe("general");

    view.rerender(<Composer projectId="web" />);

    expect(selectValue("project")).toBe("web");
    expect((screen.getByLabelText("Prompt") as HTMLTextAreaElement).value).toBe("ship it");
  });

  test("arriving while the user is typing moves the selection and nothing else", () => {
    // The real shape of it: `/` is already showing, so pressing a group's `+`
    // is a request into a live composer rather than a new mount. The prompt is
    // the user's and the only copy of it.
    mount(<Composer />);
    type("ship it");
    expect(selectValue("project")).toBe("general");

    act(() => requestComposerProject("web"));

    expect(selectValue("project")).toBe("web");
    expect((screen.getByLabelText("Prompt") as HTMLTextAreaElement).value).toBe("ship it");
  });

  test("a press lands even when the URL already names that project", () => {
    // TASK-82, the whole of it: opened at `/?project=web`, chip moved to
    // general by hand, then web's `+` pressed again. The navigation behind that
    // press goes to the address already showing and so changes nothing, which
    // is why the request is counted rather than compared by id.
    mount(<Composer projectId="web" />);
    chooseOption("project", "general");
    type("ship it");
    expect(selectValue("project")).toBe("general");

    act(() => requestComposerProject("web"));

    expect(selectValue("project")).toBe("web");
    expect((screen.getByLabelText("Prompt") as HTMLTextAreaElement).value).toBe("ship it");
  });

  test("an id that names no project is not honoured", () => {
    // A preference, not an address: a stale link or a project deleted on
    // another client leaves the composer on the first project rather than on
    // nothing at all.
    mount(<Composer projectId="nope" />);

    expect(selectValue("project")).toBe("general");
  });
});

/**
 * Where the caret goes on mount (TASK-79).
 *
 * The viewport is stubbed per test rather than left to happy-dom's default,
 * because the whole question is what `useIsMobile` answers *on the first
 * render*: an `autoFocus` decided a frame late has already popped the phone's
 * soft keyboard.
 */
describe("the caret on a phone", () => {
  /** A `matchMedia` that answers one way for every query. Written out in full
   * because `useIsMobile` subscribes to the list it gets back, and a stub
   * missing `addEventListener` throws on mount rather than reporting a width. */
  function stubViewport(matches: boolean) {
    vi.stubGlobal("matchMedia", (media: string) => ({
      matches,
      media,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      onchange: null,
      dispatchEvent: () => false,
    }));
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function promptBox(): HTMLTextAreaElement {
    return screen.getByLabelText("Prompt") as HTMLTextAreaElement;
  }

  test("on a desktop the caret is in the prompt as soon as it mounts", () => {
    stubViewport(false);
    mount(<Composer />);

    // Arriving at `/` on a desktop means the user is about to type.
    expect(document.activeElement).toBe(promptBox());
  });

  test("on a phone nothing is focused, so the soft keyboard stays down", () => {
    stubViewport(true);
    mount(<Composer />);

    // `autoFocus` fires on every mount of `/` — the initial load, a redirect
    // from a dead task URL — and each one would cover a third of the viewport
    // with a keyboard the user never asked for.
    expect(document.activeElement).not.toBe(promptBox());
    expect(document.activeElement).toBe(document.body);
  });

  test("the deliberate press still lands on a phone", () => {
    stubViewport(true);
    mount(<Composer />);

    // Exactly what `useOpenComposer` does once its navigation settles: the box
    // is addressed by id precisely so the New task button can reach it whether
    // or not `/` remounted.
    document.getElementById(COMPOSER_PROMPT_ID)?.focus();

    expect(document.activeElement).toBe(promptBox());
  });
});

/**
 * Attachments (TASK-93).
 *
 * The upload is stubbed at `fetch`, not at a module boundary, because what is
 * under test is the *order*: the files go up first and the paths they came
 * back on are what the prompt is built from, so a create that ran before the
 * upload answered would still pass a mock of `uploadStaged`.
 */
describe("attachments", () => {
  /** Every path the stub has answered with, in order — the composer appends
   * these to the prompt, and the assertions below name them. */
  let uploaded: File[][];

  beforeEach(() => {
    uploaded = [];
    // Routed by URL: the outer `beforeEach` answers everything with the
    // profile list, and `uploadStaged` reading that would get `paths:
    // undefined` rather than a failure anyone could read.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/uploads") {
          const files = ((init?.body as FormData).getAll("files") as File[]);
          uploaded.push(files);
          return Response.json({
            paths: files.map((f) => `/home/me/.codetoaster/uploads/abc/${f.name}`),
          });
        }
        return Response.json(profiles);
      }),
    );
  });

  function png(name: string, bytes = 2048): File {
    return new File([new Uint8Array(bytes)], name, { type: "image/png" });
  }

  function attach(...files: File[]) {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files } });
  }

  function chips(): string[] {
    const list = screen.queryByRole("list", { name: "Attachments" });
    return list ? Array.from(list.children).map((li) => li.textContent ?? "") : [];
  }

  function attachButton(): HTMLButtonElement {
    return screen.getByRole("button", { name: "Attach files" }) as HTMLButtonElement;
  }

  test("a file attached by the button becomes a chip, and its path joins the prompt", async () => {
    mount(<Composer />);
    type("what is wrong here");
    attach(png("shot.png"));

    // Name and size, so a chip says which screenshot it is.
    expect(chips()).toEqual(["shot.png2.0 KB"]);
    // Nothing is written until submit: a composer the user walks away from
    // leaves no files behind.
    expect(uploaded).toEqual([]);

    submitKey(screen.getByLabelText("Prompt"));

    await waitFor(() => expect(stubs.createTask).toHaveBeenCalledTimes(1));
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]!.map((f) => f.name)).toEqual(["shot.png"]);
    // Under the ask, never over it: `titleFromPrompt` takes the first non-empty
    // line, and a prompt led by a path titles the task with one.
    expect((stubs.createTask.mock.calls[0]![0] as CreateTaskOptions).prompt).toBe(
      "what is wrong here\n\n/home/me/.codetoaster/uploads/abc/shot.png",
    );
  });

  test("a chip can be taken back off", () => {
    mount(<Composer />);
    attach(png("a.png"), png("b.png"));
    expect(chips()).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Remove a.png" }));

    expect(chips()).toEqual(["b.png2.0 KB"]);
  });

  test("a pasted screenshot attaches, and a pasted paragraph still types", () => {
    mount(<Composer />);
    const box = screen.getByLabelText("Prompt");

    fireEvent.paste(box, { clipboardData: { files: [png("Screenshot.png")] } });
    expect(chips()).toEqual(["Screenshot.png2.0 KB"]);

    // The other half of the same handler: a paste carrying no files is the
    // browser's to handle, so the default is left alone.
    const textPaste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(textPaste, "clipboardData", { value: { files: [] } });
    box.dispatchEvent(textPaste);
    expect(textPaste.defaultPrevented).toBe(false);
  });

  test("files dropped on the composer attach", () => {
    const { container } = mount(<Composer />);
    const zone = container.firstElementChild!;
    const dataTransfer = { types: ["Files"], files: [png("dropped.png")] };

    fireEvent.dragEnter(zone, { dataTransfer });
    expect(screen.getByText("Drop files to attach")).toBeTruthy();

    fireEvent.drop(zone, { dataTransfer });

    expect(chips()).toEqual(["dropped.png2.0 KB"]);
    // The overlay goes with the drag that raised it.
    expect(screen.queryByText("Drop files to attach")).toBeNull();
  });

  test("an attachment on its own is a task, with the path as the whole prompt", async () => {
    mount(<Composer />);
    expect(startButton().disabled).toBe(true);

    attach(png("shot.png"));

    // "Look at this" is a complete ask, and the path is what the agent needs.
    expect(startButton().disabled).toBe(false);
    fireEvent.click(startButton());

    await waitFor(() => expect(stubs.createTask).toHaveBeenCalledTimes(1));
    expect((stubs.createTask.mock.calls[0]![0] as CreateTaskOptions).prompt).toBe(
      "/home/me/.codetoaster/uploads/abc/shot.png",
    );
  });

  test("a failed upload starts nothing, and leaves the prompt and the chips alone", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === "/api/uploads"
          ? Response.json({ error: "Disk is full" }, { status: 500 })
          : Response.json(profiles),
      ),
    );
    mount(<Composer />);
    type("what is wrong here");
    attach(png("shot.png"));
    submitKey(screen.getByLabelText("Prompt"));

    // The server's own words, inline under the form — the same place a failed
    // create reports, and for the same reason.
    expect((await screen.findByRole("alert")).textContent).toBe("Disk is full");
    // A task whose prompt names files that were never written is worse than no
    // task at all, so the create never runs.
    expect(stubs.createTask).not.toHaveBeenCalled();
    // Everything the user assembled is still there, so the same ⌘⏎ retries it.
    expect((screen.getByLabelText("Prompt") as HTMLTextAreaElement).value).toBe(
      "what is wrong here",
    );
    expect(chips()).toEqual(["shot.png2.0 KB"]);
    expect(startButton().disabled).toBe(false);
  });

  test("a file offered while the upload is in flight is refused, not lost", async () => {
    // The submit snapshots the list before awaiting the upload, so anything
    // that joined it after would be uploaded by nobody and named in no prompt.
    // Held open by hand, because the whole question is what the composer does
    // in the window between the request going out and the answer coming back.
    let release!: () => void;
    const inFlight = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) !== "/api/uploads") return Response.json(profiles);
        const files = (init?.body as FormData).getAll("files") as File[];
        uploaded.push(files);
        await inFlight;
        return Response.json({
          paths: files.map((f) => `/home/me/.codetoaster/uploads/abc/${f.name}`),
        });
      }),
    );

    mount(<Composer />);
    type("what is wrong here");
    attach(png("a.png"));
    submitKey(screen.getByLabelText("Prompt"));
    await waitFor(() => expect(uploaded).toHaveLength(1));

    attach(png("b.png"));

    // Refused rather than added, and the button says so before anyone tries.
    expect(chips()).toEqual(["a.png2.0 KB"]);
    expect(attachButton().disabled).toBe(true);

    await act(async () => {
      release();
      await inFlight;
    });

    await waitFor(() => expect(stubs.createTask).toHaveBeenCalledTimes(1));
    expect(uploaded).toHaveLength(1);
    expect((stubs.createTask.mock.calls[0]![0] as CreateTaskOptions).prompt).toBe(
      "what is wrong here\n\n/home/me/.codetoaster/uploads/abc/a.png",
    );
  });
});
