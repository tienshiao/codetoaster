import { test, expect, beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";
import { useShellKeymap, type ShellKeymap, type ShellKeymapOptions } from "./use-shell-keymap";
import { SHELL_COMMANDS, type ShellCommand } from "@/frontend/keymap";
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
  focused: ReturnType<typeof vi.fn>;
  palette: ReturnType<typeof vi.fn>;
  /** The dispatcher the hook returns — the palette's way in. */
  run: (command: ShellCommand) => void;
  /** Keydowns seen by a listener *below* the hook's, on the bubble path. */
  reachedPane: KeyboardEvent[];
  /** Returns the event it dispatched, for a test that asks what was done to it. */
  press: (key: string, mods?: Partial<KeyboardEventInit>) => KeyboardEvent;
  rerender: () => void;
  unmount: () => void;
  /** Rewrite the layout the way something other than the hook would. */
  replace: (next: TaskLayout) => void;
}

function mount(initial: TaskLayout | null = threeTabs()): Harness {
  let layout = initial;
  const newShell = vi.fn();
  const closed = vi.fn();
  const focused = vi.fn();
  const palette = vi.fn();
  const reachedPane: KeyboardEvent[] = [];
  // Written on every render and read at call time, so a test always dispatches
  // through the dispatcher the latest render handed out rather than the mount's.
  let dispatch: ShellKeymap["run"] | null = null;

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
      onFocusPane: focused,
      onTogglePalette: palette,
    };
    dispatch = useShellKeymap(options).run;
    return null;
  }

  const view = render(<Harness />);

  return {
    layout: () => layout!,
    newShell,
    closed,
    focused,
    palette,
    run: (command) => dispatch!(command),
    reachedPane,
    press: (key, mods = {}) => {
      // Dispatched on the pane so the event has a path to travel: capture at
      // the window first, then the pane's own listener — the same two steps a
      // keystroke in a terminal takes. `cancelable`, because a real keydown is
      // and `preventDefault` on one that is not leaves `defaultPrevented` false
      // — which would make every assertion about consuming a key vacuous.
      const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...mods });
      pane.dispatchEvent(ev);
      return ev;
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

/** One row of the table, by id, for a test that dispatches without a keyboard. */
function command(id: string): ShellCommand {
  return SHELL_COMMANDS.find((c) => c.id === id)!;
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

// ── the direct chord ────────────────────────────────────────────────────────

test("⌘⇧P opens the palette, and is consumed on the way", () => {
  const h = mount();
  // `P`, because the browser reports the shifted cap — and with no leader in
  // front of it, so a single press.
  const ev = h.press("P", { metaKey: true, shiftKey: true });
  expect(h.palette).toHaveBeenCalledTimes(1);
  expect(h.reachedPane).toEqual([]);
  // Stopped *and* prevented: stopping alone would still leave the browser free
  // to act on the key.
  expect(ev.defaultPrevented).toBe(true);
});

test("⌘K then P is a cancelled chord, not the palette", () => {
  // The palette has one entrance, and an armed leader owns the keyboard.
  const h = mount();
  h.press("k", { metaKey: true });
  h.press("p");
  expect(h.palette).not.toHaveBeenCalled();
  expect(h.reachedPane).toEqual([]);
});

test("the palette opens at the composer too, where there is no layout", () => {
  const h = mount(null);
  h.press("P", { metaKey: true, shiftKey: true });
  expect(h.palette).toHaveBeenCalledTimes(1);
});

// ── the dispatcher the palette runs through ─────────────────────────────────

test("run() does what the chord does, so the palette cannot drift from it", () => {
  const h = mount();
  h.run(command("next-tab"));
  expect(focusedKey(h.layout())).toBe("file:a.ts");
  // Including the parts that are not the reduction: a navigation raised from
  // the palette still sends the caret after it.
  expect(h.focused).toHaveBeenCalledTimes(1);
});

test("run() reads the layout at call time, like the keydown path", () => {
  const h = mount();
  chord(h, "]");
  // No render in between, so a captured layout would put both moves on the
  // same starting point.
  h.run(command("next-tab"));
  expect(focusedKey(h.layout())).toBe("file:b.ts");
});

test("run() reaches the commands that need no layout", () => {
  const h = mount(null);
  h.run(command("palette"));
  h.run(command("new-shell"));
  expect(h.palette).toHaveBeenCalledTimes(1);
  expect(h.newShell).toHaveBeenCalledTimes(1);
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

// ── the caret follows the chord ─────────────────────────────────────────────

test("every navigation asks the pane it landed on for the caret", () => {
  for (const key of ["]", "[", "2", "a"]) {
    const h = mount();
    chord(h, key);
    expect(h.focused, `⌘K ${key}`).toHaveBeenCalledTimes(1);
    h.unmount();
  }
});

test("⌘K A asks for the caret even when the agent tab is already in front", () => {
  // The commonest use of the chord: the user clicked into a file tree and
  // wants to type at the agent again. Nothing about the layout changes.
  const h = mount();
  expect(focusedKey(h.layout())).toBe("agent");
  chord(h, "a");
  expect(h.focused).toHaveBeenCalledTimes(1);
});

test("a clamped group move does not yank the caret", () => {
  // Already leftmost: the reduction returns the same layout, and pulling focus
  // for a chord that did nothing would take it out of whatever the user was
  // typing in.
  const h = mount();
  chord(h, "ArrowLeft");
  expect(h.focused).not.toHaveBeenCalled();
});

test("a jump to a tab that is not there does not yank the caret either", () => {
  const h = mount();
  chord(h, "9");
  expect(h.focused).not.toHaveBeenCalled();
  expect(focusedKey(h.layout())).toBe("agent");
});

test("the commands that are not navigations leave the caret alone", () => {
  const h = mount();
  // A new shell focuses itself when it attaches; a close moves the layout but
  // the pane that lands in front is not something the keyboard chose.
  chord(h, "`");
  expect(h.focused).not.toHaveBeenCalled();
});
