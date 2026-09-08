import { test, expect, describe, afterEach } from "bun:test";
import { Terminal } from "@xterm/headless";
import { ImageAddon } from "@xterm/addon-image";
import { IMAGE_ADDON_OPTIONS, silenceTerminalQueries } from "./terminal-queries";

// The headless build shares the browser's InputHandler, so what it answers is
// what a client's xterm.js answers — and what the server now answers for it.
// Driving the helper against it is the same parser the client has, minus a DOM.
const made: Terminal[] = [];
function terminal(): Terminal {
  const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
  made.push(term);
  return term;
}
afterEach(() => {
  for (const term of made.splice(0)) term.dispose();
});

async function repliesTo(term: Terminal, sequence: string): Promise<string[]> {
  const replies: string[] = [];
  const listener = term.onData((data) => replies.push(data));
  await new Promise<void>((resolve) => term.write(sequence, resolve));
  listener.dispose();
  return replies;
}

const QUERIES: Array<[name: string, sequence: string]> = [
  ["Primary DA", "\x1b[c"],
  ["Primary DA with the explicit 0", "\x1b[0c"],
  ["Secondary DA", "\x1b[>c"],
  ["DSR status", "\x1b[5n"],
  ["DSR cursor position", "\x1b[6n"],
  ["DECDSR cursor position", "\x1b[?6n"],
  ["DECRQM (ANSI)", "\x1b[4$p"],
  ["DECRQM (DEC private)", "\x1b[?2004$p"],
  ["DECRQSS", "\x1bP$qr\x1b\\"],
];

describe("silenceTerminalQueries", () => {
  // The control: without the helper, each of these is a question xterm.js
  // answers. If one stops being answered upstream it has no business in the
  // silenced set, and this is what says so.
  test.each(QUERIES)("%s is answered by a plain terminal", async (_name, sequence) => {
    expect(await repliesTo(terminal(), sequence)).not.toEqual([]);
  });

  test.each(QUERIES)("%s is silent with the helper installed", async (_name, sequence) => {
    const term = terminal();
    silenceTerminalQueries(term);
    expect(await repliesTo(term, sequence)).toEqual([]);
  });

  test("disposing puts the answers back", async () => {
    const term = terminal();
    silenceTerminalQueries(term).dispose();
    expect(await repliesTo(term, "\x1b[c")).toEqual(["\x1b[?1;2c"]);
  });

  // Anything the built-in only reports on is safe to swallow; the mode set
  // and the grid it reports on are unchanged by asking. Bracketed paste is
  // the one fish and every modern shell turn on, so it is the one to check.
  test("swallowing DECRQM does not disturb the mode it asks about", async () => {
    const term = terminal();
    silenceTerminalQueries(term);
    await repliesTo(term, "\x1b[?2004h\x1b[?2004$p");
    expect(term.modes.bracketedPasteMode).toBe(true);
  });

  // Not answered by a plain terminal, so not in the set: every windowOptions
  // flag is off by default here. The server answers 14, 16 and 18 from the
  // cell it lays images out with (lib/xtmux/inline-images.ts); pinned so
  // that turning a flag on in the browser someday shows up here as a second
  // answer.
  test("XTWINOPS grid size is not a query the browser answers", async () => {
    expect(await repliesTo(terminal(), "\x1b[18t")).toEqual([]);
  });
});

// XTSMGRAPHICS is the one silenced query xterm does not answer itself, so it
// has no business in QUERIES: that table's control case asserts a *plain*
// terminal replies, and a plain one ignores this. The thing that answers is the
// image addon, which is also the reason the client loads the addon first and
// the silencer second — newest-first parser dispatch is what puts the silencer
// in front of it. So the control case here is the addon, and both halves of
// that ordering are worth pinning.
describe("silenceTerminalQueries over the image addon", () => {
  // The addon's `activate` only registers parser handlers and hooks the render
  // event, so it runs headless — but `onRender` is a browser-terminal method
  // the headless build does not have, and reaching it throws mid-activate.
  // Standing in a no-op subscription is enough to let activate finish; nothing
  // here renders an image, only asks the addon what size it would take.
  function withImageAddon(options: ConstructorParameters<typeof ImageAddon>[0] = IMAGE_ADDON_OPTIONS): Terminal {
    const term = terminal();
    (term as unknown as { onRender: () => { dispose(): void } }).onRender = () => ({
      dispose() {},
    });
    term.loadAddon(new ImageAddon(options) as Parameters<Terminal["loadAddon"]>[0]);
    return term;
  }

  test("XTSMGRAPHICS is answered by the image addon", async () => {
    const [reply] = await repliesTo(withImageAddon(), "\x1b[?2;1;0S");
    expect(reply).toStartWith("\x1b[?2;0;");
  });

  test("XTSMGRAPHICS is silent with the helper installed after the addon", async () => {
    const term = withImageAddon();
    silenceTerminalQueries(term);
    expect(await repliesTo(term, "\x1b[?2;1;0S")).toEqual([]);
  });

  // The addon's other reply channel, and the one no handler silences: with
  // `enableSizeReports` on it sets the `windowOptions` flags for XTWINOPS
  // 14/16/18, which the server already answers. So the options the app loads
  // the addon with are pinned here rather than the addon's defaults.
  test.each(["\x1b[14t", "\x1b[16t", "\x1b[18t"])(
    "%p is not a query the browser answers with the image addon loaded",
    async (query) => {
      expect(await repliesTo(withImageAddon(), query)).toEqual([]);
    },
  );

  // The control: the flag is what keeps them quiet, not the headless build. 14
  // and 16 need a renderer to have a pixel size to report, so only 18 — the
  // grid in cells — can be pinned from here.
  test("XTWINOPS is answered once enableSizeReports is on", async () => {
    const term = withImageAddon({ ...IMAGE_ADDON_OPTIONS, enableSizeReports: true });
    const [reply] = await repliesTo(term, "\x1b[18t");
    expect(reply).toStartWith("\x1b[8;");
  });
});
