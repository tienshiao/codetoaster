/**
 * Stop a client's xterm.js from answering the terminal queries the server
 * answers.
 *
 * Every byte a PTY writes streams to the headless terminal on the server and
 * to every attached client's xterm.js, and all of them parse it. When those
 * bytes are a question — Primary DA, "where is the cursor", DECRQM — every
 * parser answers, and every answer that gets written back into the PTY is one
 * the program reads as input. The server's headless terminal is the one that
 * holds the PTY's real state and is there before any tab attaches, so it is
 * the one that answers (`lib/xtmux/pty.ts`); this makes the client's copy
 * silent on exactly that set, so a PTY with two viewers reads one reply and
 * not three.
 *
 * The set is xterm.js's own: every request its `InputHandler` answers through
 * a data event, which the headless build shares. Colour queries (OSC 4, 10, 11,
 * 12) are deliberately not here: the browser answers those from its theme, and
 * the headless terminal has no theme to answer from. So for colour the old
 * shape stands — two viewers answer twice, and nobody attached answers not at
 * all — until the server has a theme to answer with. XTWINOPS reports are not
 * here either, because neither side gives them: every `windowOptions` flag is
 * off by default and nothing here turns one on.
 *
 * A list, and one xterm owns the other half of: a query xterm starts answering
 * in an upgrade is answered by the server and by every viewer until it is added
 * here. The test's control cases catch an entry leaving xterm's set, not one
 * joining it, so an xterm bump is the moment to re-read its `InputHandler`.
 *
 * Handlers registered on the parser run before the built-in one and, by
 * returning true, in its place. None of these built-ins does anything but
 * reply, so silencing them changes no state.
 */

import type { IDisposable, IParser } from "@xterm/xterm";

const swallow = () => true;

/** `IParser` is the same declaration in `@xterm/xterm` and `@xterm/headless`,
 * so the browser terminal and the headless one the test drives both fit; the
 * import is type-only, so no DOM-bound module is loaded under `bun test`. */
export function silenceTerminalQueries(term: { parser: IParser }): IDisposable {
  const { parser } = term;
  const registered = [
    // Primary DA: CSI c / CSI 0 c
    parser.registerCsiHandler({ final: "c" }, swallow),
    // Secondary DA: CSI > c
    parser.registerCsiHandler({ prefix: ">", final: "c" }, swallow),
    // DSR: CSI 5 n (status), CSI 6 n (cursor position)
    parser.registerCsiHandler({ final: "n" }, swallow),
    // DECDSR: CSI ? 6 n
    parser.registerCsiHandler({ prefix: "?", final: "n" }, swallow),
    // DECRQM, ANSI and DEC-private: CSI Ps $ p / CSI ? Ps $ p
    parser.registerCsiHandler({ intermediates: "$", final: "p" }, swallow),
    parser.registerCsiHandler({ prefix: "?", intermediates: "$", final: "p" }, swallow),
    // DECRQSS: DCS $ q Pt ST
    parser.registerDcsHandler({ intermediates: "$", final: "q" }, swallow),
  ];
  return {
    dispose() {
      for (const handler of registered) handler.dispose();
    },
  };
}
