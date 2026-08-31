import { test, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppShell } from "./v2/AppShell";
import {
  ArchivedRowActions,
  NewProjectButton,
  TaskRowActions,
  UnclaimedActions,
} from "./TaskSidebar";
import type { ArchivePreview } from "@/lib/xtmux/types";

/** The project dialog's path field asks the server for directories, so it needs
 * a client even here, where nothing types enough to make it fetch. What the
 * field then *does* is tested in `PathField.render.tsx`. */
function renderNewProject(onCreate: (name: string, path: string) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <NewProjectButton onCreate={onCreate} />
    </QueryClientProvider>,
  );
}

/**
 * The sidebar's behaviours that only exist once something is mounted: whether
 * closing asks first, whether a row's controls can be reached without a
 * pointer, and whether the dialogs actually commit. A rendering test, so
 * Vitest's, not `bun test`'s — see CLAUDE.md, "Testing".
 *
 * The arrangement itself is not here. Recency, the filter, the archived
 * predicate and the grouping are pure functions in `task-list.ts`, tested
 * there against inputs rather than against the DOM.
 */

/** A preview with nothing interesting in it. The counts are what individual
 * tests vary; everything else is scaffolding. */
function previewOf(over: Partial<ArchivePreview> = {}): ArchivePreview {
  return {
    status: { exists: true, dirty: 0, unpushed: 0, merged: false, pushed: false, atBase: false },
    branch: "task/fix-the-parser",
    branchWouldBeDeleted: false,
    wipRetentionDays: 30,
    ...over,
  };
}

function mountActions(
  busy: boolean,
  preview: () => Promise<ArchivePreview | null> = async () => previewOf(),
) {
  const onClose = vi.fn();
  const onRename = vi.fn();
  const onArchive = vi.fn();
  const onArchivePreview = vi.fn(preview);
  render(
    <TaskRowActions
      taskId="t1"
      label="Fix the parser"
      busy={busy}
      onRename={onRename}
      onClose={onClose}
      onArchivePreview={onArchivePreview}
      onArchive={onArchive}
    />,
  );
  return { onClose, onRename, onArchive, onArchivePreview };
}

