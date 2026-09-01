import { test, expect, describe, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { chooseOption, selectValue } from "../../../test/v2-select";
import type { ProjectInfo, ProjectSettings } from "../../lib/xtmux/types";
import { ProjectSettingsDialog } from "./ProjectSettingsDialog";

/**
 * What the project settings form seeds from and what Save sends. The dialog
 * portals into `document.body` and holds its own state, so this needs a
 * mounted tree — Vitest's, not `bun test`'s (CLAUDE.md, "Testing").
 *
 * The tick's own appearance is not asserted here and cannot be: `Checkbox`
 * shows it through `peer-checked:`, and Happy DOM applies no stylesheet. The
 * input's `checked` is the state that matters to the payload; the paint is a
 * browser check (the `verify` skill).
 */

function project(overrides: Partial<ProjectInfo> = {}): ProjectInfo {
  return {
    id: "web",
    name: "Website",
    initialPath: "~/projects/web",
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

const onSave = vi.fn();
const onClose = vi.fn();

beforeEach(() => {
  onSave.mockReset();
  onClose.mockReset();
});

/** The path field's autocomplete is a react-query hook, so the dialog does not
 * mount without a client — even in the tests that never touch that field. */
function open(overrides: Partial<ProjectInfo> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ProjectSettingsDialog
        project={project(overrides)}
        open
        onSave={onSave}
        onClose={onClose}
      />
    </QueryClientProvider>,
  );
}

function save() {
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
}

function saved(): Partial<ProjectSettings> {
  return onSave.mock.calls[0]![2] as Partial<ProjectSettings>;
}

/** The identity half of the same call: `updateProject` takes the name, the
 * path and the defaults together, so this dialog saves all three at once. */
function savedIdentity(): { name: string; path: string } {
  return { name: onSave.mock.calls[0]![0] as string, path: onSave.mock.calls[0]![1] as string };
}

const worktreeBox = () =>
  screen.getByLabelText("Give new tasks a worktree of their own") as HTMLInputElement;

describe("project settings", () => {
  // TASK-61. `updateProject` has always taken the name and the path, and until
  // now nothing sent a changed one — so correcting a typo meant deleting the
  // project, which moves every task in it to General.
  test("renames and moves the project, in the same call as the defaults", () => {
    open({ name: "Website", initialPath: "~/projects/web" });

    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Website");
    expect((screen.getByLabelText("Repository path") as HTMLInputElement).value)
      .toBe("~/projects/web");

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  Marketing site  " } });
    fireEvent.change(screen.getByLabelText("Repository path"), {
      target: { value: "~/projects/marketing" },
    });
    chooseOption("Default model", "Opus");
    save();

    // One message, not three: a split write is a way for half an edit to land.
    expect(onSave).toHaveBeenCalledTimes(1);
    // Trimmed, because the surrounding space is nobody's choice and it reaches
    // the sidebar header and the composer's option list.
    expect(savedIdentity()).toEqual({ name: "Marketing site", path: "~/projects/marketing" });
    expect(saved().defaultModel).toBe("opus");
  });

  test("a project with no name cannot be saved", () => {
    open();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "   " } });

    // An empty name would leave the sidebar with a blank header and the
    // composer with a blank option.
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    save();
    expect(onSave).not.toHaveBeenCalled();
  });

  // Read off the field, not the project: pointing a project at a repository
  // should make the worktree settings usable in the same breath, without a
  // save and a reopen to make the form agree with itself.
  test("typing a path enables the worktree fields straight away", () => {
    open({ initialPath: "" });
    expect(worktreeBox().disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Repository path"), {
      target: { value: "~/projects/web" },
    });

    expect(worktreeBox().disabled).toBe(false);
    expect((screen.getByLabelText("Setup command") as HTMLTextAreaElement).disabled).toBe(false);
  });

  test("Browse swaps the body rather than stacking a second dialog", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /browse/i }));

    // One dialog at a time: `Dialog` binds Escape to the document and renders
    // fixed, so two would dismiss together and stack by declaration order.
    expect(screen.getByText("Choose a folder")).toBeTruthy();
    expect(screen.queryByLabelText("Name")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();

    // And Cancel means "back to the form", not "abandon the edit".
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.getByLabelText("Name")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  test("seeds every field from the project", () => {
    open({
      defaultModel: "opus",
      defaultBaseRef: "release",
      setupCommand: "bun install",
      worktreeCopy: ".env\n.config",
      worktreeDefault: true,
    });

    expect(selectValue("Default model")).toBe("Opus");
    expect((screen.getByLabelText("Base ref for new worktrees") as HTMLInputElement).value)
      .toBe("release");
    expect((screen.getByLabelText("Setup command") as HTMLTextAreaElement).value)
      .toBe("bun install");
    expect((screen.getByLabelText("Files to copy into a new worktree") as HTMLTextAreaElement).value)
      .toBe(".env\n.config");
    expect(worktreeBox().checked).toBe(true);
  });

  test("an unset column shows the fall-through choice, not a blank control", () => {
    open();

    // "" is the option meaning "Claude Code default" — the same empty value
    // that reaches the server as no column at all.
    expect(selectValue("Default model")).toBe("Claude Code default");
    expect((screen.getByLabelText("Base ref for new worktrees") as HTMLInputElement).value)
      .toBe("");
  });

  test("Save sends the whole form, so a cleared field is cleared", () => {
    open({ defaultModel: "opus", setupCommand: "bun install", worktreeDefault: true });
    chooseOption("Default model", "Claude Code default");
    fireEvent.change(screen.getByLabelText("Setup command"), { target: { value: "" } });
    fireEvent.click(worktreeBox());
    save();

    // Every key, every time: this is the whole form, so what the user emptied
    // is meant to be empty. The server turns blank into NULL.
    expect(saved()).toEqual({
      defaultModel: "",
      defaultBaseRef: "",
      worktreeDefault: false,
      setupCommand: "",
      worktreeCopy: "",
    });
  });

  test("edits reach Save", () => {
    open();
    fireEvent.change(screen.getByLabelText("Base ref for new worktrees"), {
      target: { value: "release" },
    });
    fireEvent.change(screen.getByLabelText("Files to copy into a new worktree"), {
      target: { value: ".env" },
    });
    fireEvent.click(worktreeBox());
    save();

    expect(saved().defaultBaseRef).toBe("release");
    expect(saved().worktreeCopy).toBe(".env");
    expect(saved().worktreeDefault).toBe(true);
  });

  // A project with no directory has no repository to branch from, so the three
  // worktree fields decide nothing. Disabled and explained, rather than hidden:
  // a form that changes shape between projects is harder to learn than one with
  // a reason showing.
  test("the worktree fields are unusable for a project with no directory", () => {
    open({ initialPath: "", worktreeDefault: true });

    expect(worktreeBox().disabled).toBe(true);
    expect((screen.getByLabelText("Base ref for new worktrees") as HTMLInputElement).disabled)
      .toBe(true);
    expect((screen.getByLabelText("Setup command") as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.getByText(/no directory/)).toBeTruthy();

    // And it cannot be saved as on, however the column got that way — a stored
    // `worktree_default` on a project that cannot honour it would make every
    // create fail rather than quietly skip the worktree.
    save();
    expect(saved().worktreeDefault).toBe(false);

    // The model and mode are still the project's to decide: they have nothing
    // to do with having a checkout.
    expect((screen.getByRole("combobox", { name: "Default model" }) as HTMLButtonElement).disabled)
      .toBe(false);
  });
});
