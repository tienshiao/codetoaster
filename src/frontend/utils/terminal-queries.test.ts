import { test, expect, describe, afterEach } from "bun:test";
import { Terminal } from "@xterm/headless";
import { silenceTerminalQueries } from "./terminal-queries";

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
  // flag is off by default. Pinned so that turning one on someday shows up
  // here as a query the server would then have to answer too.
  test("XTWINOPS grid size is not a query either side answers", async () => {
    expect(await repliesTo(terminal(), "\x1b[18t")).toEqual([]);
  });
});
