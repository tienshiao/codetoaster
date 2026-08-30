import { test, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppShell } from "./v2/AppShell";
import { NewProjectButton, TaskRowActions } from "./TaskSidebar";

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

function mountActions(busy: boolean) {
  const onClose = vi.fn();
  const onRename = vi.fn();
  render(
    <TaskRowActions
      taskId="t1"
      label="Fix the parser"
      busy={busy}
      onRename={onRename}
      onClose={onClose}
    />,
  );
  return { onClose, onRename };
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
