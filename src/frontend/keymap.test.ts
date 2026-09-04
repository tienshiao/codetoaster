import { test, expect } from "bun:test";
import {
  SHELL_COMMANDS,
  isLeader,
  matchCommand,
  terminalMustYield,
  leaderCaps,
  chordCaps,
  capsFor,
  type KeyLike,
} from "./keymap";

function press(key: string, mods: Partial<Omit<KeyLike, "key">> = {}): KeyLike {
  return { key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods };
}

const CMD = { metaKey: true };
const CTRL_SHIFT = { ctrlKey: true, shiftKey: true };

// ── the table ───────────────────────────────────────────────────────────────

test("every command's id is unique", () => {
  const ids = SHELL_COMMANDS.map((c) => c.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test("no two commands claim the same key", () => {
  const keys = SHELL_COMMANDS.map((c) => c.key);
  expect(new Set(keys).size).toBe(keys.length);
});

test("letters in the table are stored lowercase, so matching can normalise", () => {
  for (const command of SHELL_COMMANDS) {
    if (command.key.length === 1) expect(command.key).toBe(command.key.toLowerCase());
  }
});

test("the table covers every shortcut the task asks for", () => {
  const commands = new Set(SHELL_COMMANDS.map((c) => c.command));
  expect(commands).toEqual(
    new Set([
      "next-tab",
      "prev-tab",
      "jump-tab",
      "close-tab",
      "split",
      "focus-group-left",
      "focus-group-right",
      "focus-agent",
      "new-shell",
    ]),
  );
});

test("jump-tab is nine 1-based entries", () => {
  const jumps = SHELL_COMMANDS.filter((c) => c.command === "jump-tab");
  expect(jumps.map((c) => c.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  expect(jumps.map((c) => c.key)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
});

// ── the leader ──────────────────────────────────────────────────────────────

test("the leader is ⌘K on a Mac and ⌃⇧K elsewhere", () => {
  expect(isLeader(press("k", CMD), true)).toBe(true);
  expect(isLeader(press("k", CTRL_SHIFT), false)).toBe(true);
});

test("each platform's leader is not the other's", () => {
  expect(isLeader(press("k", CMD), false)).toBe(false);
  expect(isLeader(press("k", CTRL_SHIFT), true)).toBe(false);
});

test("a bare ⌃K is left alone off a Mac, because readline kills the line with it", () => {
  expect(isLeader(press("k", { ctrlKey: true }), false)).toBe(false);
});

test("⌘K is case-insensitive, so caps lock does not disarm the leader", () => {
  expect(isLeader(press("K", CMD), true)).toBe(true);
});

test("⌥ disqualifies the leader on both platforms", () => {
  expect(isLeader(press("k", { ...CMD, altKey: true }), true)).toBe(false);
  expect(isLeader(press("k", { ...CTRL_SHIFT, altKey: true }), false)).toBe(false);
});

test("an unmodified k is not the leader", () => {
  expect(isLeader(press("k"), true)).toBe(false);
  expect(isLeader(press("k"), false)).toBe(false);
});

test("⇧⌘K is not the Mac leader — Shift there is a different chord", () => {
  expect(isLeader(press("k", { metaKey: true, shiftKey: true }), true)).toBe(false);
});

// ── the second press ────────────────────────────────────────────────────────

test("the second press maps to its command", () => {
  expect(matchCommand(press("]"))?.command).toBe("next-tab");
  expect(matchCommand(press("["))?.command).toBe("prev-tab");
  expect(matchCommand(press("\\"))?.command).toBe("split");
  expect(matchCommand(press("w"))?.command).toBe("close-tab");
  expect(matchCommand(press("a"))?.command).toBe("focus-agent");
  expect(matchCommand(press("`"))?.command).toBe("new-shell");
  expect(matchCommand(press("ArrowLeft"))?.command).toBe("focus-group-left");
  expect(matchCommand(press("ArrowRight"))?.command).toBe("focus-group-right");
});

test("a digit jumps to that tab", () => {
  expect(matchCommand(press("3"))).toMatchObject({ command: "jump-tab", index: 3 });
});

test("the leader's modifier may still be held on the second press", () => {
  // Nobody releases ⌘ between the two presses of ⌘K ].
  expect(matchCommand(press("]", CMD))?.command).toBe("next-tab");
  expect(matchCommand(press("]", CTRL_SHIFT))?.command).toBe("next-tab");
});

test("Shift on the second press still matches, since ⇧ is how [ and ] are reached", () => {
  expect(matchCommand(press("W", { shiftKey: true }))?.command).toBe("close-tab");
});

test("⌥ on the second press matches nothing — that is the terminal's Meta", () => {
  expect(matchCommand(press("]", { altKey: true }))).toBeNull();
  expect(matchCommand(press("a", { altKey: true }))).toBeNull();
});

test("a key the table does not name matches nothing", () => {
  expect(matchCommand(press("z"))).toBeNull();
  expect(matchCommand(press("ArrowUp"))).toBeNull();
  expect(matchCommand(press("0"))).toBeNull();
});

// ── what the terminal must not swallow ──────────────────────────────────────

test("the terminal yields the leader", () => {
  expect(terminalMustYield(press("k", CMD), true)).toBe(true);
  expect(terminalMustYield(press("k", CTRL_SHIFT), false)).toBe(true);
});

test("the terminal yields ⌘G and ⇧⌘G, which the search bar hears after it", () => {
  expect(terminalMustYield(press("g", CMD), true)).toBe(true);
  expect(terminalMustYield(press("g", { metaKey: true, shiftKey: true }), true)).toBe(true);
  expect(terminalMustYield(press("g", { ctrlKey: true }), false)).toBe(true);
});

test("the terminal keeps ordinary typing, and the control keys a shell needs", () => {
  expect(terminalMustYield(press("k"), true)).toBe(false);
  expect(terminalMustYield(press("g"), true)).toBe(false);
  // ⌃K is kill-line and ⌃W delete-word: taking either would be the bug the
  // leader exists to avoid.
  expect(terminalMustYield(press("k", { ctrlKey: true }), true)).toBe(false);
  expect(terminalMustYield(press("w", { ctrlKey: true }), false)).toBe(false);
});

test("the terminal keeps the second press — the capture listener has taken it already", () => {
  expect(terminalMustYield(press("]", CMD), true)).toBe(false);
});

// ── display ─────────────────────────────────────────────────────────────────

test("the leader prints per platform", () => {
  expect(leaderCaps(true)).toEqual(["⌘", "K"]);
  expect(leaderCaps(false)).toEqual(["Ctrl", "⇧", "K"]);
});

test("a chord prints leader-first, with letters capitalised and arrows drawn", () => {
  const split = SHELL_COMMANDS.find((c) => c.id === "split")!;
  expect(chordCaps(split, true)).toEqual(["⌘", "K", "\\"]);

  const agent = SHELL_COMMANDS.find((c) => c.id === "focus-agent")!;
  expect(chordCaps(agent, true)).toEqual(["⌘", "K", "A"]);

  const left = SHELL_COMMANDS.find((c) => c.id === "focus-group-left")!;
  expect(chordCaps(left, false)).toEqual(["Ctrl", "⇧", "K", "←"]);
});

test("capsFor looks a chord up by id, and draws nothing for one that is gone", () => {
  expect(capsFor("new-shell", true)).toEqual(["⌘", "K", "`"]);
  expect(capsFor("no-such-command", true)).toEqual([]);
});
