import { test, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { Terminal } from "lucide-react";
import { CommandPalette, type PaletteGroup, type PaletteItem } from "./CommandPalette";

/**
 * The palette as it behaves on screen.
 *
 * A rendering test rather than a `.test.ts` because everything asked here is a
 * *lifecycle* question — what has focus on open, which row cmdk has selected,
 * which keystroke reaches which handler. The rows themselves are pure and are
 * asserted in `palette-items.test.ts`.
 *
 * Nothing here asserts on scrolling. cmdk keeps the selected row in view with
 * `scrollIntoView`, and happy-dom has no layout engine to make that mean
 * anything — a green test would say nothing about a browser.
 */

const GROUPS: PaletteGroup[] = [
  {
    id: "tasks",
    label: "Tasks",
    items: [
      { id: "task:a", label: "Fix the parser", state: "busy", detail: "codetoaster" },
      { id: "task:b", label: "Rewrite the sidebar", state: "idle", detail: "codetoaster" },
    ],
  },
  {
    id: "actions",
    label: "Actions",
    items: [{ id: "action:new-shell", label: "New shell", icon: Terminal, keys: ["⌘", "K", "`"] }],
  },
];

function open(props: Partial<Parameters<typeof CommandPalette>[0]> = {}) {
  const onSelect = vi.fn();
  const onDismiss = vi.fn();
  const view = render(
    <CommandPalette
      open
      query=""
      onQueryChange={() => {}}
      groups={GROUPS}
      onSelect={onSelect}
      onDismiss={onDismiss}
      {...props}
    />,
  );
  return { onSelect, onDismiss, ...view };
}

/** The query field. cmdk gives it `role="combobox"`. */
function input(): HTMLInputElement {
  return screen.getByRole("combobox") as HTMLInputElement;
}

test("a closed palette is not in the document at all", () => {
  render(
    <CommandPalette
      open={false}
      query=""
      onQueryChange={() => {}}
      groups={GROUPS}
      onSelect={() => {}}
      onDismiss={() => {}}
    />,
  );

  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("option")).toBeNull();
});

test("opening focuses the query and pre-selects the first row, so Enter is safe", () => {
  open();

  screen.getByRole("dialog", { name: "Command palette" });
  expect(document.activeElement).toBe(input());

  const rows = screen.getAllByRole("option");
  expect(rows[0]!.getAttribute("aria-selected")).toBe("true");
  expect(rows.slice(1).every((r) => r.getAttribute("aria-selected") === "false")).toBe(true);
});

test("typing narrows the rows", () => {
  // Controlled, like the host: the query lives above the palette because a
  // server-side file search is driven from it.
  function Host() {
    const [query, setQuery] = useState("");
    return (
      <CommandPalette
        open
        query={query}
        onQueryChange={setQuery}
        groups={GROUPS}
        onSelect={() => {}}
        onDismiss={() => {}}
      />
    );
  }
  render(<Host />);
  expect(screen.getAllByRole("option")).toHaveLength(3);

  fireEvent.change(input(), { target: { value: "sidebar" } });

  expect(screen.getAllByRole("option").map((r) => r.textContent)).toEqual([
    "Rewrite the sidebarcodetoaster",
  ]);
});

test("the filter matches the words on the row, not the id behind it", () => {
  // `value` is an id — `task:a` — and cmdk scores against `value` by default,
  // which would make "task" match every task row and "action" every command.
  render(
    <CommandPalette
      open
      query="task"
      onQueryChange={() => {}}
      groups={GROUPS}
      onSelect={() => {}}
      onDismiss={() => {}}
    />,
  );

  expect(screen.queryAllByRole("option")).toHaveLength(0);
  screen.getByText("No matches.");
});

test("ArrowDown then Enter selects the second row", () => {
  const { onSelect } = open();

  fireEvent.keyDown(input(), { key: "ArrowDown" });
  fireEvent.keyDown(input(), { key: "Enter" });

  expect(onSelect).toHaveBeenCalledTimes(1);
  expect((onSelect.mock.calls[0]![0] as PaletteItem).id).toBe("task:b");
});

test("Escape dismisses", () => {
  const { onDismiss } = open();

  fireEvent.keyDown(document, { key: "Escape" });

  expect(onDismiss).toHaveBeenCalledTimes(1);
});

test("a press on the scrim dismisses; a press inside the panel does not", () => {
  const { onDismiss } = open();

  fireEvent.mouseDown(screen.getByRole("dialog"));
  expect(onDismiss).not.toHaveBeenCalled();

  fireEvent.mouseDown(screen.getByRole("dialog").parentElement!);
  expect(onDismiss).toHaveBeenCalledTimes(1);
});

test("a task row draws its state dot and a command row draws its caps", () => {
  open();

  // `StatusDot` names itself with the state, which is the only handle on it —
  // it is a coloured span with nothing to read.
  expect(screen.getByTitle("busy")).toBeTruthy();
  expect(screen.getByTitle("idle")).toBeTruthy();

  const caps = screen.getByRole("option", { name: /New shell/ }).querySelectorAll("kbd");
  expect(Array.from(caps).map((k) => k.textContent)).toEqual(["⌘", "K", "`"]);
});

test("a force-mounted row survives a query it does not match", () => {
  // The server already narrowed these, so cmdk must not narrow them again —
  // and the empty state must not claim there were no matches over the top of
  // them, which it would, since a force-mounted row is never counted.
  const groups: PaletteGroup[] = [
    ...GROUPS,
    {
      id: "files",
      label: "Files",
      items: [{ id: "file:src/index.ts", label: "src/index.ts", forceMount: true }],
    },
  ];
  render(
    <CommandPalette
      open
      query="zzzz"
      onQueryChange={() => {}}
      groups={groups}
      onSelect={() => {}}
      onDismiss={() => {}}
    />,
  );

  expect(screen.getAllByRole("option").map((r) => r.textContent)).toEqual(["src/index.ts"]);
  expect(screen.queryByText("No matches.")).toBeNull();
});

test("a group with no rows is not drawn at all", () => {
  render(
    <CommandPalette
      open
      query=""
      onQueryChange={() => {}}
      groups={[...GROUPS, { id: "commits", label: "Commits", items: [] }]}
      onSelect={() => {}}
      onDismiss={() => {}}
    />,
  );

  screen.getByText("Tasks");
  expect(screen.queryByText("Commits")).toBeNull();
});
