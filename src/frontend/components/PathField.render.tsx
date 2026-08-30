import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { NewProjectButton } from "./TaskSidebar";

/**
 * The path field's lifecycle behaviours: what a debounced request does when it
 * lands, which key Escape belongs to while a suggestion list is open, and
 * whether browsing and typing share one dialog. All of it needs a mounted tree,
 * so this is Vitest's, not `bun test`'s — see CLAUDE.md, "Testing".
 *
 * The path arithmetic underneath is not here: `path-suggest.test.ts` tests it
 * against inputs.
 */

const HOME = "/Users/tma";
const TREE: Record<string, string[]> = {
  "/": ["Users", "etc"],
  "/Users": ["tma"],
  "/Users/tma": ["Documents", "Projects"],
  "/Users/tma/Documents": [],
  "/Users/tma/Projects": ["codetoaster", "cookbook"],
  "/etc": [],
};

/** Mirrors `/api/directories`: tilde in, prefix filter, `~`-relative parent. */
function answer(raw: string) {
  let path = raw.startsWith("~") ? HOME + raw.slice(1) : raw;
  if (!path) path = HOME;

  let dir: string;
  let prefix = "";
  if (path.endsWith("/")) {
    dir = path.length > 1 ? path.slice(0, -1) : "/";
  } else {
    const cut = path.lastIndexOf("/");
    dir = cut === 0 ? "/" : path.slice(0, cut);
    prefix = path.slice(cut + 1).toLowerCase();
  }

  const directories = (TREE[dir] ?? []).filter((n) => n.toLowerCase().startsWith(prefix));
  const parent = dir === HOME ? "~" : dir.startsWith(HOME + "/") ? "~" + dir.slice(HOME.length) : dir === "/" ? "" : dir;
  return { parent, directories, home: HOME };
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const path = new URL(input, "http://localhost").searchParams.get("path") ?? "";
      return new Response(JSON.stringify(answer(path)), {
        headers: { "content-type": "application/json" },
      });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

function mount(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

function openDialog(onCreate = vi.fn()) {
  mount(<NewProjectButton onCreate={onCreate} />);
  fireEvent.click(screen.getByRole("button", { name: "New project" }));
  return { onCreate, field: screen.getByLabelText("Repository path") as HTMLInputElement };
}

test("typing suggests directories and Enter takes the highlighted one", async () => {
  const { field } = openDialog();
  fireEvent.change(field, { target: { value: "~/Pro" } });

  await screen.findByRole("option", { name: "Projects/" });
  fireEvent.keyDown(field, { key: "Enter" });
  expect(field.value).toBe("~/Projects/");
});

test("the arrows move the highlight before Enter commits it", async () => {
  const { field } = openDialog();
  fireEvent.change(field, { target: { value: "~/" } });

  await screen.findByRole("option", { name: "Documents/" });
  fireEvent.keyDown(field, { key: "ArrowDown" });
  fireEvent.keyDown(field, { key: "Enter" });
  expect(field.value).toBe("~/Projects/");
});

test("Enter with suggestions open does not submit the dialog", async () => {
  const onCreate = vi.fn();
  const { field } = openDialog(onCreate);
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Website" } });
  fireEvent.change(field, { target: { value: "~/Pro" } });

  await screen.findByRole("option", { name: "Projects/" });
  fireEvent.keyDown(field, { key: "Enter" });
  expect(onCreate).not.toHaveBeenCalled();
  screen.getByRole("dialog", { name: "New project" });
});

test("Escape closes the suggestions, and only then the dialog", async () => {
  const { field } = openDialog();
  fireEvent.change(field, { target: { value: "~/Pro" } });
  await screen.findByRole("option", { name: "Projects/" });

  // The dialog's own Escape handler is on `document`, so this is the assertion
  // that the field's capture-phase listener gets there first.
  fireEvent.keyDown(field, { key: "Escape" });
  expect(screen.queryByRole("option")).toBeNull();
  screen.getByRole("dialog", { name: "New project" });

  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("clicking a suggestion fills the field", async () => {
  const { field } = openDialog();
  fireEvent.change(field, { target: { value: "~/Pro" } });

  const option = await screen.findByRole("option", { name: "Projects/" });
  // `mousedown`, because that is what beats the blur that would otherwise close
  // the list before the click landed.
  fireEvent.mouseDown(option);
  expect(field.value).toBe("~/Projects/");
});

test("browsing swaps the dialog body and hands the choice back to the field", async () => {
  const { onCreate } = openDialog();
  fireEvent.click(screen.getByRole("button", { name: "Browse" }));

  // One dialog, two views: the form's fields are gone, not covered over.
  expect(screen.queryByLabelText("Repository path")).toBeNull();
  expect(screen.getAllByRole("dialog")).toHaveLength(1);

  const projects = await screen.findByRole("button", { name: "Projects" });
  fireEvent.click(projects);
  fireEvent.click(screen.getByRole("button", { name: "Use this folder" }));

  const field = screen.getByLabelText("Repository path") as HTMLInputElement;
  expect(field.value).toBe("~/Projects");
  // ...and confirming did not also submit the project.
  expect(onCreate).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Website" } });
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  expect(onCreate).toHaveBeenCalledWith("Website", "~/Projects");
});

test("browsing opens on what the field holds, and picks the deepest real folder", async () => {
  const { field } = openDialog();

  // A half-typed segment is a filter the autocomplete was still narrowing, not
  // a directory — the tree should land on its parent rather than pre-select a
  // path that does not exist.
  fireEvent.change(field, { target: { value: "~/Projects/co" } });
  fireEvent.click(screen.getByRole("button", { name: "Browse" }));
  await screen.findByText("~/Projects");
  fireEvent.click(screen.getByRole("button", { name: "Use this folder" }));
  expect((screen.getByLabelText("Repository path") as HTMLInputElement).value).toBe("~/Projects");
});

test("browsing keeps a path that really is a directory", async () => {
  const { field } = openDialog();
  fireEvent.change(field, { target: { value: "~/Projects/codetoaster" } });
  fireEvent.click(screen.getByRole("button", { name: "Browse" }));

  await screen.findByText("~/Projects/codetoaster");
  fireEvent.click(screen.getByRole("button", { name: "Use this folder" }));
  expect((screen.getByLabelText("Repository path") as HTMLInputElement).value).toBe(
    "~/Projects/codetoaster",
  );
});

test("Escape while browsing returns to the form rather than closing the dialog", async () => {
  openDialog();
  fireEvent.click(screen.getByRole("button", { name: "Browse" }));
  await screen.findByRole("button", { name: "Projects" });

  fireEvent.keyDown(document, { key: "Escape" });
  screen.getByLabelText("Repository path");
  screen.getByRole("dialog", { name: "New project" });
});

test("double-clicking a folder uses it without a trip through the footer", async () => {
  openDialog();
  fireEvent.click(screen.getByRole("button", { name: "Browse" }));

  fireEvent.doubleClick(await screen.findByRole("button", { name: "Projects" }));
  expect((screen.getByLabelText("Repository path") as HTMLInputElement).value).toBe("~/Projects");
});

test("only the chevron collapses, so a row cannot move out from under a double-click", async () => {
  openDialog();
  fireEvent.click(screen.getByRole("button", { name: "Browse" }));
  const projects = await screen.findByRole("button", { name: "Projects" });

  fireEvent.click(projects);
  await screen.findByRole("button", { name: "codetoaster" });
  // A second click on the row opens what is already open — it must not close it,
  // or the list would reflow between the halves of a double-click.
  fireEvent.click(projects);
  screen.getByRole("button", { name: "codetoaster" });

  fireEvent.click(screen.getByRole("button", { name: "Collapse Projects" }));
  expect(screen.queryByRole("button", { name: "codetoaster" })).toBeNull();
});

test("the browser cannot confirm until a folder is picked", async () => {
  openDialog();
  fireEvent.click(screen.getByRole("button", { name: "Browse" }));
  await screen.findByRole("button", { name: "Projects" });
  const confirm = screen.getByRole("button", { name: "Use this folder" }) as HTMLButtonElement;
  expect(confirm.disabled).toBe(true);
});

test("typing in the second field keeps the caret there", async () => {
  const { field } = openDialog();
  field.focus();
  fireEvent.change(field, { target: { value: "~/P" } });
  // The dialog focuses its first field when it opens. Re-running that on every
  // render — which it did while `onClose` was a dependency — dragged the caret
  // back to Name after a single keystroke.
  await waitFor(() => expect(document.activeElement).toBe(field));
});

test("Browse is reachable without a pointer", () => {
  openDialog();
  const browse = screen.getByRole("button", { name: "Browse" });
  browse.focus();
  expect(document.activeElement).toBe(browse);
});
