import { test, expect, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { useState } from "react";
import { ResizeHandle } from "./ResizeHandle";

/**
 * The handle installs its listeners once per gesture and holds one memoised
 * `pointerdown`, so every callback it is given has to be read at the moment it
 * fires and not at the moment the component first rendered. `onResizeStart` is
 * the one that bit: `TabArea` measures the live layout in there, and reading a
 * render-old copy of it silently resizes against a layout that no longer
 * exists.
 */

function down(el: Element, clientX: number): void {
  el.dispatchEvent(
    new window.PointerEvent("pointerdown", { bubbles: true, button: 0, clientX }),
  );
}

function move(clientX: number): void {
  window.dispatchEvent(new window.PointerEvent("pointermove", { clientX }));
}

function up(): void {
  window.dispatchEvent(new window.PointerEvent("pointerup", {}));
}

// A component whose handlers change every render, which is what every caller
// in the shell actually passes.
function Harness({ seen }: { seen: string[] }) {
  const [n, setN] = useState(0);
  return (
    <>
      <button onClick={() => setN((v) => v + 1)}>bump</button>
      <ResizeHandle
        label="Resize"
        onResizeStart={() => seen.push(`start:${n}`)}
        onResize={(px) => seen.push(`move:${n}:${px}`)}
        onResizeEnd={() => seen.push(`end:${n}`)}
      />
    </>
  );
}

test("every callback is the current one, not the one from the first render", () => {
  const seen: string[] = [];
  const view = render(<Harness seen={seen} />);
  const handle = view.getByRole("separator");

  act(() => view.getByText("bump").click());
  act(() => view.getByText("bump").click());

  down(handle, 100);
  move(140);
  up();

  expect(seen).toEqual(["start:2", "move:2:40", "end:2"]);
});

test("a handle unmounted mid-drag takes its listeners and the body flag with it", () => {
  const onResize = vi.fn();
  const view = render(<ResizeHandle label="Resize" onResize={onResize} />);
  down(view.getByRole("separator"), 100);
  expect(document.body.dataset.resizing).toBe("col");

  view.unmount();
  expect(document.body.dataset.resizing).toBeUndefined();
  move(200);
  expect(onResize).not.toHaveBeenCalled();
});
