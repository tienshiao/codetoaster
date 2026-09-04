/**
 * The shell's keyboard shortcuts, as one table (TASK-34 §10 Phase 6).
 *
 * ## Why a leader, and not the chords everyone else uses
 *
 * The obvious bindings are all spoken for. Chrome owns every conventional
 * next-tab chord on macOS — ⌘1‑9, ⌃Tab, ⌘⇧[ / ⌘⇧], ⌘⌥← / ⌘⌥→ — and all but
 * ⌘W / ⌘T / ⌘N / ⌘Q can be taken with `preventDefault`. Taking them is a real
 * option, and it is what VS Code for Web does; the cost is that the user loses
 * their browser's own tab keys for as long as this app has focus.
 *
 * Below that sits the agent, which is a terminal, and a terminal wants nearly
 * every bare Ctrl chord: ⌃F is forward-char, ⌃W is delete-word, ⌃K is
 * kill-line. So on anything but macOS the space left over is small.
 *
 * A leader takes nothing from either. `⌘K` on macOS, `⌃⇧K` elsewhere — ⌃⇧ is
 * how terminal emulators have always reserved their own commands, because at
 * the tty level ⌃⇧K is the same byte as ⌃K and the emulator has to claim it
 * before the shell sees it. After the leader the whole keyboard is free, which
 * is also why there is room for `⌘K 1`‑`9` without an argument about it.
 *
 * ## Why a table
 *
 * Every consumer reads this one list: the dispatcher runs the commands, the
 * terminal asks which keys it must not swallow, and TASK-35's palette will
 * list them. Before this, `Terminal.tsx` allowlisted escapes by hardcoding one
 * chord per `if` — a list inherited from v1 that still named ⌘⇧P's command
 * palette and ⌃`'s tab switcher, neither of which survived TASK-28. Adding a
 * shortcut should be an entry here and nothing else.
 */

import { isMac } from "@/frontend/utils/platform";

/** What the shortcut does, once the leader has been pressed. */
export type CommandId =
  | "next-tab"
  | "prev-tab"
  | "jump-tab"
  | "split"
  | "close-tab"
  | "focus-agent"
  | "focus-group-left"
  | "focus-group-right"
  | "new-shell";

/** Heading a palette or a cheat sheet can group by. */
export type CommandGroup = "Tabs" | "Groups" | "Task";

export interface ShellCommand {
  /** Unique across the table; `jump-tab` is distinguished by `index`. */
  id: string;
  command: CommandId;
  label: string;
  group: CommandGroup;
  /**
   * The key pressed after the leader, as `KeyboardEvent.key`. Letters are
   * stored lowercase and matched case-insensitively, so the chord still fires
   * with the leader's modifier — or Shift — still held down.
   */
  key: string;
  /** Which tab `jump-tab` means, 1-based. Absent for every other command. */
  index?: number;
}

/** `⌘K 1` … `⌘K 9`. Nine entries rather than one parameterised row, so the
 * table stays a flat list that a palette can render without a special case. */
const JUMP_COMMANDS: ShellCommand[] = Array.from({ length: 9 }, (_, i) => ({
  id: `jump-tab-${i + 1}`,
  command: "jump-tab" as const,
  label: `Go to tab ${i + 1}`,
  group: "Tabs" as const,
  key: String(i + 1),
  index: i + 1,
}));

export const SHELL_COMMANDS: ShellCommand[] = [
  { id: "next-tab", command: "next-tab", label: "Next tab", group: "Tabs", key: "]" },
  { id: "prev-tab", command: "prev-tab", label: "Previous tab", group: "Tabs", key: "[" },
  ...JUMP_COMMANDS,
  { id: "close-tab", command: "close-tab", label: "Close tab", group: "Tabs", key: "w" },
  { id: "split", command: "split", label: "Split tab", group: "Groups", key: "\\" },
  {
    id: "focus-group-left",
    command: "focus-group-left",
    label: "Focus group left",
    group: "Groups",
    key: "ArrowLeft",
  },
  {
    id: "focus-group-right",
    command: "focus-group-right",
    label: "Focus group right",
    group: "Groups",
    key: "ArrowRight",
  },
  { id: "focus-agent", command: "focus-agent", label: "Focus agent tab", group: "Task", key: "a" },
  { id: "new-shell", command: "new-shell", label: "New shell", group: "Task", key: "`" },
];

