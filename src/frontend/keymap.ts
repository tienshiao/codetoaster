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
 * One row is not behind the leader: the palette, `⌘P` / `⌃⇧P`. It is the
 * thing that *lists* the leader's chords, so a user who does not know the
 * leader could not reach it. See `direct` below.
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
  | "new-shell"
  | "palette";

export interface ShellCommand {
  /** Unique across the table; `jump-tab` is distinguished by `index`. */
  id: string;
  command: CommandId;
  label: string;
  /**
   * The key pressed after the leader, as `KeyboardEvent.key`. Letters are
   * stored lowercase and matched case-insensitively, so the chord still fires
   * with the leader's modifier — or Shift — still held down.
   */
  key: string;
  /** Which tab `jump-tab` means, 1-based. Absent for every other command. */
  index?: number;
  /**
   * Fires on its own chord — ⌘`key` on macOS, ⌃⇧`key` elsewhere — instead of
   * after the leader. Absent, and so false, for every other row.
   *
   * Only the palette is direct, and for two reasons. It is the most-used
   * command in the table, and it is the one that *lists* the leader chords: put
   * it behind the leader and the only way to find out the leader exists is to
   * already know it.
   *
   * The two platforms differ in whether Shift is in the chord, for the same
   * reason the leader does. On a Mac ⌘P is only the browser's print dialog,
   * which nobody wants of a terminal, and Chrome lets `preventDefault` take it
   * — so the chord is the one-modifier press. Elsewhere the bare ⌃P is
   * readline's previous-line and vim's insert-mode completion inside the
   * agent, so the palette sits on ⌃⇧P with the rest of the terminal-emulator
   * convention.
   */
  direct?: boolean;
}

/** `⌘K 1` … `⌘K 9`. Nine entries rather than one parameterised row, so the
 * table stays a flat list that a palette can render without a special case. */
const JUMP_COMMANDS: ShellCommand[] = Array.from({ length: 9 }, (_, i) => ({
  id: `jump-tab-${i + 1}`,
  command: "jump-tab" as const,
  label: `Go to tab ${i + 1}`,
  key: String(i + 1),
  index: i + 1,
}));

/**
 * The second press is typed with the leader's modifier still held (see
 * `matchCommand`), so every key here is also the chord ⌘`key` on a Mac and
 * ⌃⇧`key` elsewhere — and that chord must be one the browser lets a page
 * cancel. The header above names the four Chrome will not: ⌘W closed the whole
 * browser tab when Close tab was bound to `w`, and ⌘` is macOS's own
 * cycle-windows key, resolved before the page ever sees a keydown, so New
 * shell on a backtick left the user in another window with the leader still
 * armed. `x` and `s` are tmux's kill-pane and a shell's initial, and neither
 * ⌘X, ⌘S, ⌃⇧X nor ⌃⇧S is anything the browser keeps for itself.
 */
export const SHELL_COMMANDS: ShellCommand[] = [
  { id: "next-tab", command: "next-tab", label: "Next tab", key: "]" },
  { id: "prev-tab", command: "prev-tab", label: "Previous tab", key: "[" },
  ...JUMP_COMMANDS,
  { id: "close-tab", command: "close-tab", label: "Close tab", key: "x" },
  { id: "split", command: "split", label: "Split tab", key: "\\" },
  {
    id: "focus-group-left",
    command: "focus-group-left",
    label: "Focus group left",
    key: "ArrowLeft",
  },
  {
    id: "focus-group-right",
    command: "focus-group-right",
    label: "Focus group right",
    key: "ArrowRight",
  },
  { id: "focus-agent", command: "focus-agent", label: "Focus agent tab", key: "a" },
  { id: "new-shell", command: "new-shell", label: "New shell", key: "s" },
  { id: "palette", command: "palette", label: "Command palette", key: "p", direct: true },
];

/** Enough of a `KeyboardEvent` to match a chord, so the table can be tested
 * without a DOM and callers can pass a React `KeyboardEvent` unchanged. */
export interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  /** `KeyboardEvent.code` — the physical key, which is how a digit is told
   * apart from what Shift made of it. Optional so a test can press a key
   * without naming a keyboard. */
  code?: string;
}

/**
 * Shifted punctuation folded back onto the cap the table names.
 *
 * Off a Mac the leader is ⌃⇧K, and a hand that has not let go of ⇧ for the
 * second press sends `}` where the table says `]` — so on the platform whose
 * leader needs Shift, every punctuation chord would be the one that does not
 * work.
 *
 * The digit row is here for the same hand: ⌃⇧K then `1` arrives as `!`, and
 * without the fold all nine jump chords were dead on the one platform whose
 * leader needs Shift. This spelling is the US layout's; `normalizeKey` prefers
 * the physical key when the event carries one, which is layout-independent,
 * and this map is what stands in when it does not.
 */
