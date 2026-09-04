import { test, expect, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";
import { usePaneWidth, type PaneWidth } from "./use-pane-width";
import {
  loadPaneWidth,
  paneListenerCount,
  resetPaneWidths,
  savePaneWidth,
  PANE_DEFAULT_PX,
  PANE_MIN_PX,
  PANE_MIN_REST_PX,
} from "@/frontend/pane-size-store";

/**
 * What a pane's width does across a lifetime, which is the half `drag.test.ts`
 * cannot see: which number is kept, and what the pane hands the layout to fit
 * it with.
 *
 * The fitting itself is flexbox's and is deliberately not tested here — happy
 * DOM has no layout engine, so a test that claimed to check it would be
 * checking nothing. What is checked is the contract that makes it possible: a
 * shrinkable basis with a floor on both sides. An earlier version of this hook
 * measured the panes and clamped them in an effect instead, and it oscillated
 * in a real browser — two sidebars sharing one main area, each taking the room
 * the other had just given up. Anything that turns `flexBasis` back into a
 * fixed `width` brings that back.
 */

const PAIR = 1000;

// Happy DOM has no layout engine, so every rect is zero and a drag has nothing
// to measure against. These model the flex row: the pane is whatever it was
// last given, and the sibling is the rest of a fixed total.
function stubRects(container: HTMLElement, total: number): void {
  const pane = container.querySelector<HTMLElement>("[data-pane]")!;
  const rest = container.querySelector<HTMLElement>("[data-rest]")!;
  const paneWidth = () => Number.parseFloat(String(pane.style.flexBasis)) || 0;
  pane.getBoundingClientRect = () => ({ width: paneWidth() }) as DOMRect;
  rest.getBoundingClientRect = () => ({ width: total - paneWidth() }) as DOMRect;
}

beforeEach(() => {
  localStorage.clear();
  // The live widths survive a cleared `localStorage`, so without this a test
  // opens at whatever the last one dragged to.
  resetPaneWidths();
});

function Harness({
  side = "left",
  api,
}: {
  side?: "left" | "right";
  api?: { current: PaneWidth | null };
}) {
  const pane = usePaneWidth("sidebar", side);
  if (api) api.current = pane;
  return (
    <div>
      <div data-pane {...pane.paneProps} />
      <div data-rest {...pane.restProps} />
    </div>
  );
}

function mount(props: Parameters<typeof Harness>[0] = {}, total = PAIR) {
  const view = render(<Harness {...props} />);
  const pane = view.container.querySelector<HTMLElement>("[data-pane]")!;
  const rest = view.container.querySelector<HTMLElement>("[data-rest]")!;
  stubRects(view.container, total);
  return { ...view, pane, rest, basis: () => Number.parseFloat(String(pane.style.flexBasis)) };
}

// AC4. The read is synchronous, so there is nothing to wait for — a stored
// width that arrives one frame late is a panel that paints its default and
// then jumps.
test("the stored width is on the first paint, not the one after it", () => {
  savePaneWidth("sidebar", 320);
  expect(mount().basis()).toBe(320);
});

test("nothing stored paints the default", () => {
  expect(mount().basis()).toBe(240);
});

// AC5, and the reason it holds without an effect measuring anything: the pane
// asks for a width it can be talked out of, and both sides carry a floor.
test("the pane offers the layout a basis it can shrink, not a width it cannot", () => {
  const { pane, rest } = mount();
  expect(pane.style.flexShrink).toBe("1");
  expect(pane.style.flexGrow).toBe("0");
  expect(pane.style.width).toBe("");
  expect(pane.style.minWidth).toBe(`${PANE_MIN_PX}px`);

  // An item with a zero basis takes no part in a shrink, so the row would
  // overflow instead of the pane giving anything up.
  expect(rest.style.flexBasis).toBe(`${PANE_MIN_REST_PX}px`);
  expect(rest.style.minWidth).toBe(`${PANE_MIN_REST_PX}px`);
  expect(rest.style.flexShrink).toBe("1");
});

// The whole point of the split: the window is temporary, the choice is not.
test("a width the window cannot grant is still the width that is stored", () => {
  savePaneWidth("sidebar", 900);
  expect(mount({}, 400).basis()).toBe(900);
  expect(loadPaneWidth("sidebar")).toBe(900);
});

// Stored once, when the pointer lifts. `savePaneWidth` is a synchronous
// read-modify-write of `localStorage`, so running it per `pointermove` would
// make the drag stutter against its own persistence for a record nothing reads
// until the next load.
test("a drag is stored when it ends, because a drag is the user asking", () => {
  const api = { current: null as PaneWidth | null };
  const view = mount({ api });
  act(() => {
    api.current!.onResizeStart();
    api.current!.onResize(80);
  });
  expect(view.basis()).toBe(320);
  expect(loadPaneWidth("sidebar")).toBe(PANE_DEFAULT_PX.sidebar);
  act(() => api.current!.onResizeEnd());
  expect(loadPaneWidth("sidebar")).toBe(320);
});

// The Explorer's divider is on its left, so the pointer travel that widens the
// task list has to narrow it.
test("a right-hand pane grows as the pointer moves left", () => {
  const api = { current: null as PaneWidth | null };
  const view = mount({ side: "right", api });
  act(() => {
    api.current!.onResizeStart();
    api.current!.onResize(-80);
  });
  expect(view.basis()).toBe(320);
});

test("a drag cannot take the pane below its floor", () => {
  const api = { current: null as PaneWidth | null };
  const view = mount({ api });
  act(() => {
    api.current!.onResizeStart();
    api.current!.onResize(-5000);
  });
  expect(view.basis()).toBe(PANE_MIN_PX);
});

test("a drag cannot take the neighbour below its floor", () => {
  const api = { current: null as PaneWidth | null };
  const view = mount({ api });
  act(() => {
    api.current!.onResizeStart();
    api.current!.onResize(5000);
  });
  expect(view.basis()).toBe(PAIR - PANE_MIN_REST_PX);
});

// Measured from the width at pointerdown, so a gesture is reversible: dragging
// past the floor and back returns to where it started rather than to the floor
// plus whatever came after it.
test("a drag past the floor and back lands where it started", () => {
  const api = { current: null as PaneWidth | null };
  const view = mount({ api });
  act(() => {
    api.current!.onResizeStart();
    api.current!.onResize(-5000);
  });
  expect(view.basis()).toBe(PANE_MIN_PX);
  act(() => api.current!.onResize(0));
  expect(view.basis()).toBe(240);
});

test("an arrow key moves the divider and stores the result", () => {
  const api = { current: null as PaneWidth | null };
  const view = mount({ api });
  act(() => api.current!.onNudge(16));
  expect(view.basis()).toBe(256);
  expect(loadPaneWidth("sidebar")).toBe(256);
});

// ── two panes sharing one id ────────────────────────────────────────────────
//
// A split shows two file trees at once and both call `usePaneWidth("file-tree")`,
// because a tree width is one preference and not one per view. Held in the
// hook's own state, the width was one per *mount* instead: the drag moved the
// tree under the pointer and the other stayed where it was until it remounted
// (§TASK-73).

function mountPair(total = PAIR) {
  const first = { current: null as PaneWidth | null };
  const second = { current: null as PaneWidth | null };
  const view = render(
    <>
      <div data-first>
        <Harness api={first} />
      </div>
      <div data-second>
        <Harness api={second} />
      </div>
    </>,
  );
  const basisOf = (selector: string) => () => {
    const el = view.container.querySelector<HTMLElement>(`${selector} [data-pane]`)!;
    return Number.parseFloat(String(el.style.flexBasis));
  };
  stubRects(view.container.querySelector<HTMLElement>("[data-first]")!, total);
  stubRects(view.container.querySelector<HTMLElement>("[data-second]")!, total);
  return {
    ...view,
    first,
    second,
    basisFirst: basisOf("[data-first]"),
    basisSecond: basisOf("[data-second]"),
  };
}

// AC1.
test("dragging one pane moves the other reading the same id, within the gesture", () => {
  const view = mountPair();
  expect(view.basisSecond()).toBe(PANE_DEFAULT_PX.sidebar);
  act(() => {
    view.first.current!.onResizeStart();
    view.first.current!.onResize(80);
  });
  expect(view.basisFirst()).toBe(320);
  expect(view.basisSecond()).toBe(320);
});

// AC2. Before the store held the live width this read `localStorage`, so a pane
// opened mid-drag — a split made while dragging, a tab switched back to — came
// up at whatever was last written rather than at what is on screen.
test("a pane mounted after a drag opens at the dragged width, not the stored one", () => {
  const api = { current: null as PaneWidth | null };
  mount({ api });
  act(() => {
    api.current!.onResizeStart();
    api.current!.onResize(80);
  });
  expect(loadPaneWidth("sidebar")).toBe(PANE_DEFAULT_PX.sidebar);
  expect(mount().basis()).toBe(320);
});

// AC4. Every mounted pane is a listener, and panes close all day.
test("a closed pane leaves no listener behind", () => {
  const view = mount();
  expect(paneListenerCount("sidebar")).toBe(1);
  view.unmount();
  expect(paneListenerCount("sidebar")).toBe(0);
});

// `onResizeEnd` fires on every pointerup, including one with no move behind it,
// so what is written has to be the width the panes are actually at.
test("a click on one handle does not persist over another pane's drag", () => {
  const view = mountPair();
  act(() => {
    view.first.current!.onResizeStart();
    view.first.current!.onResize(80);
    view.first.current!.onResizeEnd();
  });
  act(() => {
    view.second.current!.onResizeStart();
    view.second.current!.onResizeEnd();
  });
  expect(loadPaneWidth("sidebar")).toBe(320);
});
