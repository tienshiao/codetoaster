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
 * a data event, which the headless build shares. XTSMGRAPHICS is the one entry
 * xterm itself never answers — an addon does, the image addon, which reports
 * the largest image it would accept in pixels derived from the browser's
 * rendered cell size. The server answers it instead, from the canonical cell
 * size it lays every image out with, so a program sizing an image asks one
 * terminal and gets the dimensions the image will actually be given.
 * Colour queries (OSC 4, 10, 11,
 * 12) are deliberately not here: the browser answers those from its theme, and
 * the headless terminal has no theme to answer from. So for colour the old
 * shape stands — two viewers answer twice, and nobody attached answers not at
 * all — until the server has a theme to answer with. XTWINOPS 14, 16 and 18 are
 * not here either, and for a different reason again: the server answers them
 * from the canonical cell it boxes images with (`lib/xtmux/inline-images.ts`),
 * and the browser stays silent without a handler because every `windowOptions`
 * flag is off unless something turns one on. The image addon is exactly that
 * something, which is why `IMAGE_ADDON_OPTIONS` below loads it with
 * `enableSizeReports: false`.
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
import { IIP_SIZE_LIMIT, PIXEL_LIMIT } from "../../lib/xtmux/image-stream";

/** How the image addon is loaded on every viewer. It lives beside the silencer
 * because one of its options is part of the same bargain — who answers a
 * terminal query — and because the test can then pin the configuration the app
 * actually runs with. */
export const IMAGE_ADDON_OPTIONS = {
  // The addon otherwise turns the browser's XTWINOPS 14/16/18 reports on; the
  // server answers those from the cell it boxes images with, and a second
  // answer is read by the program as keystrokes.
  enableSizeReports: false,
  // Sixel stays off: a raw sixel never reaches this terminal. The server
  // decodes every image out of the PTY's output and re-emits it as an IIP
  // sequence carrying an explicit cell box, so the server's grid and every
  // viewer agree on how many rows the image occupies — a viewer decoding sixel
  // itself would size it from its own font instead, and the grids would drift.
  sixelSupport: false,
  iipSupport: true,
  storageLimit: 32,
  // The server refuses what these refuse, so a viewer never drops an image
  // whose rows the server already counted. The pixel check the addon applies to
  // the *resized* box uses the viewer's own cell, which may be up to about
  // twice the server's 10x20 canonical cell in each direction, hence the
  // headroom.
  pixelLimit: PIXEL_LIMIT * 4,
  iipSizeLimit: IIP_SIZE_LIMIT,
} as const;

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
    // XTSMGRAPHICS: CSI ? Pi ; Pa ; Pv S — answered by the image addon, not xterm
    parser.registerCsiHandler({ prefix: "?", final: "S" }, swallow),
    // DECRQSS: DCS $ q Pt ST
    parser.registerDcsHandler({ intermediates: "$", final: "q" }, swallow),
  ];
  return {
    dispose() {
      for (const handler of registered) handler.dispose();
    },
  };
}