test("closing an idle task does not ask", () => {
  const { onClose } = mountActions(false);
  fireEvent.click(screen.getByRole("button", { name: "Close Fix the parser" }));
  expect(onClose).toHaveBeenCalledWith("t1");
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("closing a busy task confirms first, and cancelling leaves it alone", () => {
  const { onClose } = mountActions(true);
  fireEvent.click(screen.getByRole("button", { name: "Close Fix the parser" }));
  expect(onClose).not.toHaveBeenCalled();

  screen.getByRole("dialog", { name: "Close this task?" });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("confirming the close of a busy task closes it", () => {
  const { onClose } = mountActions(true);
  fireEvent.click(screen.getByRole("button", { name: "Close Fix the parser" }));
  fireEvent.click(screen.getByRole("button", { name: "Close task" }));
  expect(onClose).toHaveBeenCalledWith("t1");
});

test("rename is seeded with the label on screen and trims what it sends", () => {
  const { onRename } = mountActions(false);
  fireEvent.click(screen.getByRole("button", { name: "Rename Fix the parser" }));

  const field = screen.getByLabelText("Title") as HTMLInputElement;
  expect(field.value).toBe("Fix the parser");

  fireEvent.change(field, { target: { value: "  Fix the lexer  " } });
  fireEvent.click(screen.getByRole("button", { name: "Rename" }));
  expect(onRename).toHaveBeenCalledWith("t1", "Fix the lexer");
});

test("a rename to nothing is refused", () => {
  const { onRename } = mountActions(false);
  fireEvent.click(screen.getByRole("button", { name: "Rename Fix the parser" }));
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "   " } });
  fireEvent.click(screen.getByRole("button", { name: "Rename" }));
  expect(onRename).not.toHaveBeenCalled();
});

test("Escape dismisses a dialog without doing what it asked", () => {
  const { onRename } = mountActions(false);
  fireEvent.click(screen.getByRole("button", { name: "Rename Fix the parser" }));
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(onRename).not.toHaveBeenCalled();
});

/**
 * Archive (§5.6). The confirmation is the feature — the button is the easy part
 * — so what is asserted is that the dialog cannot be confirmed before it has
 * said what confirming costs, and that what it says comes from the preview.
 */
test("archive waits for the preview before it will let anything be confirmed", async () => {
  let answer: (preview: ArchivePreview) => void = () => {};
  const { onArchive } = mountActions(
    false,
    () => new Promise<ArchivePreview | null>((resolve) => (answer = resolve)),
  );
  fireEvent.click(screen.getByRole("button", { name: "Archive Fix the parser" }));

  screen.getByText("Checking what this would remove…");
  const confirm = screen.getByRole("button", { name: "Archive" }) as HTMLButtonElement;
  expect(confirm.disabled).toBe(true);
  fireEvent.click(confirm);
  expect(onArchive).not.toHaveBeenCalled();

  answer(previewOf({ status: { exists: true, dirty: 3, unpushed: 2, merged: false, pushed: false, atBase: false } }));
  await screen.findByText("3 uncommitted files will be saved to a snapshot, kept for 30 days.");
  screen.getByText("The branch has 2 unpushed commits.");
  screen.getByText(
    "The branch task/fix-the-parser will be kept, since deleting it would take that work with it.",
  );

  fireEvent.click(screen.getByRole("button", { name: "Archive" }));
  expect(onArchive).toHaveBeenCalledWith("t1");
});

test("a preview that fails says so and still lets the archive through", async () => {
  const { onArchive } = mountActions(false, async () => null);
  fireEvent.click(screen.getByRole("button", { name: "Archive Fix the parser" }));

  // Fail closed on the *claim*, not on the action: refusing to archive because
  // git was slow is the worse failure.
  await screen.findByText(/could not be established/);
  fireEvent.click(screen.getByRole("button", { name: "Archive" }));
  expect(onArchive).toHaveBeenCalledWith("t1");
});

test("cancelling the archive leaves the task alone", async () => {
  const { onArchive } = mountActions(false);
  fireEvent.click(screen.getByRole("button", { name: "Archive Fix the parser" }));
  await screen.findByRole("dialog", { name: "Archive this task?" });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onArchive).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("an archived row offers only delete, and it confirms first", () => {
  const onDelete = vi.fn();
  render(<ArchivedRowActions taskId="t1" label="Fix the parser" onDelete={onDelete} />);

  // No rename, no close, and above all no unarchive: nothing on the server can
  // reopen one, so a control that could only fail must not be offered.
  expect(screen.getAllByRole("button")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Delete Fix the parser" }));
  expect(onDelete).not.toHaveBeenCalled();

  screen.getByRole("dialog", { name: "Delete this task for good?" });
  fireEvent.click(screen.getByRole("button", { name: "Delete for good" }));
  expect(onDelete).toHaveBeenCalledWith("t1");
});

test("a row's actions are focusable, so they are not hover-only", () => {
  render(
    <AppShell
      tasks={[
        {
          id: "t1",
          title: "Fix the parser",
          actions: <button type="button">Close Fix the parser</button>,
        },
      ]}
    />,
  );
  // A `display: none` control cannot take focus, which is why the shell hides
  // the cluster with opacity: this is the assertion that would fail if it went
  // back to `hidden`.
  const action = screen.getByRole("button", { name: "Close Fix the parser" });
  action.focus();
  expect(document.activeElement).toBe(action);
});

/** Whether `el` sits under anything the shell fades out with the row. Walked
 * rather than asserted on one known parent, because the trap is any ancestor at
 * all: opacity applies to a whole subtree, `position: fixed` included. */
function fadesWithTheRow(el: HTMLElement): boolean {
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    if (node.classList.contains("opacity-0")) return true;
  }
  return false;
}

test("a row's dialog is not inside the cluster that fades with the hover", () => {
  render(
    <AppShell
      tasks={[
        {
          id: "t1",
          title: "Fix the parser",
          actions: (
            <TaskRowActions
              taskId="t1"
              label="Fix the parser"
              busy
              onRename={vi.fn()}
              onClose={vi.fn()}
              onArchivePreview={async () => previewOf()}
              onArchive={vi.fn()}
            />
          ),
        },
      ]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Close Fix the parser" }));

  // Left in the cluster, the dialog and its scrim drop to `opacity: 0` the
  // moment focus leaves the row — clicking the dialog's own title is enough —
  // and the invisible scrim then eats every click in the app.
  expect(fadesWithTheRow(screen.getByRole("dialog", { name: "Close this task?" }))).toBe(false);
});

test("a row's actions sit outside its button, not inside it", () => {
  render(
    <AppShell
      tasks={[{ id: "t1", title: "Fix the parser", actions: <button type="button">Close</button> }]}
    />,
  );
  const row = screen.getByRole("option", { name: /Fix the parser/ });
  expect(row.contains(screen.getByRole("button", { name: "Close" }))).toBe(false);
});

test("the shell draws the flat list by default and the groups when told to", () => {
  const tasks = [{ id: "t1", title: "Flat row" }];
  const groups = [{ id: "p1", name: "Website", tasks: [{ id: "t1", title: "Grouped row" }] }];

  const view = render(<AppShell tasks={tasks} groups={groups} />);
  expect(screen.queryByRole("option", { name: /Grouped row/ })).toBeNull();
  screen.getByRole("option", { name: /Flat row/ });

  view.rerender(<AppShell tasks={tasks} groups={groups} grouped />);
  expect(screen.queryByRole("option", { name: /Flat row/ })).toBeNull();
  screen.getByRole("option", { name: /Grouped row/ });
});

/**
 * The unclaimed band (§5.6, TASK-32 AC #2).
 *
 * Its whole reason for existing is that the boot sweep *would not* delete these
 * — a dirty orphan, or a directory git could not account for — so the only way
 * they go is by someone deciding. Two things follow, and both are tested here:
 * the band is not there at all when there is nothing to decide, and the delete
 * asks first.
 */
const worktreePath = "/Users/x/.codetoaster/worktrees/p1/t1";

test("the unclaimed band is absent when there is nothing unclaimed", () => {
  const view = render(<AppShell tasks={[{ id: "t1", title: "Fix the parser" }]} />);
  expect(screen.queryByText("Unclaimed worktrees")).toBeNull();

  // An empty list and no list are the same absence — the sweep having run and
  // found none looks exactly like it not having run, and neither is a section
  // header over nothing.
  view.rerender(<AppShell tasks={[{ id: "t1", title: "Fix the parser" }]} unclaimed={[]} />);
  expect(screen.queryByText("Unclaimed worktrees")).toBeNull();
});

test("an unclaimed checkout shows its branch, its path and its dirty count", () => {
  render(
    <AppShell
      unclaimed={[{ path: worktreePath, branch: "fix/parser", dirty: 3, actions: null }]}
    />,
  );

  screen.getByText("Unclaimed worktrees");
  screen.getByText("fix/parser");
  screen.getByText(worktreePath);
  screen.getByText("3 uncommitted");
});

test("a checkout git could not read says so rather than showing none", () => {
  render(<AppShell unclaimed={[{ path: worktreePath, branch: null, dirty: null }]} />);

  // Both nulls are real answers and neither is zero: a detached head is a state
  // a checkout can be in, and an unreadable one is *why* the sweep left this
  // directory standing.
  screen.getByText("detached");
  screen.getByText("changes unreadable");
  expect(screen.queryByText(/uncommitted/)).toBeNull();
});

test("deleting an unclaimed worktree confirms first, and cancelling leaves it", () => {
  const onDelete = vi.fn();
  render(<UnclaimedActions path={worktreePath} branch="fix/parser" onDelete={onDelete} />);

  fireEvent.click(screen.getByRole("button", { name: "Delete fix/parser" }));
  expect(onDelete).not.toHaveBeenCalled();

  screen.getByRole("dialog", { name: "Delete this worktree?" });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onDelete).not.toHaveBeenCalled();
});

test("confirming the delete reports the path, which is what identifies it", () => {
  const onDelete = vi.fn();
  render(<UnclaimedActions path={worktreePath} branch="fix/parser" onDelete={onDelete} />);

  fireEvent.click(screen.getByRole("button", { name: "Delete fix/parser" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete worktree" }));
  expect(onDelete).toHaveBeenCalledWith(worktreePath);
});

test("creating a project reports name and path, and only once submitted", () => {
  const onCreate = vi.fn();
  renderNewProject(onCreate);

  fireEvent.click(screen.getByRole("button", { name: "New project" }));
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Website" } });
  fireEvent.change(screen.getByLabelText("Repository path"), {
    target: { value: "~/projects/website" },
  });
  expect(onCreate).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  expect(onCreate).toHaveBeenCalledWith("Website", "~/projects/website");
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("a project with no name cannot be created", () => {
  const onCreate = vi.fn();
  renderNewProject(onCreate);

  fireEvent.click(screen.getByRole("button", { name: "New project" }));
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  expect(onCreate).not.toHaveBeenCalled();
});