/** Enough of a `KeyboardEvent` to match a chord, so the table can be tested
 * without a DOM and callers can pass a React `KeyboardEvent` unchanged. */
export interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** Letters compare case-insensitively; `ArrowLeft` and `]` are already exact. */
function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

/**
 * True for the leader press itself: ⌘K on macOS, ⌃⇧K elsewhere.
 *
 * `mac` is a parameter rather than a call to `isMac()` inside, because that
 * reads `navigator.platform` and this module is covered by `bun test`, which
 * has no DOM. Callers in the app take the default.
 */
export function isLeader(ev: KeyLike, mac: boolean = isMac()): boolean {
  if (normalizeKey(ev.key) !== "k" || ev.altKey) return false;
  return mac
    ? ev.metaKey && !ev.ctrlKey && !ev.shiftKey
    : ev.ctrlKey && ev.shiftKey && !ev.metaKey;
}

/**
 * The command a press means, given the leader has already been pressed.
 *
 * The leader's own modifier is allowed to still be held: releasing ⌘ between
 * the two presses of `⌘K ]` is not something a hand does, and requiring it
 * would make the chord fire only for the slow. Shift is allowed for the same
 * reason — a hand on `⌘K [` often arrives via `{`. Alt is not, because ⌥ is
 * how a terminal sends Meta and a user pressing it means the pane, not the
 * shell.
 */
export function matchCommand(ev: KeyLike): ShellCommand | null {
  if (ev.altKey) return null;
  const key = normalizeKey(ev.key);
  return SHELL_COMMANDS.find((c) => c.key === key) ?? null;
}

/**
 * Chords the shell claims that are *not* part of the leader map, and whose
 * handlers run after the terminal's — so the terminal has to be told to let
 * them past rather than sending them to the PTY.
 *
 * Only search lives here: `TerminalSearchBar` listens on `document` in the
 * bubble phase, which is after xterm's own handler on the textarea. The leader
 * map needs no entry because its listener runs on `window` in the *capture*
 * phase and stops propagation, so those keys never reach xterm at all.
 */
function isSearchChord(ev: KeyLike): boolean {
  // ⌘G / ⇧⌘G — next and previous match, while the search bar is open.
  return normalizeKey(ev.key) === "g" && (ev.metaKey || ev.ctrlKey) && !ev.altKey;
}

/**
 * True when a key belongs to the shell and must not be written to the PTY.
 *
 * The leader is included even though the capture-phase listener should already
 * have eaten it. That listener is mounted by the shell and this one by the
 * pane, and if the two ever disagree — a pane rendered outside the shell, a
 * listener not yet bound on the first paint — the failure this way round is a
 * shortcut that does not fire. The other way round, a bare `k` is typed into
 * the agent.
 */
export function terminalMustYield(ev: KeyLike, mac: boolean = isMac()): boolean {
  return isLeader(ev, mac) || isSearchChord(ev);
}

// ── display ─────────────────────────────────────────────────────────────────

/** The leader's caps, for `KeyHint`. */
export function leaderCaps(mac: boolean = isMac()): string[] {
  return mac ? ["⌘", "K"] : ["Ctrl", "⇧", "K"];
}

/** How a key prints on a cap: `ArrowLeft` is an arrow, a letter is capitalised. */
function keyCap(key: string): string {
  if (key === "ArrowLeft") return "←";
  if (key === "ArrowRight") return "→";
  return key.length === 1 ? key.toUpperCase() : key;
}

/** The whole chord's caps, leader first — what `KeyHint` draws on a control. */
export function chordCaps(command: ShellCommand, mac: boolean = isMac()): string[] {
  return [...leaderCaps(mac), keyCap(command.key)];
}

/** Looks up one command's caps by id, for a control that knows what it does
 * but not which row of the table says so. Empty when the id is not in the
 * table, so a stale caller draws nothing rather than throwing. */
export function capsFor(id: string, mac: boolean = isMac()): string[] {
  const command = SHELL_COMMANDS.find((c) => c.id === id);
  return command ? chordCaps(command, mac) : [];
}
