import { test, expect, describe, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { chooseOption, openSelect, selectValue, typeInSelect } from "../../../../test/v2-select";
import { Dialog } from "./Dialog";
import { Select, type SelectOption } from "./Select";

/**
 * The v2 `Select`, which is Radix and no longer a native `<select>` (TASK-75).
 *
 * What is worth a test here is what the swap put at risk, not what Radix
 * already tests: the empty string surviving a round trip through a library that
 * refuses it, the trigger keeping its label while the list under it is being
 * filtered, and Escape not taking the surrounding dialog with it.
 *
 * Arrow keys and typeahead are deliberately *not* asserted. Radix moves focus
 * through `setTimeout` and `scrollIntoView`, neither of which happy-dom has a
 * layout engine for, so a green test here would say nothing about a browser.
 * That half of the acceptance is verified in Chrome instead.
 */

const OPTIONS: SelectOption[] = [
  { value: "", label: "Project default" },
  { value: "fable", label: "Fable" },
  { value: "opus", label: "Opus" },
  { value: "sonnet", label: "Sonnet" },
];

const onValueChange = vi.fn();

beforeEach(() => onValueChange.mockReset());

function Controlled({ initial = "", ...rest }: { initial?: string } & Partial<{ filterPlaceholder: string }>) {
  const [value, setValue] = useState(initial);
  return (
    <Select
      label="model"
      options={OPTIONS}
      value={value}
      onValueChange={(next) => {
        setValue(next);
        onValueChange(next);
      }}
      {...rest}
    />
  );
}

describe("the empty choice", () => {
  // Radix throws on an item whose value is "" and reads a root value of "" as
  // "show the placeholder". "" is this system's way of saying "someone below
  // me decides", so it is swapped for a sentinel inside the component — and
  // the swap has to be invisible in both directions.
  test("displays like any other option", () => {
    render(<Controlled />);
    expect(selectValue("model")).toBe("Project default");
  });

  test("comes back out as the empty string, not the sentinel", () => {
    render(<Controlled initial="opus" />);
    chooseOption("model", "Project default");

    expect(onValueChange).toHaveBeenCalledWith("");
    expect(selectValue("model")).toBe("Project default");
  });

  test("a real value is unchanged by the swap", () => {
    render(<Controlled />);
    chooseOption("model", "Fable");

    expect(onValueChange).toHaveBeenCalledWith("fable");
    expect(selectValue("model")).toBe("Fable");
  });
});

describe("filtering", () => {
  test("typing narrows the list instead of jumping to a match", () => {
    render(<Controlled filterPlaceholder="Type to filter" />);
    openSelect("model");
    expect(screen.getAllByRole("option")).toHaveLength(4);

    typeInSelect("o", "p");

    // A substring match anywhere in the label, so "op" keeps Opus and drops
    // the three that merely contain an o.
    const shown = screen.getAllByRole("option").map((o) => o.textContent);
    expect(shown).toEqual(["Opus"]);
    // And what was typed is shown, since there is no caret to give it away.
    expect(screen.getByText("op")).toBeTruthy();
  });

  test("Backspace gives the list back", () => {
    render(<Controlled filterPlaceholder="Type to filter" />);
    openSelect("model");
    typeInSelect("z");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("No matches")).toBeTruthy();

    typeInSelect("Backspace");
    expect(screen.getAllByRole("option")).toHaveLength(4);
  });

  test("the trigger keeps its label while the selected row is filtered out", () => {
    // The reason the trigger reads its text from the options rather than from
    // the selected item portaling into it, which is Radix's default: a filter
    // unmounts rows, and an unmounted selected row would blank the chip.
    render(<Controlled initial="fable" filterPlaceholder="Type to filter" />);
    openSelect("model");
    typeInSelect("s");

    expect(screen.queryByRole("option", { name: "Fable" })).toBeNull();
    expect(selectValue("model")).toBe("Fable");
  });

  test("without the placeholder, typing is left to Radix's own typeahead", async () => {
    render(<Controlled />);
    openSelect("model");
    typeInSelect("o");

    expect(screen.getAllByRole("option")).toHaveLength(4);
    // Radix's typeahead defers its focus move into a `setTimeout`, and that
    // timer outlives the test: fired after the unmount between tests, it
    // reaches for a ref that is now null and takes the whole run down as an
    // unhandled rejection. Let it run while there is still a tree to focus.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

test("Escape closes the popup without closing the dialog holding it", () => {
  // `Dialog` binds Escape to the document and knows nothing about layers above
  // it. Radix dismisses on the capture phase, so stopping the event there is
  // what keeps one keystroke from doing two things.
  const onClose = vi.fn();
  render(
    <Dialog open title="Settings" onClose={onClose}>
      <Controlled />
    </Dialog>,
  );
  openSelect("model");
  expect(screen.getByRole("option", { name: "Fable" })).toBeTruthy();

  fireEvent.keyDown(document.activeElement ?? document, { key: "Escape" });

  expect(screen.queryByRole("option", { name: "Fable" })).toBeNull();
  expect(onClose).not.toHaveBeenCalled();

  // And a second Escape, with nothing left above it, does reach the dialog.
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("a disabled chip does not open", () => {
  render(
    <Select
      label="model"
      options={OPTIONS}
      value="opus"
      disabled
      onValueChange={onValueChange}
    />,
  );
  openSelect("model");

  expect(screen.queryByRole("option")).toBeNull();
  expect(selectValue("model")).toBe("Opus");
});
