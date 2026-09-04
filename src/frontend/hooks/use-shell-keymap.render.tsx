import { test, expect, beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";
import { useShellKeymap, type ShellKeymapOptions } from "./use-shell-keymap";
import {
  activeGroup,
  activeTab,
  closeTab,
  createLayout,
  focusTab,
  openTab,
  resetIdCounter,
  splitTab,
  tabKey,
  type TabDescriptor,
  type TabState,
  type TaskLayout,
} from "@/frontend/layout-store";

/**
 * What the leader map does once it is bound to a window and a layout.
 *
 * `keymap.test.ts` owns the chord rules and `layout-store.test.ts` the
 * reductions; neither can see the part that only exists at runtime — that the
 * listener is in the capture phase, that consuming a key really does stop it
 * reaching the pane below, and that the handler run is the one from the latest
 * render rather than the one the effect closed over on mount.
 */

// Every chord here is written for a Mac, and `isMac()` reads
// `navigator.platform`, which happy DOM leaves as a bare "" — so the hook's
// default would take the ⌃⇧K branch. Set once for the file.
beforeEach(() => {
  Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true });
});

const file = (path: string): TabDescriptor => ({ kind: "file", path });

/** [agent, a.ts, b.ts] in one group, focused on the agent. */
function threeTabs(): TaskLayout {
  resetIdCounter();
  let layout = createLayout();
  layout = openTab(layout, file("a.ts"));
  layout = openTab(layout, file("b.ts"));
  const agent = activeGroup(layout).tabs[0]!;
  return focusTab(layout, agent.id);
}

/** The key of the tab the layout is focused on — what most assertions read. */
function focusedKey(layout: TaskLayout): string {
  return activeTab(layout)?.key ?? "";
}

interface Harness {
  /** The layout as the hook last left it. */
  layout: () => TaskLayout;
  newShell: ReturnType<typeof vi.fn>;
  closed: ReturnType<typeof vi.fn>;
  /** Keydowns seen by a listener *below* the hook's, on the bubble path. */
  reachedPane: KeyboardEvent[];
  press: (key: string, mods?: Partial<KeyboardEventInit>) => void;
  rerender: () => void;
  unmount: () => void;
  /** Rewrite the layout the way something other than the hook would. */
  replace: (next: TaskLayout) => void;
}

function mount(initial: TaskLayout | null = threeTabs()): Harness {
  let layout = initial;
  const newShell = vi.fn();
  const closed = vi.fn();
  const reachedPane: KeyboardEvent[] = [];

  // A stand-in for xterm's own handler: bound on an element, so it runs on the
  // bubble path after a window-capture listener has had its say. If the hook
  // ever stops calling `stopPropagation`, this fills up.
  const pane = document.createElement("div");
  document.body.append(pane);
  pane.addEventListener("keydown", (ev) => reachedPane.push(ev));

  function Harness() {
    const options: ShellKeymapOptions = {
      layout: () => layout,
      onLayoutChange: (next) => {
        layout = next;
      },
      onNewShell: newShell,
      onCloseTab: (tab: TabState) => closed(tab.key),
    };
    useShellKeymap(options);
    return null;
  }

  const view = render(<Harness />);

  return {
    layout: () => layout!,
    newShell,
    closed,
    reachedPane,
    press: (key, mods = {}) => {
      // Dispatched on the pane so the event has a path to travel: capture at
      // the window first, then the pane's own listener — the same two steps a
      // keystroke in a terminal takes.
      pane.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...mods }));
    },
    rerender: () => view.rerender(<Harness />),
    unmount: () => view.unmount(),
    replace: (next) => {
      layout = next;
    },
  };
}

/** ⌘K, then the chord's key with ⌘ still down — how a hand actually types it. */
function chord(h: Harness, key: string): void {
  h.press("k", { metaKey: true });
  h.press(key, { metaKey: true });
}

// ── the listener ────────────────────────────────────────────────────────────

test("a chord never reaches the pane below", () => {
  const h = mount();
  chord(h, "]");
  expect(h.reachedPane).toEqual([]);
});

test("ordinary typing reaches the pane untouched", () => {
  const h = mount();
  h.press("k");
  h.press("]");
  expect(h.reachedPane.map((e) => e.key)).toEqual(["k", "]"]);
  expect(h.reachedPane.every((e) => !e.defaultPrevented)).toBe(true);
});

test("an unbound second press is eaten rather than typed into the agent", () => {
  const h = mount();
  h.press("k", { metaKey: true });
  h.press("q");
  expect(h.reachedPane).toEqual([]);
  expect(focusedKey(h.layout())).toBe("agent");
});

