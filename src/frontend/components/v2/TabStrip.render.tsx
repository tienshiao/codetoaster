import { test, expect } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { TabStrip, type TabProps } from "./TabStrip";

/**
 * The strip keeps its active tab in view. A rendering test because the thing
 * under test is a layout effect and when it fires; the arithmetic of how far
 * to scroll is `strip-scroll.ts`, covered under `bun test`.
 *
 * Happy DOM has no layout engine, so every rect is zero and `clientWidth` is
 * zero. Both are stubbed here: the strip is 300px wide showing tabs 100px
 * apart, and the scroll offset is whatever the component last wrote — the DOM
 * does not clamp it, which is fine, since the assertion is on the number the
 * component asked for.
 */

const TAB_WIDTH = 100;
const STRIP_WIDTH = 300;

function tabsWithActive(active: number): TabProps[] {
  return ["a", "b", "c", "d", "e"].map((id, i) => ({
    tabId: id,
    label: id,
    active: i === active,
  }));
}

function mount(active: number) {
  const view = render(<TabStrip tabs={tabsWithActive(active)} actions={false} />);
  const scroller = view.container.querySelector<HTMLElement>('[role="tablist"] > [role="presentation"]')!;

  // Rects that move with `scrollLeft`, as the browser's would.
  scroller.getBoundingClientRect = () => ({ left: 0, width: STRIP_WIDTH, top: 0, height: 30 }) as DOMRect;
  Object.defineProperty(scroller, "clientWidth", { value: STRIP_WIDTH, configurable: true });
  Object.defineProperty(scroller, "scrollWidth", { value: TAB_WIDTH * 5, configurable: true });
  scroller.querySelectorAll<HTMLElement>("[data-tab-id]").forEach((el, index) => {
    el.getBoundingClientRect = () =>
      ({ left: index * TAB_WIDTH - scroller.scrollLeft, width: TAB_WIDTH, top: 0, height: 30 }) as DOMRect;
  });

  return {
    scroller,
    activate: (index: number) =>
      act(() => {
        view.rerender(<TabStrip tabs={tabsWithActive(index)} actions={false} />);
      }),
  };
}

test("activating a tab past the trailing edge scrolls it just into view", () => {
  const { scroller, activate } = mount(0);
  expect(scroller.scrollLeft).toBe(0);
  activate(4); // tab e spans 400–500 in a 300px strip
  expect(scroller.scrollLeft).toBe(200);
});

test("activating a tab that is already visible leaves the strip where it is", () => {
  const { scroller, activate } = mount(0);
  activate(4);
  expect(scroller.scrollLeft).toBe(200);
  activate(3); // tab d spans 300–400, visible at offset 200
  expect(scroller.scrollLeft).toBe(200);
});

test("activating a tab before the leading edge scrolls back to it", () => {
  const { scroller, activate } = mount(0);
  activate(4);
  activate(0);
  expect(scroller.scrollLeft).toBe(0);
});

test("a re-render that keeps the active tab does not move the strip", () => {
  const { scroller, activate } = mount(0);
  activate(4);
  scroller.scrollLeft = 50; // the user scrolled away by hand
  activate(4);
  expect(scroller.scrollLeft).toBe(50);
});

test("a strip that narrows under its active tab scrolls to keep the tab in view", () => {
  // Happy DOM has no ResizeObserver; a stand-in captures the callback so the
  // test can play the part of the browser noticing the strip's new width.
  const callbacks: ResizeObserverCallback[] = [];
  const observed: Element[] = [];
  class FakeResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      callbacks.push(callback);
    }
    observe(el: Element) {
      observed.push(el);
    }
    disconnect() {}
    unobserve() {}
  }
  const previous = globalThis.ResizeObserver;
  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
  try {
    const { scroller, activate } = mount(0);
    activate(4);
    expect(scroller.scrollLeft).toBe(200);
    expect(observed).toContain(scroller);

    // The strip loses half its width: tab e (400–500) now needs offset 350.
    Object.defineProperty(scroller, "clientWidth", { value: 150, configurable: true });
    act(() => {
      for (const cb of callbacks) cb([], {} as ResizeObserver);
    });
    expect(scroller.scrollLeft).toBe(350);
  } finally {
    globalThis.ResizeObserver = previous;
  }
});

test("a vertical wheel scrolls an overflowing strip sideways, and is consumed", () => {
  const { scroller } = mount(0);
  const consumed = !fireEvent.wheel(scroller, { deltaY: 40, deltaX: 0 });
  expect(scroller.scrollLeft).toBe(40);
  expect(consumed).toBe(true);
  // A horizontal wheel is the trackpad's own gesture; the browser handles it.
  fireEvent.wheel(scroller, { deltaY: 0, deltaX: 20 });
  expect(scroller.scrollLeft).toBe(40);
});

test("a line-mode wheel is scaled to pixels rather than moving the strip three of them", () => {
  // Firefox reports a mouse wheel notch as `deltaY: 3, deltaMode: 1`. Taken as
  // pixels it would nudge the strip three pixels and eat the event doing it —
  // on the one device the wheel handling exists for.
  const { scroller } = mount(0);
  fireEvent.wheel(scroller, { deltaY: 3, deltaX: 0, deltaMode: 1 });
  expect(scroller.scrollLeft).toBe(48);
});

test("a wheel over a strip with room to spare is left to whatever is behind it", () => {
  const { scroller } = mount(0);
  Object.defineProperty(scroller, "scrollWidth", { value: STRIP_WIDTH, configurable: true });
  const consumed = !fireEvent.wheel(scroller, { deltaY: 40, deltaX: 0 });
  expect(scroller.scrollLeft).toBe(0);
  expect(consumed).toBe(false);
});