const UNSHIFTED: Record<string, string> = {
  "}": "]",
  "{": "[",
  "|": "\\",
  "!": "1",
  "@": "2",
  "#": "3",
  $: "4",
  "%": "5",
  "^": "6",
  "&": "7",
  "*": "8",
  "(": "9",
  ")": "0",
};

/** Letters compare case-insensitively; `ArrowLeft` is already exact. A digit
 * is read off the physical key when there is one, so a held Shift — or a
 * layout whose digits need Shift in the first place — still means the number
 * printed on the cap. */
function normalizeKey(key: string, code?: string): string {
  const digit = code && /^Digit(\d)$/.exec(code);
  if (digit) return digit[1]!;
  if (key.length !== 1) return key;
  const lower = key.toLowerCase();
  return UNSHIFTED[lower] ?? lower;
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
 * reason, and matters more — the non-Mac leader *is* ⌃⇧K, so a held Shift is
 * the normal case there rather than the sloppy one. Alt is not, because ⌥ is
 * how a terminal sends Meta, and a user pressing it means the pane.
 *
 * Direct rows are skipped: their chord is their whole binding, so after the
 * leader a `p` is bound to nothing and gets cancelled like any other unbound
 * key. Letting it through would give one command two entrances and make the
 * leader quietly claim a letter that no cheat sheet lists after it.
 */
export function matchCommand(ev: KeyLike): ShellCommand | null {
  if (ev.altKey) return null;
  const key = normalizeKey(ev.key, ev.code);
  return SHELL_COMMANDS.find((c) => !c.direct && c.key === key) ?? null;
}

/**
 * The command a press means on its own, with no leader before it.
 *
 * The modifiers have to be exactly the platform's — ⌘ alone on a Mac, ⌃⇧
 * elsewhere — rather than merely present the way `matchCommand` tolerates
 * them. There is no armed leader here saying the keyboard belongs to the
 * shell, so anything extra under the chord is somebody else's: ⌥ is the
 * terminal's Meta, a ⌃ held under ⌘P is a chord this table does not own, and
 * ⌘⇧P on a Mac is left alone the same way rather than read as a sloppy ⌘P.
 *
 * With Shift down `ev.key` arrives as `P`, which `normalizeKey` folds back onto
 * the lowercase cap the table stores.
 */
export function matchDirect(ev: KeyLike, mac: boolean = isMac()): ShellCommand | null {
  const modifiers = mac
    ? ev.metaKey && !ev.shiftKey && !ev.ctrlKey && !ev.altKey
    : ev.ctrlKey && ev.shiftKey && !ev.metaKey && !ev.altKey;
  if (!modifiers) return null;
  const key = normalizeKey(ev.key);
  return SHELL_COMMANDS.find((c) => c.direct && c.key === key) ?? null;
}

/**
 * Chords the shell claims that are *not* part of the leader map, and whose
 * handlers run after the terminal's — so the terminal has to be told to let
 * them past rather than sending them to the PTY.
 *
 * Only search lives here: `TerminalSearchBar` listens on the document in the
 * bubble phase, which is after xterm's own handler on the textarea. The
 * leader map needs no entry because its listener runs on `window` in the
 * *capture* phase and stops propagation, so those keys never reach xterm at
 * all.
 *
 * Exported because the search bar binds with this same predicate: what the
 * terminal yields and what the bar acts on have to be one rule, or the chord is
 * let through by one and matched by neither. They had already drifted — the bar
 * tested a raw `e.key === "g"`, which with Shift held is `G`, so ⇧⌘G reached
 * nobody while the tooltip advertised it.
 *
 * Gated per platform like `isLeader`, because on a Mac a bare ⌃G is readline's
 * abort and belongs to the PTY — the module header above says a terminal wants
 * nearly every bare Ctrl chord.
 */
export function isSearchChord(ev: KeyLike, mac: boolean = isMac()): boolean {
  // ⌘G / ⇧⌘G — next and previous match, while the search bar is open.
  if (normalizeKey(ev.key) !== "g" || ev.altKey) return false;
  return mac ? ev.metaKey && !ev.ctrlKey : ev.ctrlKey && !ev.metaKey;
}

/**
 * ⌘F / Ctrl+F — opens search in the focused terminal.
 *
 * Handled by the terminal's own key handler rather than the leader map,
 * because it only means anything with a terminal focused; a ⌘F in a diff pane
 * stays the browser's. It is therefore not in `terminalMustYield` either — the
 * terminal does not yield this one, it *answers* it.
 *
 * Gated per platform like `isLeader`, because on a Mac a bare ⌃F is readline's
 * forward-char and belongs to the PTY — the module header above says a terminal
 * wants nearly every bare Ctrl chord.
 */
export function isSearchOpenChord(ev: KeyLike, mac: boolean = isMac()): boolean {
  if (normalizeKey(ev.key) !== "f" || ev.shiftKey || ev.altKey) return false;
  return mac ? ev.metaKey && !ev.ctrlKey : ev.ctrlKey && !ev.metaKey;
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
 *
 * A direct chord is here for the same disagreement, and the stray keystroke it
 * guards against is worse: ⌘P reaching xterm sends a bare `p` to whatever the
 * agent is running.
 *
 * The step chord is yielded only while this terminal's search bar is open
 * (`searchOpen`), because the bar is the only thing that would act on it. With
 * no bar mounted an unconditional yield swallowed the key for nobody — and off
 * a Mac the key is ⌃G, readline's abort and reverse-i-search's cancel, which
 * the PTY was waiting for.
 */
export function terminalMustYield(
  ev: KeyLike,
  mac: boolean = isMac(),
  searchOpen: boolean = false,
): boolean {
  return (
    isLeader(ev, mac) || matchDirect(ev, mac) !== null || (searchOpen && isSearchChord(ev, mac))
  );
}

// ── the leader state machine ────────────────────────────────────────────────

/**
 * How long the leader stays armed.
 *
 * VS Code waits indefinitely and says so in its status bar. There is nowhere
 * here that would say so, and an indefinite arm is a trap: a ⌘K the user has
 * forgotten about swallows their next keystroke, and in a pane where the next
 * keystroke goes to an agent that is a keystroke they have to notice missing.
 * Long enough to be a chord, short enough to forget safely.
 */
export const LEADER_TIMEOUT_MS = 3000;

export type KeymapResult =
  /** Not the shell's — the pane should have it. */
  | { kind: "idle" }
  /** The leader itself: eaten, and the next press means something. */
  | { kind: "armed" }
  /** Eaten, and this is what it meant. */
  | { kind: "command"; command: ShellCommand }
  /** Eaten because the leader was armed, but bound to nothing. */
  | { kind: "cancelled" };

/** Keydowns for a modifier alone. Pressing ⌘K and then reaching for Shift
 * raises one of these, and disarming on it would make every chord whose second
 * press needs Shift — `⌘K \`, on a keyboard where that is ⇧ of something —
 * impossible to type. */
function isModifierKey(key: string): boolean {
  return (
    key === "Shift" || key === "Meta" || key === "Control" || key === "Alt" || key === "CapsLock"
  );
}

/**
 * One keypress against the leader map: the whole of the dispatcher's logic,
 * as a function of the state and the event.
 *
 * `armedAt` is when the leader was pressed, or null. Returned rather than
 * mutated so the caller can hold it in a ref and the rules can be tested
 * without a keyboard.
 *
 * `modal` is true while a modal surface — a `Dialog`, the palette — is up.
 * The keyboard is the modal's then, and the leader does not arm: it consumes
 * every press after it, and the Escape a dialog listens for on the document
 * was arriving at a capture listener that had just been armed by a stray ⌘K
 * and stopping there, with the dialog still open. A standing arm is dropped
 * for the same reason. Direct chords still fire, because the palette is a
 * modal and its own chord is how it toggles closed.
 */
export function stepKeymap(
  armedAt: number | null,
  ev: KeyLike,
  now: number,
  mac: boolean = isMac(),
  modal: boolean = false,
): { armedAt: number | null; result: KeymapResult } {
  if (isModifierKey(ev.key)) return { armedAt, result: { kind: "idle" } };

  if (modal) {
    const direct = matchDirect(ev, mac);
    if (direct) return { armedAt: null, result: { kind: "command", command: direct } };
    return { armedAt: null, result: { kind: "idle" } };
  }

  const armed = armedAt !== null && now - armedAt <= LEADER_TIMEOUT_MS;

  if (armed) {
    // Escape cancels the chord rather than reaching the pane. A user who has
    // armed the leader by accident presses it meaning exactly that, and an
    // Escape that both cancelled and put vim into command mode would be one
    // keystroke doing two things.
    if (ev.key === "Escape") return { armedAt: null, result: { kind: "cancelled" } };

    // The leader again, before its own chord: re-arm rather than spend the arm
    // on a key that is in no row. A hand that hesitates types `⌘K ⌘K ]`, and
    // cancelling on the second press would leave the `]` unarmed — falling
    // through to the pane and typing a bracket into the agent, which is the one
    // thing the map exists to prevent.
    if (isLeader(ev, mac)) return { armedAt: now, result: { kind: "armed" } };

    // `matchDirect` is deliberately not consulted while armed: an armed leader
    // owns the keyboard, so ⌘K ⌘P is a cancelled chord rather than the
    // palette. A chord that meant one thing alone and the same thing mid-chord
    // would make the arm a state the user cannot see and cannot rely on.
    const command = matchCommand(ev);
    if (command) return { armedAt: null, result: { kind: "command", command } };

    // Bound to nothing, and still eaten: after a leader the keyboard belongs
    // to the map, and letting an unbound key fall through would type it into
    // the agent — a `q` that quits the pager the user was reading.
    return { armedAt: null, result: { kind: "cancelled" } };
  }

  // Not armed, or armed too long ago to still mean anything.
  //
  // The direct chords come first because they are not part of the map's state
  // at all: one fires and leaves the leader exactly as it found it, disarmed.
  const direct = matchDirect(ev, mac);
  if (direct) return { armedAt: null, result: { kind: "command", command: direct } };

  if (isLeader(ev, mac)) return { armedAt: now, result: { kind: "armed" } };
  return { armedAt: null, result: { kind: "idle" } };
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

/** The whole chord's caps, leader first — what `KeyHint` draws on a control.
 * A direct row prints its own modifiers instead, since there is no leader in
 * front of it to draw. */
export function chordCaps(command: ShellCommand, mac: boolean = isMac()): string[] {
  if (command.direct) return mac ? ["⌘", keyCap(command.key)] : ["Ctrl", "⇧", keyCap(command.key)];
  return [...leaderCaps(mac), keyCap(command.key)];
}

/** Caps as one tooltip string: `⌘K X`, `Ctrl+Shift+K X`, `⌘P`, `Ctrl+Shift+P`.
 * The leader's caps run together on a Mac and join with `+` elsewhere, which is
 * how each platform writes its own chords; the second press follows a space. */
function joinCaps(caps: string[], mac: boolean): string {
  const named = caps.map((cap) => (mac ? cap : cap === "⇧" ? "Shift" : cap));
  return mac ? named.join("") : named.join("+");
}

/**
 * The chord as one line of plain text, for a `title` tooltip — the shortcuts'
 * way in for a user who has not read a list of them.
 *
 * Spelt out rather than drawn as caps because a tooltip is a string and cannot
 * hold `KeyHint`'s markup — but spelt out *from* the caps, so the leader and the
 * direct modifiers have one spelling here rather than a second set of literals
 * to keep in step. Empty when the id is not in the table, so a caller appends
 * nothing rather than "(undefined)".
 */
export function chordHint(id: string, mac: boolean = isMac()): string {
  const command = SHELL_COMMANDS.find((c) => c.id === id);
  if (!command) return "";
  // A direct chord is one press, so its key joins the modifiers rather than
  // following them after the space that separates a leader from its second.
  if (command.direct) return joinCaps(chordCaps(command, mac), mac);
  return `${joinCaps(leaderCaps(mac), mac)} ${keyCap(command.key)}`;
}

/** The same chord as caps for `KeyHint` / the palette. Spelt out here rather
 * than in the table, because search is not a leader chord and has no row. */
export function searchCaps(mac: boolean = isMac()): string[] {
  return [mac ? "⌘" : "Ctrl", "F"];
}

/** The open-search chord as tooltip text: `⌘F` on a Mac, `Ctrl+F` elsewhere.
 * Joined the same way `chordHint` joins a direct chord's caps. */
export function searchHint(mac: boolean = isMac()): string {
  return joinCaps(searchCaps(mac), mac);
}

/** The step-match chord's caps: ⌘G / Ctrl+G, and ⌘⇧G / Ctrl+Shift+G for the
 * previous match. Modifier-first like `chordCaps`, so the bar's tooltips read
 * the way the palette's rows do. */
export function searchStepCaps(previous: boolean, mac: boolean = isMac()): string[] {
  return [mac ? "⌘" : "Ctrl", ...(previous ? ["⇧"] : []), "G"];
}

/** The step chord as tooltip text, joined the way `searchHint` joins its own. */
export function searchStepHint(previous: boolean, mac: boolean = isMac()): string {
  return joinCaps(searchStepCaps(previous, mac), mac);
}

/** Looks up one command's caps by id, for a control that knows what it does
 * but not which row of the table says so. Empty when the id is not in the
 * table, so a stale caller draws nothing rather than throwing. */
export function capsFor(id: string, mac: boolean = isMac()): string[] {
  const command = SHELL_COMMANDS.find((c) => c.id === id);
  return command ? chordCaps(command, mac) : [];
}
