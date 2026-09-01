import { fireEvent, screen } from "@testing-library/react";

/**
 * Driving a v2 `Select` from a rendering test.
 *
 * The control used to be a native `<select>`, which a test could read with
 * `.value` and set with `fireEvent.change`. It is Radix now (TASK-75): a button
 * and a portalled listbox, so both of those are gone and every suite touching
 * one would otherwise grow its own copy of the same three lines.
 *
 * Two things worth knowing, both of which decide the shape below. Radix reads a
 * *label*, not a value — there is no value in the DOM to assert on, and the
 * label is what the user sees anyway. And its items commit on `pointerup` for a
 * mouse and on `click` for anything else, with the pointer type defaulting to
 * touch until a pointer event says otherwise — so a bare `click` is the one
 * gesture that works without staging a whole pointer sequence.
 */

/** The label a `Select` is showing, without the inline `label` prefix the chip
 * draws before it ("model", "project").
 *
 * `hidden: true` because this is worth asking *while the popup is open* — and
 * Radix marks the rest of the document `aria-hidden` for as long as it is, so
 * the default query cannot see the very trigger it came from. */
export function selectValue(name: string | RegExp): string {
  const trigger = screen.getByRole("combobox", { name, hidden: true });
  return trigger.querySelector('[data-slot="value"]')?.textContent ?? "";
}

/** Open a `Select` and leave it open, for a test about the popup itself. */
export function openSelect(name: string | RegExp): HTMLElement {
  const trigger = screen.getByRole("combobox", { name });
  fireEvent.click(trigger);
  return trigger;
}

/** Open a `Select` and pick the option with this label. */
export function chooseOption(name: string | RegExp, option: string | RegExp): void {
  openSelect(name);
  fireEvent.click(screen.getByRole("option", { name: option }));
}

/**
 * Keystrokes into an open `Select` — its filter, or Radix's typeahead.
 *
 * Aimed at the popup itself rather than at `document.activeElement`, which is
 * what a browser would carry them from. Radix moves focus into the list only
 * once the popper reports itself positioned, and in `position="popper"` that
 * report comes from floating-ui measuring an element — so under happy-dom,
 * which has no layout, focus never leaves `body` and a keystroke sent there
 * reaches nothing. The listbox is where the handler is either way.
 */
export function typeInSelect(...keys: string[]): void {
  const listbox = screen.getByRole("listbox");
  for (const key of keys) fireEvent.keyDown(listbox, { key });
}
