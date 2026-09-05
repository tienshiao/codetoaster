import { useEffect, useState } from "react";
import { test, expect, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { TabArea, type TabAreaProps } from "./TabArea";
import {
  createLayout,
  focusTab,
  openTab,
  resetIdCounter,
  splitTab,
  type TaskLayout,
} from "@/frontend/layout-store";
import { chordHint, searchHint } from "@/frontend/keymap";

/**
 * The tab strip's gestures. A rendering test, so Vitest's, not `bun test`'s —
 * see CLAUDE.md, "Testing", for why the two runners are split by filename.
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

/**
 * The drag proxy, which is portalled to `<body>` and so is nowhere in the
 * render's own container.
 *
 * Found by being an `aria-hidden` child of `<body>` itself: Testing Library's
 * container is body's other child and carries no such attribute, so this stays
 * specific without the component needing a hook that exists only for a test.
 */
function proxyEl(): HTMLElement | null {
  return (
    (Array.from(document.body.children).find((el) => el.hasAttribute("aria-hidden")) as
      | HTMLElement
      | undefined) ?? null
  );
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

type ExtraProps = Omit<TabAreaProps, "layout" | "onLayoutChange" | "renderPane">;

function Controlled({ initial, ...rest }: { initial: TaskLayout } & ExtraProps) {
  const [layout, setLayout] = useState(initial);
  return (
    <TabArea layout={layout} onLayoutChange={setLayout} renderPane={() => null} {...rest} />
  );
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
    // Returns the event so a test can ask whether the drag consumed it: an
    // Escape that reaches the pane behind the gesture is one the terminal
    // under the pointer also acts on.
    press: (key: string) => {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      act(() => {
        window.dispatchEvent(event);
      });
      return event;
    },
    unmount: () => act(() => view.unmount()),
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

/**
 * The proxy: the tab the user is carrying.
 *
 * Its position is never in the JSX — it is written to `style.transform` from
 * the pointermove handler, because a `TabArea` re-render is every group, strip
 * and mounted pane, and the gesture would pay that on every move across a
 * strip. That makes *where* it ends up something only a mounted component can
 * answer, which is why these are here and not in `drag.test.ts`.
 */

test("a drag past the threshold carries a proxy under the pointer", () => {
  const area = mountArea();

  // The press alone carries nothing: until the threshold is crossed this is
  // still a click, and a proxy appearing under a click is the gesture
  // announcing itself before it has happened.
  area.on(area.tabAt(1), "pointerdown", centreOf(1), 1);
  expect(proxyEl()).toBeNull();
  expect(document.body.dataset.dragging).toBeUndefined();

  area.on(window, "pointermove", centreOf(2) + 40, 1);

  const proxy = proxyEl();
  expect(proxy).not.toBeNull();
  // Grabbed 50px into a 100px-wide tab, so it hangs 50px left of the pointer
  // and keeps the tab's width rather than shrinking to fit its own label.
  expect(proxy!.style.width).toBe("100px");
  expect(proxy!.style.transform).toContain("240px");
  // The hook `index.css` hangs the grabbing cursor and the selection guard on:
  // without it the drag paints every pane it crosses blue.
  expect(document.body.dataset.dragging).toBe("tab");

  area.on(window, "pointerup", centreOf(2) + 40, 1);

  expect(proxyEl()).toBeNull();
  expect(document.body.dataset.dragging).toBeUndefined();
});

test("the proxy keeps its place across a re-render mid-drag", () => {
  const area = mountArea();

  area.on(area.tabAt(1), "pointerdown", centreOf(1), 1);
  area.on(window, "pointermove", centreOf(2) + 40, 1);
  expect(proxyEl()!.style.transform).toContain("240px");

  // Crossing back over a midpoint moves the drop indicator, which is state, so
  // this move re-renders the whole area. The transform lives outside the JSX
  // and React does not restore it — so unless a layout effect re-applies it
  // after every render, the proxy snaps back to where the drag began.
  area.on(window, "pointermove", centreOf(0) + 10, 1);

  expect(proxyEl()!.style.transform).toContain("10px");
  expect(proxyEl()!.style.transform).not.toContain("240px");
});

test("Escape abandons the drag and puts the proxy down", () => {
  const area = mountArea();

  // The one way out that does not involve letting go: the pointer is still
  // held, so neither `pointerup` nor `pointercancel` is coming.
  area.on(area.tabAt(1), "pointerdown", centreOf(1), 1);
  area.on(window, "pointermove", centreOf(2) + 40, 1);
  expect(proxyEl()).not.toBeNull();

  area.press("Escape");

  expect(area.order()).toEqual(["Agent", "Changes", "History"]);
  expect(proxyEl()).toBeNull();
  expect(document.body.dataset.dragging).toBeUndefined();

  // And the gesture is genuinely retired, not merely hidden: a release that
  // arrives afterwards must not commit the move Escape just refused.
  area.on(window, "pointerup", centreOf(2) + 40, 1);
  expect(area.order()).toEqual(["Agent", "Changes", "History"]);
});

test("Escape is the drag's only once there is a drag", () => {
  const area = mountArea();

  // A press that has not passed the threshold is still a click. Escape here
  // belongs to whatever has focus behind the strip — the terminal the pointer
  // is over, a dialog — so the gesture must neither swallow it nor retire
  // itself over it, or the same still-held pointer could no longer drag.
  area.on(area.tabAt(1), "pointerdown", centreOf(1), 1);
  expect(area.press("Escape").defaultPrevented).toBe(false);

  area.on(window, "pointermove", centreOf(2) + 40, 1);
  expect(proxyEl()).not.toBeNull();

  // Now it is the drag's, and is consumed: left to bubble it would cancel the
  // drag *and* reach the pane under the pointer.
  expect(area.press("Escape").defaultPrevented).toBe(true);
  expect(proxyEl()).toBeNull();
  expect(area.order()).toEqual(["Agent", "Changes", "History"]);
});

test("a component unmounted mid-drag leaves no proxy on the page", () => {
  const area = mountArea();

  area.on(area.tabAt(1), "pointerdown", centreOf(1), 1);
  area.on(window, "pointermove", centreOf(2) + 40, 1);
  expect(proxyEl()).not.toBeNull();

  // The task closed under the drag, or the shell navigated away. The proxy is
  // portalled to `<body>`, so nothing about the component going away removes
  // it on its own — and `<body>` would keep the grabbing cursor for the life
  // of the page.
  area.unmount();

  expect(proxyEl()).toBeNull();
  expect(document.body.dataset.dragging).toBeUndefined();
});

/**
 * The chord hints, which belong to the *layout's* active group rather than to
 * each group's own front tab.
 *
 * `⌘K W` closes what is in front of the focused group, so a second group's front
 * tab naming it would be advertising a key that closes somebody else's tab —
 * exactly what the hint is there to avoid.
 */
test("only the focused group's front tab names the close chord", () => {
  resetIdCounter();
  let layout = createLayout(); // the agent tab
  layout = openTab(layout, { kind: "diffAll" });
  // Splitting makes the new group the active one, so the hints must move to it.
  const active = layout.groups[0]!.activeTabId!;
  layout = splitTab(layout, active);

  const view = render(<Controlled initial={layout} />);
  const columns = Array.from(view.container.querySelectorAll<HTMLElement>("[data-tab-column]"));
  expect(columns).toHaveLength(2);

  const closeTitles = (column: HTMLElement) =>
    Array.from(column.querySelectorAll<HTMLElement>("[data-tab-close]")).map((el) =>
      el.getAttribute("title"),
    );
  const hint = chordHint("close-tab");

  expect(closeTitles(columns[1]!)).toContain(`Close Changes (${hint})`);
  expect(closeTitles(columns[0]!).join(" ")).not.toContain(hint);

  // Same rule for the Split button: named once, on the group the chord splits.
  const splitTitle = (column: HTMLElement) =>
    column.querySelector<HTMLElement>('[aria-label^="Split right"]')?.getAttribute("title");
  expect(splitTitle(columns[1]!)).toBe(`Split right (${chordHint("split")})`);
  expect(splitTitle(columns[0]!)).toBe("Split right");
});

/**
 * The terminal tabs' one privilege: they survive being switched away from.
 *
 * A `useEffect` in the pane is what is under test, not the markup — a pane that
 * unmounts loses its attachment and its xterm grid, and comes back only at the
 * cost of a full `restore` from the server. Counting mounts is the only way to
 * see the difference, because both arrangements look identical on screen.
 */
function mountWithPanes() {
  resetIdCounter();
  let layout = createLayout(); // the agent tab
  layout = openTab(layout, { kind: "diffAll" }); // …which this makes active

  const mounts: string[] = [];
  const unmounts: string[] = [];
  const visibility: string[] = [];

  // Mount accounting is keyed on nothing, deliberately: `visible` changing is a
  // prop change, and counting it as a remount would hide the very difference
  // this file exists to measure.
  function Pane({ kind, visible }: { kind: string; visible: boolean }) {
    useEffect(() => {
      mounts.push(kind);
      return () => {
        unmounts.push(kind);
      };
    }, [kind]);
    useEffect(() => {
      visibility.push(`${kind}:${visible}`);
    }, [kind, visible]);
    return <div>{kind}</div>;
  }

  function Host() {
    const [current, setLayout] = useState(layout);
    return (
      <TabArea
        layout={current}
        onLayoutChange={setLayout}
        renderPane={(tab, _group, visible) => (
          <Pane key={tab.key} kind={tab.descriptor.kind} visible={visible} />
        )}
      />
    );
  }

  const view = render(<Host />);
  // `role=tab` rather than `[data-tab-id]`: the latter is the drag's outer
  // handle, and the click lives on the button inside it.
  const tabs = () => Array.from(view.container.querySelectorAll<HTMLElement>("[role=tab]"));
  return {
    mounts,
    unmounts,
    visibility,
    click: (index: number) =>
      act(() => {
        tabs()[index]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }),
  };
}

test("a terminal tab is mounted even while another tab is showing", () => {
  const area = mountWithPanes();

  // `openTab` focused Changes, so the agent is the one off screen — and it is
  // mounted anyway, which is the whole point.
  expect(area.mounts).toEqual(["agent", "diffAll"]);
  expect(area.visibility).toEqual(["agent:false", "diffAll:true"]);
});

test("switching between tabs never remounts the terminal", () => {
  const area = mountWithPanes();

  area.click(0); // to Agent
  area.click(1); // back to Changes

  // Mounted once, at the start, and never again: the attachment and the grid
  // outlive every switch. Only its visibility moved, which is how it knows to
  // stop reporting its size into smallest-wins.
  expect(area.mounts.filter((k) => k === "agent")).toEqual(["agent"]);
  expect(area.unmounts).not.toContain("agent");
  expect(area.visibility.filter((v) => v.startsWith("agent"))).toEqual([
    "agent:false",
    "agent:true",
    "agent:false",
  ]);
});

test("a read-only tab is unmounted when it stops showing", () => {
  const area = mountWithPanes();

  area.click(0); // to Agent

  // The diff pane goes: it is a query and a scroll offset, both cheap to
  // rebuild and both already persisted by tab key. Keeping every pane alive
  // would be the expensive half of the bargain with none of the benefit.
  expect(area.unmounts).toEqual(["diffAll"]);
});

/**
 * The strip's magnifier (TASK-58, AC #2): search without the keyboard.
 *
 * Only a terminal has a grid to search, so in front of anything else the
 * button greys out rather than vanishing — the same rule Split follows, and
 * the same reason: a control that disappears reads as a bug.
 */
function findButton(container: HTMLElement): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(
    '[aria-label="Find in terminal"], [aria-label="Find (terminal tabs only)"]',
  );
}

test("the magnifier is greyed out in front of a tab with no grid", () => {
  resetIdCounter();
  // `openTab` focuses what it opens, so Changes is the active tab.
  const layout = openTab(createLayout(), { kind: "diffAll" });

  const view = render(<Controlled initial={layout} onSearchTab={vi.fn()} />);
  const button = findButton(view.container)!;

  expect(button.getAttribute("aria-label")).toBe("Find (terminal tabs only)");
  expect(button.disabled).toBe(true);
  // And it names no chord: ⌘F beside a control that will not act is a chord
  // that appears broken.
  expect(button.getAttribute("title")).toBe("Find (terminal tabs only)");
});

test("in front of a terminal it acts, and says which key does the same", () => {
  resetIdCounter();
  let layout = createLayout(); // the agent tab
  layout = openTab(layout, { kind: "diffAll" });
  const agent = layout.groups[0]!.tabs[0]!;
  layout = focusTab(layout, agent.id);

  const onSearchTab = vi.fn();
  const view = render(<Controlled initial={layout} onSearchTab={onSearchTab} />);
  const button = findButton(view.container)!;

  expect(button.disabled).toBe(false);
  expect(button.getAttribute("title")).toBe(`Find in terminal (${searchHint()})`);

  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  // The group's *active* tab, which is what the bar would open over.
  expect(onSearchTab).toHaveBeenCalledWith(expect.objectContaining({ id: agent.id }));
});

test("a strip with nobody to answer draws no magnifier at all", () => {
  resetIdCounter();
  const view = render(<Controlled initial={createLayout()} />);
  expect(findButton(view.container)).toBeNull();
});

/**
 * The phone's one group (TASK-33, §9 risk 6).
 *
 * Split goes away entirely rather than greying out, which is the opposite of
 * what the magnifier above does — and deliberately: a disabled control says
 * "not this tab", which switching tabs answers, while on a phone there is no
 * tab that would ever enable it.
 */
test("Split is off the strip under a single-group env, and on it without one", () => {
  resetIdCounter();
  // A tab that splits by every other rule, so what is measured is the device.
  const layout = openTab(createLayout(), { kind: "diff", path: "src/a.ts" });

  const phone = render(<Controlled initial={layout} env={{ singleGroup: true }} />);
  expect(phone.queryByLabelText(/^Split right/)).toBeNull();
  phone.unmount();

  const desktop = render(<Controlled initial={layout} />);
  expect(desktop.getByLabelText("Split right")).not.toBeNull();
});
