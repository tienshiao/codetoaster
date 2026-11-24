import { test, expect, describe, afterEach } from "bun:test";
import { Terminal } from "@xterm/headless";
import { handleOsc52Clipboard, optionClickOptions, parseOsc52Write } from "./terminal-clipboard";

// The headless build shares the browser's parser, so the handler is driven
// through the same OSC dispatch the client's xterm.js runs, minus a DOM.
const made: Terminal[] = [];
function terminal(): Terminal {
  const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
  made.push(term);
  return term;
}
afterEach(() => {
  for (const term of made.splice(0)) term.dispose();
});

function write(term: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => term.write(data, resolve));
}

/** base64 of the UTF-8 bytes, the way a program encodes an OSC 52 payload. */
function b64(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

describe("parseOsc52Write", () => {
  test("decodes the payload of a clipboard write", () => {
    expect(parseOsc52Write(`c;${b64("hello")}`)).toBe("hello");
  });

  test("decodes UTF-8, not Latin-1", () => {
    expect(parseOsc52Write(`c;${b64("naïve → ✓ 日本")}`)).toBe("naïve → ✓ 日本");
  });

  test.each(["", "p", "s", "pc", "s0"])("writes whatever the selection parameter (%p)", (pc) => {
    expect(parseOsc52Write(`${pc};${b64("x")}`)).toBe("x");
  });

  test.each([
    ["a read", "c;?"],
    ["an empty payload, xterm's clear", "c;"],
    ["no separator", "c"],
    ["invalid base64", "c;not base64!"],
    ["base64 of bytes that are not UTF-8", `c;${btoa("\xff\xfe")}`],
  ])("ignores %s", (_name, data) => {
    expect(parseOsc52Write(data)).toBeNull();
  });
});

describe("handleOsc52Clipboard", () => {
  test("hands an OSC 52 write to the writer, BEL or ST terminated", async () => {
    const term = terminal();
    const written: string[] = [];
    handleOsc52Clipboard(term, (text) => written.push(text));
    await write(term, `\x1b]52;c;${b64("one")}\x07`);
    await write(term, `\x1b]52;c;${b64("two")}\x1b\\`);
    expect(written).toEqual(["one", "two"]);
  });

  test("leaves the screen alone around the sequence", async () => {
    const term = terminal();
    handleOsc52Clipboard(term, () => {});
    await write(term, `a\x1b]52;c;${b64("copied")}\x07b`);
    expect(term.buffer.active.getLine(0)?.translateToString(true)).toBe("ab");
  });

  test("a read is not answered and nothing is written", async () => {
    const term = terminal();
    const written: string[] = [];
    const replies: string[] = [];
    handleOsc52Clipboard(term, (text) => written.push(text));
    term.onData((data) => replies.push(data));
    await write(term, "\x1b]52;c;?\x07");
    expect(written).toEqual([]);
    expect(replies).toEqual([]);
  });

  test("a malformed payload is dropped and the terminal keeps parsing", async () => {
    const term = terminal();
    const written: string[] = [];
    handleOsc52Clipboard(term, (text) => written.push(text));
    await write(term, `\x1b]52;c;@@@\x07ok\x1b]52;c;${b64("after")}\x07`);
    expect(written).toEqual(["after"]);
    expect(term.buffer.active.getLine(0)?.translateToString(true)).toBe("ok");
  });

  test("a write is swallowed while the terminal does not accept one", async () => {
    const term = terminal();
    const written: string[] = [];
    let accepting = false;
    handleOsc52Clipboard(term, (text) => written.push(text), () => accepting);
    await write(term, `\x1b]52;c;${b64("hidden")}\x07`);
    accepting = true;
    await write(term, `\x1b]52;c;${b64("shown")}\x07`);
    expect(written).toEqual(["shown"]);
  });

  test("disposing unregisters it", async () => {
    const term = terminal();
    const written: string[] = [];
    handleOsc52Clipboard(term, (text) => written.push(text)).dispose();
    await write(term, `\x1b]52;c;${b64("late")}\x07`);
    expect(written).toEqual([]);
  });
});

describe("optionClickOptions", () => {
  test.each(["x10", "vt200", "drag", "any"])(
    "while the program tracks the mouse (%p), Option forces a selection and never moves a cursor",
    (mode) => {
      expect(optionClickOptions(mode)).toEqual({
        macOptionClickForcesSelection: true,
        altClickMovesCursor: false,
      });
    },
  );

  test("with no tracking, xterm's defaults: column select and Option-click cursor moves", () => {
    expect(optionClickOptions("none")).toEqual({
      macOptionClickForcesSelection: false,
      altClickMovesCursor: true,
    });
  });
});
