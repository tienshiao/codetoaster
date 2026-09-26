import { test, expect, describe, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { Dialog } from "./Dialog";

/**
 * Where focus lands when a `Dialog` opens (TASK-115).
 *
 * The dialog must always take focus. Left behind on its opener — the row's
 * archive icon, inside the row's hover card trigger — focus kept the card from
 * getting the blur that closes it, and Escape and Tab acted on the row behind
 * the shade. The effect focuses synchronously on mount, so each assertion
 * follows the render directly.
 */

/** Focus an opener outside the dialog, then open the dialog beside it. */
function openFrom(dialog: ReactElement) {
  const { rerender } = render(<button type="button">Opener</button>);
  const opener = screen.getByRole("button", { name: "Opener" });
  opener.focus();
  expect(document.activeElement).toBe(opener);
  rerender(
    <>
      <button type="button">Opener</button>
      {dialog}
    </>,
  );
  return opener;
}

describe("focus on open", () => {
  test("a confirmation whose confirm is disabled still takes focus from its opener", () => {
    const opener = openFrom(
      <Dialog
        open
        title="Archive task"
        confirmLabel="Archive"
        confirmDisabled
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog");
    expect(document.activeElement).not.toBe(opener);
    // The panel itself, not Cancel: Enter on a default-focused Cancel would
    // undo what the dialog was opened to do.
    expect(document.activeElement).toBe(dialog);
  });

  test("the confirm takes focus when it enables, while nothing else has it", () => {
    const props = { title: "Archive task", confirmLabel: "Archive", onConfirm: vi.fn(), onClose: vi.fn() };
    const { rerender } = render(<Dialog open confirmDisabled {...props} />);
    expect(document.activeElement).toBe(screen.getByRole("dialog"));

    rerender(<Dialog open {...props} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Archive" }));
  });

  test("the confirm enabling does not steal focus from a button the user moved to", () => {
    const props = { title: "Archive task", confirmLabel: "Archive", onConfirm: vi.fn(), onClose: vi.fn() };
    const { rerender } = render(<Dialog open confirmDisabled {...props} />);
    const cancel = screen.getByRole("button", { name: "Cancel" });
    cancel.focus();

    rerender(<Dialog open {...props} />);
    expect(document.activeElement).toBe(cancel);
  });

  test("a disabled first field is skipped for the next thing that can take focus", () => {
    openFrom(
      <Dialog open title="Rename" onConfirm={vi.fn()} onClose={vi.fn()}>
        <input aria-label="Locked" disabled />
        <input aria-label="Name" />
      </Dialog>,
    );

    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Name" }));
  });

  test("a dialog with a field focuses the field", () => {
    openFrom(
      <Dialog open title="Rename" onConfirm={vi.fn()} onClose={vi.fn()}>
        <input aria-label="Name" />
      </Dialog>,
    );

    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Name" }));
  });

  test("a confirmation with an enabled confirm focuses the confirm button", () => {
    openFrom(
      <Dialog
        open
        title="Archive task"
        confirmLabel="Archive it"
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Archive it" }));
  });
});

describe("focus on close", () => {
  const props = { title: "Archive task", confirmLabel: "Archive", onConfirm: vi.fn(), onClose: vi.fn() };
  const tree = (open: boolean) => (
    <>
      <button type="button">Opener</button>
      <Dialog open={open} {...props} />
    </>
  );

  test("focus goes back to the opener", () => {
    const { rerender } = render(tree(false));
    const opener = screen.getByRole("button", { name: "Opener" });
    opener.focus();

    rerender(tree(true));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Archive" }));

    // Closed the way every dismissal closes it: the caller flips `open`.
    // Without the return, focus fell to `<body>` and the next Tab started
    // over from the top of the document.
    rerender(tree(false));
    expect(document.activeElement).toBe(opener);
  });

  test("an opener that has since unmounted is not focused", () => {
    const { rerender } = render(
      <>
        <button type="button">Gone</button>
        <Dialog open={false} {...props} />
      </>,
    );
    screen.getByRole("button", { name: "Gone" }).focus();
    rerender(
      <>
        <button type="button">Gone</button>
        <Dialog open {...props} />
      </>,
    );
    // The row's actions unmount with an archived row; the dialog closes after.
    rerender(<Dialog open={false} {...props} />);
    expect(document.activeElement).toBe(document.body);
  });
});

test("a closed dialog renders nothing", () => {
  render(<Dialog open={false} title="Archive task" onConfirm={vi.fn()} onClose={vi.fn()} />);

  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText("Archive task")).toBeNull();
});
