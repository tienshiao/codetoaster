import { useState } from "react";
import { test, expect } from "bun:test";
import { act, render } from "@testing-library/react";
import { TabArea } from "./TabArea";
import { createLayout, openTab, resetIdCounter, type TaskLayout } from "@/frontend/layout-store";

/**
 * The tab strip's gestures.
 *
 * `drag.test.ts` covers the arithmetic — which side of a tab a drop landed on,
 * how far a boundary may travel. What it cannot see is the part that went
 * wrong: *when* a gesture's ref is written relative to the release of the one
 * before it. That needs the component.
 */

const TAB_WIDTH = 100;

/** Centre of the tab at `index`, in the geometry `stubGeometry` installs. */
const centreOf = (index: number) => index * TAB_WIDTH + TAB_WIDTH / 2;

/** Happy DOM has no layout engine, so every rect is zero and every hit test
 * misses. The drag asks the DOM exactly two things — where the tabs are, and
 * which strip is under the pointer — so those two are answered here, with the
 * strip laid out as a row of equal tabs. */
function stubGeometry(container: HTMLElement): void {
  const strip = container.querySelector<HTMLElement>("[data-tab-group]")!;
  container.querySelectorAll<HTMLElement>("[data-tab-id]").forEach((el, index) => {
    el.getBoundingClientRect = () =>
      ({ left: index * TAB_WIDTH, width: TAB_WIDTH, top: 0, height: 30 }) as DOMRect;
  });
  document.elementFromPoint = () => strip;
}

function pointer(type: string, x: number, id: number): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: type === "pointerup" || type === "pointercancel" ? 0 : 1,
    pointerId: id,
    clientX: x,
    clientY: 15,
  });
}

function Controlled({ initial }: { initial: TaskLayout }) {
  const [layout, setLayout] = useState(initial);
  return <TabArea layout={layout} onLayoutChange={setLayout} renderPane={() => null} />;
}

function mountArea() {
  resetIdCounter();
  let layout = createLayout(); // the agent tab
  layout = openTab(layout, { kind: "diffAll" });
  layout = openTab(layout, { kind: "history" });

  const view = render(<Controlled initial={layout} />);
  stubGeometry(view.container);

  const tabs = () => Array.from(view.container.querySelectorAll<HTMLElement>("[data-tab-id]"));
  return {
    // Read off the strip, in the order it draws them: the outcome a user sees,
    // rather than an argument a callback happened to be handed.
    order: () => tabs().map((el) => el.getAttribute("aria-label") ?? el.textContent?.trim() ?? ""),
    tabAt: (index: number) => tabs()[index]!,
    on: (target: EventTarget, type: string, x: number, id: number) =>
      act(() => {
        target.dispatchEvent(pointer(type, x, id));
      }),
  };
}

test("a tab dragged past its neighbour lands where it was dropped", () => {
  const area = mountArea();
  const [agent, diffAll, history] = area.order();
  expect([agent, diffAll, history]).toEqual(["Agent", "Changes", "History"]);

  area.on(area.tabAt(1), "pointerdown", centreOf(1), 1);
  area.on(window, "pointermove", centreOf(1) + 10, 1);
  area.on(window, "pointermove", centreOf(2) + 40, 1);
  area.on(window, "pointerup", centreOf(2) + 40, 1);

  expect(area.order()).toEqual(["Agent", "History", "Changes"]);
});

test("a gesture starting while another is still installed can still be dragged", () => {
  const area = mountArea();

  // A pointer that presses and never lifts: a second finger on a touch screen,
  // or a `pointerup` the window never saw. Its gesture stays installed.
  area.on(area.tabAt(0), "pointerdown", centreOf(0), 1);

  // A second pointer now starts a real drag. Releasing the stale gesture runs
  // its finish handler, which nulls the gesture ref — so if that release
  // happens *after* this gesture is written down, every move below reads null
  // and the tab silently refuses to move.
  area.on(area.tabAt(1), "pointerdown", centreOf(1), 2);
  area.on(window, "pointermove", centreOf(1) + 10, 2);
  area.on(window, "pointermove", centreOf(2) + 40, 2);
  area.on(window, "pointerup", centreOf(2) + 40, 2);

  expect(area.order()).toEqual(["Agent", "History", "Changes"]);
});

test("a press that never travels is a click, not a drag", () => {
  const area = mountArea();

  // Under the 4px threshold: a click with a shaky hand must still be a click.
  area.on(area.tabAt(1), "pointerdown", centreOf(1), 1);
  area.on(window, "pointermove", centreOf(1) + 2, 1);
  area.on(window, "pointerup", centreOf(1) + 2, 1);

  expect(area.order()).toEqual(["Agent", "Changes", "History"]);
});

test("a cancelled gesture drops the move rather than committing it", () => {
  const area = mountArea();

  // `pointercancel` is a touch that turned into a scroll. The drag is
  // abandoned, not applied at wherever the pointer happened to be.
  area.on(area.tabAt(1), "pointerdown", centreOf(1), 1);
  area.on(window, "pointermove", centreOf(2) + 40, 1);
  area.on(window, "pointercancel", centreOf(2) + 40, 1);

  expect(area.order()).toEqual(["Agent", "Changes", "History"]);
});
