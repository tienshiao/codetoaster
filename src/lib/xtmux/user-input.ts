// Whether an `input` message is a person, or the terminal talking by itself.
//
// xterm.js writes to the PTY through the same `onData` a keystroke does, and a
// good deal of what it writes nobody typed: focus reports (`ESC [ I` and
// `ESC [ O`, once the program enables DECSET 1004 — Claude Code does), answers
// to OSC 10/11/12 colour queries, cursor-position and device-attribute
// replies, window reports, mouse reports. Counted as the user being here, a
// blur — clicking another task — would wake the task being left (TASK-116).
//
// So the well-formed control sequences are read one by one, and what is left
// decides. Any character outside a sequence is a person — printable text,
// Enter, Tab, Backspace, Ctrl-C and the rest of C0. So are the sequences keys
// send, which someone answering a permission prompt is plainly present for:
// Escape (a bare ESC, which interrupts), Shift+Tab (`ESC [ Z`, the mode
// toggle), the arrows, Home and End, the `~` keys (Insert, Delete, PgUp, PgDn,
// F5 and up, and the bracketed-paste markers around a paste), modified F1, F2
// and F4 (`CSI_KEY_FINALS` says why not F3), keypad Begin, kitty-protocol
// keys, and the SS3 keys (application-mode arrows, F1–F4). A key's CSI has no private marker and
// numeric parameters only — a modifier, at most — which is what tells
// `ESC [ 1 ; 5 A` (Ctrl+Up) from `ESC [ 12 ; 40 R` (a cursor report) or
// `ESC [ ? 62 ; c` (a device-attributes reply). Everything else — focus, mouse,
// reports and replies, and every OSC, DCS, APC and PM string — is the
// terminal, and is skipped. Alt+key is ESC followed by the key, and the key
// survives. A sequence that is cut short is not well-formed: its ESC is read
// as the Escape key, erring toward a wake rather than a missed one.
//
// Import-free, so anything can use it.

const ESC = "\x1b";
const BEL = "\x07";

/** CSI finals a key sends: arrows, Home/End, Shift+Tab, the `~` keys,
 * modified F1/F2/F4 (`ESC [ 1 ; 2 P`), keypad Begin (`E`) and the kitty
 * keyboard protocol's `u` keys. The replies that share a final — XTSMGRAPHICS
 * `S`, the kitty flags report `u` — lead with `?` and are turned away by the
 * parameter check.
 *
 * Not `R`, though a modified F3 sends `ESC [ 1 ; 2 R`: that is byte for byte a
 * cursor-position report with row 1, and a report must never wake a task. A
 * modified F3 going uncounted is the cheaper mistake. */
const CSI_KEY_FINALS = new Set(["A", "B", "C", "D", "H", "F", "Z", "~", "P", "Q", "S", "E", "u"]);
/** SS3 finals a key sends: application-mode arrows, Home/End, F1–F4. */
const SS3_KEY_FINALS = new Set(["A", "B", "C", "D", "H", "F", "P", "Q", "R", "S"]);

/** True when `data` carries something a person typed. */
export function isUserInput(data: string): boolean {
  let i = 0;
  while (i < data.length) {
    if (data[i] !== ESC) return true;
    const seq = sequenceAt(data, i);
    // A bare ESC — the Escape key, or the head of a sequence that never
    // completed — is a person.
    if (!seq || seq.key) return true;
    i = seq.end;
  }
  return false;
}

/** The well-formed sequence starting at `data[start]` (an ESC): the index just
 * past it, and whether a key sends it. Undefined when there is none. */
function sequenceAt(data: string, start: number): { end: number; key: boolean } | undefined {
  switch (data[start + 1]) {
    case "[":
      return csiAt(data, start + 2);
    case "]": {
      const end = stringEnd(data, start + 2, true);
      return end === undefined ? undefined : { end, key: false };
    }
    case "P":
    case "_":
    case "^": {
      const end = stringEnd(data, start + 2, false);
      return end === undefined ? undefined : { end, key: false };
    }
    case "O": {
      // SS3: one character after it.
      const final = data[start + 2];
      if (final === undefined) return undefined;
      return { end: start + 3, key: SS3_KEY_FINALS.has(final) };
    }
    default:
      return undefined;
  }
}

/** CSI: parameter bytes `0`..`?`, intermediates ` `..`/`, a final `@`..`~`. */
function csiAt(data: string, from: number): { end: number; key: boolean } | undefined {
  let i = from;
  while (i < data.length && inRange(data, i, 0x30, 0x3f)) i++;
  const paramsEnd = i;
  while (i < data.length && inRange(data, i, 0x20, 0x2f)) i++;
  if (i >= data.length || !inRange(data, i, 0x40, 0x7e)) return undefined;
  const final = data[i]!;
  // The X10/normal mouse report is the one CSI with raw bytes after its final:
  // `ESC [ M` and then button, column and row, each a single character that
  // may well be printable. Only a bare `M` is one — `ESC [ 2 M` is not.
  if (i === from && final === "M") {
    return i + 3 < data.length ? { end: i + 4, key: false } : undefined;
  }
  // Digits and `;` only, which leaves out the private markers (`?`, `<`, `>`,
  // `=`) that replies and mouse reports lead with, and no intermediates.
  const key = i === paramsEnd
    && /^[0-9;]*$/.test(data.slice(from, paramsEnd))
    && CSI_KEY_FINALS.has(final);
  return { end: i + 1, key };
}

/** OSC, DCS, APC, PM: everything up to ST (`ESC \`), or BEL for an OSC. */
function stringEnd(data: string, from: number, belEnds: boolean): number | undefined {
  for (let i = from; i < data.length; i++) {
    if (belEnds && data[i] === BEL) return i + 1;
    if (data[i] === ESC) return data[i + 1] === "\\" ? i + 2 : undefined;
  }
  return undefined;
}

function inRange(data: string, i: number, lo: number, hi: number): boolean {
  const c = data.charCodeAt(i);
  return c >= lo && c <= hi;
}
