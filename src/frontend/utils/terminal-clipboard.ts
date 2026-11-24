/**
 * OSC 52 clipboard writes, from the PTY to the browser's clipboard.
 *
 * A program that does its own mouse selection (Claude Code does, with mouse
 * reporting on) copies by emitting `OSC 52 ; Pc ; base64(text) ST` and
 * trusting the terminal to put the text on the clipboard. xterm.js registers
 * nothing for OSC 52, so without this the sequence is parsed and dropped. A
 * program may also write the clipboard of the machine it runs on directly,
 * which helps only when that is the machine the browser runs on — never with a
 * remote daemon.
 *
 * Write only, on purpose. `@xterm/addon-clipboard` also answers the read form
 * (`Pd` of `?`) by typing the browser's clipboard back into the PTY, which
 * hands whatever the user last copied anywhere to any program that asks. It
 * would also be one more client answering a terminal query, the thing
 * `terminal-queries.ts` exists to stop. A read is swallowed here, unanswered.
 *
 * The selection parameter `Pc` is not consulted: a browser has one clipboard,
 * so `c`, `p`, `s` and the empty default all land there. An empty or
 * undecodable payload is ignored rather than taken as xterm's "clear", so a
 * malformed sequence never wipes what the user copied.
 */

import type { IDisposable, IParser } from "@xterm/xterm";

/** The text an OSC 52 payload asks to put on the clipboard, or null when it is
 * a read, empty, or not valid base64 of UTF-8. `data` is what the parser hands
 * an OSC 52 handler: everything after `52;`. */
export function parseOsc52Write(data: string): string | null {
  const separator = data.indexOf(";");
  if (separator < 0) return null;
  const payload = data.slice(separator + 1);
  if (payload === "" || payload === "?") return null;
  let binary: string;
  try {
    binary = atob(payload);
  } catch {
    return null;
  }
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Route OSC 52 writes to `write` and swallow everything else under OSC 52.
 * A write arriving while `accepts()` is false is swallowed too: every attached
 * terminal receives the sequence, including ones in hidden tabs, and only a
 * terminal the user is looking at should take the clipboard. The handler stays synchronous: returning the
 * clipboard promise would make the parser wait on it, stalling the terminal
 * behind a permission prompt. */
export function handleOsc52Clipboard(
  term: { parser: IParser },
  write: (text: string) => void,
  accepts: () => boolean = () => true,
): IDisposable {
  return term.parser.registerOscHandler(52, (data) => {
    const text = parseOsc52Write(data);
    if (text !== null && accepts()) write(text);
    return true;
  });
}

/** xterm's Option-click options for the current mouse tracking mode.
 *
 * While the program tracks the mouse, a plain drag is the program's, so on a
 * Mac Option-drag has to force a local selection (Shift-drag does elsewhere).
 * xterm then treats a short Option-click as its own as well, and with
 * `altClickMovesCursor` on it answers one by typing arrow keys into the PTY to
 * walk a shell cursor there — into a program that has no such cursor. So the
 * cursor move is off while tracking.
 *
 * With no tracking, the defaults stand: Option-click moves a shell's cursor
 * and Option-drag is a column selection, which forcing would take away. */
export function optionClickOptions(mouseTrackingMode: string): {
  macOptionClickForcesSelection: boolean;
  altClickMovesCursor: boolean;
} {
  const tracking = mouseTrackingMode !== "none";
  return { macOptionClickForcesSelection: tracking, altClickMovesCursor: !tracking };
}

/** The browser writer. `navigator.clipboard` exists only in a secure context
 * (HTTPS, or `localhost` — an SSH tunnel counts), and Chrome refuses a write
 * from an unfocused document, which is what every other viewer attached to the
 * same PTY is. Both fail quietly: there is nothing a terminal can do about
 * either, and an unhandled rejection per copy is noise. */
export function writeBrowserClipboard(text: string): void {
  if (typeof navigator === "undefined" || !navigator.clipboard) return;
  navigator.clipboard.writeText(text).catch(() => {});
}