test("the listener comes off on unmount, and the keys go back to the pane", () => {
  const h = mount();
  h.unmount();
  chord(h, "]");
  expect(focusedKey(h.layout())).toBe("agent");
  // Both presses, unconsumed — a leader left bound after the shell has gone
  // would eat the next keystroke of whatever replaced it.
  expect(h.reachedPane.map((e) => e.key)).toEqual(["k", "]"]);
});

// ── the commands ────────────────────────────────────────────────────────────

test("⌘K ] and ⌘K [ walk the strip", () => {
  const h = mount();
  chord(h, "]");
  expect(focusedKey(h.layout())).toBe("file:a.ts");
  h.rerender();
  chord(h, "[");
  expect(focusedKey(h.layout())).toBe("agent");
});

test("⌘K 2 goes to the second tab", () => {
  const h = mount();
  chord(h, "2");
  expect(focusedKey(h.layout())).toBe("file:a.ts");
});

test("⌘K A goes back to the agent", () => {
  const h = mount();
  chord(h, "3");
  h.rerender();
  expect(focusedKey(h.layout())).toBe("file:b.ts");
  chord(h, "a");
  expect(focusedKey(h.layout())).toBe("agent");
});

test("⌘K ` asks for a new shell", () => {
  const h = mount();
  chord(h, "`");
  expect(h.newShell).toHaveBeenCalledTimes(1);
});

test("⌘K \\ splits the active tab, and does nothing on the agent", () => {
  const h = mount();
  // The agent is a terminal, so it never splits.
  chord(h, "\\");
  expect(h.layout().groups).toHaveLength(1);

  h.rerender();
  chord(h, "2");
  h.rerender();
  chord(h, "\\");
  expect(h.layout().groups).toHaveLength(2);
});

test("⌘K ← and ⌘K → move between groups", () => {
  let layout = threeTabs();
  layout = focusTab(layout, activeGroup(layout).tabs[1]!.id);
  layout = splitTab(layout, activeTab(layout)!.id);
  const h = mount(layout);
  // The split left focus in the new group, on the right.
  expect(h.layout().activeGroupId).toBe(h.layout().groups[1]!.id);

  chord(h, "ArrowLeft");
  expect(h.layout().activeGroupId).toBe(h.layout().groups[0]!.id);
  h.rerender();
  chord(h, "ArrowRight");
  expect(h.layout().activeGroupId).toBe(h.layout().groups[1]!.id);
});

test("⌘K W closes the tab and runs the side effect the X runs", () => {
  const h = mount();
  chord(h, "2");
  h.rerender();
  chord(h, "w");
  expect(h.closed).toHaveBeenCalledWith("file:a.ts");
  expect(h.layout().groups[0]!.tabs.map((t) => t.key)).toEqual(["agent", "file:b.ts"]);
});

test("⌘K W on the agent tab closes nothing and kills nothing", () => {
  const h = mount();
  expect(focusedKey(h.layout())).toBe("agent");
  chord(h, "w");
  // The side effect matters as much as the layout here: firing it would ask
  // the server to close a PTY that is the task itself.
  expect(h.closed).not.toHaveBeenCalled();
  expect(h.layout().groups[0]!.tabs).toHaveLength(3);
});

// ── staying current ─────────────────────────────────────────────────────────

test("two chords inside one commit compose, rather than the second undoing the first", () => {
  const h = mount();
  // No render between them: `⌘K ] ⌘K ]` typed at speed. Reading the layout
  // from the last render would reduce both over the same starting point and
  // land on the same tab twice.
  chord(h, "]");
  chord(h, "]");
  expect(focusedKey(h.layout())).toBe("file:b.ts");
});

test("a layout rewritten from outside the hook is the one the next chord moves", () => {
  // Something else — a tab closed in the Explorer, §5.5's shell-tab
  // reconciliation — replaces the layout without the hook hearing about it.
  // The getter is what makes that safe; a captured value would move a tab that
  // is no longer there.
  const h = mount();
  chord(h, "3");
  expect(focusedKey(h.layout())).toBe("file:b.ts");

  h.replace(closeTab(h.layout(), h.layout().groups[0]!.tabs[2]!.id));
  chord(h, "2");
  expect(focusedKey(h.layout())).toBe("file:a.ts");
  expect(h.layout().groups[0]!.tabs.map((t) => t.key)).toEqual(["agent", "file:a.ts"]);
});

test("with no layout, only the shell command still works", () => {
  const h = mount(null);
  chord(h, "]");
  chord(h, "`");
  expect(h.newShell).toHaveBeenCalledTimes(1);
  // And the keys were still consumed — at the composer there is no pane
  // underneath that wants them.
  expect(h.reachedPane).toEqual([]);
});

test("the agent tab's key is the one the focus command looks for", () => {
  // Guards the pairing rather than restating it: `findAgentTab` searches by
  // key, and a renamed agent descriptor would leave ⌘K A silently doing
  // nothing.
  expect(tabKey({ kind: "agent" })).toBe("agent");
});
