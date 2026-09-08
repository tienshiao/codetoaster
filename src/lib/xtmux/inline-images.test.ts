import { afterEach, describe, expect, test } from "bun:test";
import { Terminal } from "@xterm/headless";
import { SerializeAddon } from "@xterm/addon-serialize";
import { image2sixel } from "sixel";
import { encodePng, readImageHeader } from "./image-codec";
import { CELL, InlineImages, PALETTE_LIMIT, box, iipSequence } from "./inline-images";

const COLS = 20;
const ROWS = 5;
const GRID = { cols: COLS, rows: ROWS };

const made: Terminal[] = [];
afterEach(() => {
  for (const term of made.splice(0)) term.dispose();
});

function terminal(opts: { scrollback?: number } = {}): Terminal {
  const term = new Terminal({ cols: COLS, rows: ROWS, scrollback: opts.scrollback ?? 50, allowProposedApi: true });
  made.push(term);
  return term;
}

function make(opts: { scrollback?: number; bytes?: number } = {}) {
  const term = terminal(opts);
  const addon = new SerializeAddon();
  term.loadAddon(addon);
  const replies: string[] = [];
  const images = new InlineImages(term, (r) => replies.push(r), opts.bytes ? { bytes: opts.bytes } : undefined);
  return { term, addon, replies, images };
}

// What a PTY does with its output: through the scanner, and the headless
// side into the terminal. Answers what the browsers were sent.
async function feed(t: { term: Terminal; images: InlineImages }, s: string): Promise<string> {
  const { headless, clients } = t.images.stream.push(s);
  await new Promise<void>((resolve) => t.term.write(headless, resolve));
  return clients;
}

function solid(width: number, height: number): Uint8Array {
  const px = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    px[i * 4] = 200;
    px[i * 4 + 3] = 255;
  }
  return px;
}

function sixel(width: number, height: number): string {
  return image2sixel(solid(width, height), width, height);
}

function png(width: number, height: number): Uint8Array {
  return encodePng(solid(width, height), width, height);
}

function iip(bytes: Uint8Array, fields = "inline=1"): string {
  return `\x1b]1337;File=${fields};size=${bytes.byteLength}:${Buffer.from(bytes).toString("base64")}\x07`;
}

function lines(term: Terminal): string[] {
  const buffer = term.buffer.active;
  const out: string[] = [];
  for (let i = 0; i < buffer.length; i++) out.push(buffer.getLine(i)!.translateToString(true));
  return out;
}

function cursor(term: Terminal) {
  const b = term.buffer.active;
  return { x: b.cursorX, y: b.cursorY, ybase: b.baseY };
}

describe("box", () => {
  test("a sixel is boxed to whole cells and padded into them", () => {
    const boxed = box({ kind: "sixel", params: [0], body: sixel(25, 45).slice(3, -2) }, 7, GRID)!;
    expect(boxed).toMatchObject({ id: 7, cols: 3, rows: 3 });
    const file = Buffer.from(boxed.base64, "base64");
    expect(file.byteLength).toBe(boxed.bytes);
    expect(readImageHeader(file)).toEqual({ mime: "image/png", width: 3 * CELL.width, height: 3 * CELL.height });
  });

  test("an inline file is boxed from its header and passed on as it came", () => {
    const file = png(15, 25);
    const body = `File=inline=1;size=${file.byteLength}:${Buffer.from(file).toString("base64")}`;
    const boxed = box({ kind: "iip", body }, 1, GRID)!;
    expect(boxed).toMatchObject({ cols: 2, rows: 2, bytes: file.byteLength });
    expect(Buffer.from(boxed.base64, "base64")).toEqual(Buffer.from(file));
  });

  test("a width asked for in cells is honoured and the height follows the picture", () => {
    const file = png(15, 25);
    const body = `File=inline=1;width=4:${Buffer.from(file).toString("base64")}`;
    // 4 cells wide is 40px, a scale of 40/15; 25px tall becomes 66.7px, 4 cells.
    expect(box({ kind: "iip", body }, 1, GRID)).toMatchObject({ cols: 4, rows: 4 });
  });

  test("a percentage is of the grid, pixels are canonical cells, and auto is the picture's own", () => {
    const file = png(15, 25);
    const body = (fields: string) => `File=inline=1;${fields}:${Buffer.from(file).toString("base64")}`;
    // Half of 20 columns; 25px tall at a scale of 100/15 is 167px, 9 cells.
    expect(box({ kind: "iip", body: body("width=50%") }, 1, GRID)).toMatchObject({ cols: 10, rows: 9 });
    // 25px is 3 cells of 10; 25px tall at 30/15 is 50px, 3 cells.
    expect(box({ kind: "iip", body: body("width=25px") }, 1, GRID)).toMatchObject({ cols: 3, rows: 3 });
    expect(box({ kind: "iip", body: body("width=auto;height=2") }, 1, GRID)).toMatchObject({ cols: 3, rows: 2 });
    // The addon refuses the whole header for a size it cannot read.
    expect(box({ kind: "iip", body: body("width=wide") }, 1, GRID)).toBeNull();
  });

  // Only the header is read for a file's size, so one is enough to stand in
  // for a picture too big to build.
  function pngHeader(width: number, height: number): string {
    const bytes = new Uint8Array(25);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(bytes.buffer).setUint32(16, width);
    new DataView(bytes.buffer).setUint32(20, height);
    return `File=inline=1:${Buffer.from(bytes).toString("base64")}`;
  }

  test("an image the viewer's addon would refuse is refused here, measured by its cell box", () => {
    expect(box({ kind: "iip", body: pngHeader(1000, 1000) }, 1, GRID)).toMatchObject({ cols: 100, rows: 50 });
    expect(box({ kind: "iip", body: pngHeader(4096, 4096) }, 1, GRID)).toBeNull();
    // Under the limit itself, but its box of 4100 by 4100 is not.
    expect(box({ kind: "iip", body: pngHeader(4095, 4095) }, 1, GRID)).toBeNull();
  });

  test("a file that is not inline, not an image, or not base64 is refused", () => {
    const file = png(2, 2);
    expect(box({ kind: "iip", body: `File=size=1:${Buffer.from(file).toString("base64")}` }, 1, GRID)).toBeNull();
    expect(box({ kind: "iip", body: "File=inline=1:aGVsbG8gd29ybGQ=" }, 1, GRID)).toBeNull();
    expect(box({ kind: "iip", body: "File=inline=1" }, 1, GRID)).toBeNull();
    expect(box({ kind: "sixel", params: [0], body: "" }, 1, GRID)).toBeNull();
  });
});

describe("placement", () => {
  test("the cursor ends on the image's last row at its starting column, as the addon leaves it", async () => {
    const t = make();
    await feed(t, "AB");
    const clients = await feed(t, sixel(25, 45));
    expect(clients).toStartWith("\x1b]1337;File=inline=1;size=");
    expect(clients).toContain(";width=3;height=3;preserveAspectRatio=0:");
    expect(cursor(t.term)).toEqual({ x: 2, y: 2, ybase: 0 });
    await feed(t, "C");
    expect(lines(t.term).slice(0, 3)).toEqual(["AB", "", "  C"]);
    expect(t.images.placed).toMatchObject([{ line: 0, col: 2, cols: 3, rows: 3, alternate: false }]);
  });

  test("an image at the bottom scrolls the buffer like text would", async () => {
    const t = make();
    await feed(t, "\r\n\r\n\r\n\r\nX");
    await feed(t, sixel(10, 60));
    expect(cursor(t.term)).toEqual({ x: 1, y: 4, ybase: 2 });
    expect(t.images.placed).toMatchObject([{ line: 4, col: 1, rows: 3 }]);
  });

  test("a one-row image moves the cursor nowhere", async () => {
    const t = make();
    await feed(t, "A");
    await feed(t, sixel(10, 10));
    expect(cursor(t.term)).toEqual({ x: 1, y: 0, ybase: 0 });
  });

  test("in sixel display mode the image sits at the top-left and the cursor stays", async () => {
    const t = make();
    await feed(t, "\r\n\r\nAB\x1b[?80h");
    await feed(t, sixel(10, 40));
    expect(cursor(t.term)).toEqual({ x: 2, y: 2, ybase: 0 });
    expect(t.images.placed).toMatchObject([{ line: 0, col: 0, rows: 2 }]);
    await feed(t, "\x1b[?80l");
    await feed(t, sixel(10, 40));
    expect(t.images.placed[1]).toMatchObject({ line: 2, col: 2 });
  });

  test("an image whose rows scroll out of the buffer is forgotten", async () => {
    const t = make({ scrollback: 3 });
    await feed(t, sixel(10, 20));
    expect(t.images.placed).toHaveLength(1);
    await feed(t, "\r\n".repeat(ROWS + 3));
    expect(t.images.placed).toHaveLength(0);
  });

  test("RIS and DECSTR drop everything", async () => {
    for (const reset of ["\x1bc", "\x1b[!p"]) {
      const t = make();
      await feed(t, sixel(10, 20));
      await feed(t, "\r\n\r\n\r\n\r\n\r\n\r\n" + sixel(10, 20));
      expect(t.images.placed).toHaveLength(2);
      await feed(t, reset);
      expect(t.images.placed).toHaveLength(0);
    }
  });

  test("a reset puts sixel scrolling back, as the addon's does", async () => {
    for (const reset of ["\x1bc", "\x1b[!p"]) {
      const t = make();
      await feed(t, "\x1b[?80h" + reset + "AB");
      await feed(t, sixel(10, 40));
      expect(t.images.placed).toMatchObject([{ line: 0, col: 2, rows: 2 }]);
      expect(cursor(t.term)).toEqual({ x: 2, y: 1, ybase: 0 });
    }
  });

  test("erase below and above take the cursor's row only from, or up to, its column", async () => {
    const t = make();
    await feed(t, sixel(10, 20) + "\x1b[6G");
    await feed(t, "\x1b[J");
    expect(t.images.placed).toHaveLength(1);
    await feed(t, "\x1b[1J");
    expect(t.images.placed).toHaveLength(0);
  });

  test("erasing the display drops the images under it, and only those", async () => {
    const t = make();
    await feed(t, sixel(10, 20));
    await feed(t, "\r\n".repeat(ROWS + 1) + sixel(10, 20));
    expect(t.images.placed.map((p) => p.line)).toEqual([0, ROWS + 1]);
    await feed(t, "\x1b[2J");
    expect(t.images.placed.map((p) => p.line)).toEqual([0]);
    await feed(t, "\x1b[3J");
    expect(t.images.placed).toEqual([]);
  });

  test("erase below and above are bounded by the cursor row", async () => {
    const t = make();
    await feed(t, sixel(10, 20) + "\r\n\r\n\r\n" + sixel(10, 20));
    expect(t.images.placed.map((p) => p.line)).toEqual([0, 3]);
    await feed(t, "\x1b[2;1H\x1b[J");
    expect(t.images.placed.map((p) => p.line)).toEqual([0]);
    await feed(t, "\x1b[1J");
    expect(t.images.placed).toEqual([]);
  });

  test("images on the alternate buffer go with it", async () => {
    const t = make();
    await feed(t, sixel(10, 20));
    await feed(t, "\x1b[?1049h" + sixel(10, 20));
    expect(t.images.placed.map((p) => p.alternate)).toEqual([false, true]);
    await feed(t, "\x1b[?1049l");
    expect(t.images.placed.map((p) => p.alternate)).toEqual([false]);
  });

  test("the byte cap evicts the oldest image first", async () => {
    const one = box({ kind: "sixel", params: [0], body: sixel(10, 20).slice(3, -2) }, 1, GRID)!;
    const t = make({ bytes: one.base64.length * 2 + 1 });
    await feed(t, sixel(10, 20) + "\r\n" + sixel(10, 20) + "\r\n" + sixel(10, 20));
    expect(t.images.placed.map((p) => p.line)).toEqual([1, 2]);
  });
});

describe("queries", () => {
  test("Primary DA advertises sixel; a parameter makes it not a request", async () => {
    const t = make();
    await feed(t, "\x1b[c\x1b[0c");
    expect(t.replies).toEqual(["\x1b[?62;4;9;22c", "\x1b[?62;4;9;22c"]);
    t.replies.length = 0;
    await feed(t, "\x1b[1c");
    expect(t.replies).toEqual([]);
  });

  test("XTSMGRAPHICS reports registers and the geometry the canonical cell gives", async () => {
    const t = make();
    await feed(t, "\x1b[?1;1;0S\x1b[?2;1;0S\x1b[?1;3;300S\x1b[?2;4;0S\x1b[?3;1;0S");
    expect(t.replies).toEqual([
      `\x1b[?1;0;${PALETTE_LIMIT}S`,
      `\x1b[?2;0;${COLS * CELL.width};${ROWS * CELL.height}S`,
      "\x1b[?1;0;300S",
      "\x1b[?2;0;4096;4096S",
      "\x1b[?3;1S",
    ]);
  });

  test("XTWINOPS reports pixel, cell and grid size, and nothing else", async () => {
    const t = make();
    await feed(t, "\x1b[14t\x1b[16t\x1b[18t\x1b[21t\x1b[8;30;100t");
    expect(t.replies).toEqual([
      `\x1b[4;${ROWS * CELL.height};${COLS * CELL.width}t`,
      `\x1b[6;${CELL.height};${CELL.width}t`,
      `\x1b[8;${ROWS};${COLS}t`,
    ]);
  });
});

describe("serialize", () => {
  // The browser's image addon, reduced to what it does to the grid: on an
  // OSC 1337 with a cell box, feed lines for all rows but the first and go
  // back to the starting column. Placements are recorded so a restore can be
  // compared image for image against the original.
  function viewer(): { term: Terminal; placed: Array<{ line: number; col: number; cols: number; rows: number }> } {
    const term = terminal();
    const placed: Array<{ line: number; col: number; cols: number; rows: number }> = [];
    term.parser.registerOscHandler(1337, (data) => {
      const cols = Number(/width=(\d+)/.exec(data)![1]);
      const rows = Number(/height=(\d+)/.exec(data)![1]);
      const core = (term as unknown as { _core: { buffer: { x: number; y: number; ybase: number }; _inputHandler: { lineFeed(): void } } })._core;
      const col = core.buffer.x;
      placed.push({ line: core.buffer.ybase + core.buffer.y, col, cols, rows });
      for (let r = 1; r < rows; r++) core._inputHandler.lineFeed();
      core.buffer.x = col;
      return true;
    });
    return { term, placed };
  }

  async function restore(t: ReturnType<typeof make>) {
    const v = viewer();
    await new Promise<void>((resolve) => v.term.write("\x1bc" + t.images.serialize(t.addon), resolve));
    return v;
  }

  function expectSameScreen(t: ReturnType<typeof make>, v: ReturnType<typeof viewer>) {
    expect(lines(v.term)).toEqual(lines(t.term));
    expect(cursor(v.term)).toEqual(cursor(t.term));
    expect(v.placed).toEqual(t.images.placed.map(({ line, col, cols, rows }) => ({ line, col, cols, rows })));
  }

  test("with no images it is the addon's own output", async () => {
    const t = make();
    await feed(t, "one\r\n\x1b[31mtwo\x1b[0m");
    expect(t.images.serialize(t.addon)).toBe(t.addon.serialize());
  });

  test("an image in the viewport comes back where it was, with the text around it", async () => {
    const t = make();
    await feed(t, "line1\r\nline2 " + sixel(25, 45) + "after\r\n\x1b[1mlast");
    const v = await restore(t);
    expectSameScreen(t, v);
    expect(lines(v.term).slice(0, 5)).toEqual(["line1", "line2 ", "", "      after", "last"]);
  });

  test("an image in scrollback comes back too", async () => {
    const t = make();
    await feed(t, "top " + sixel(10, 40) + "\r\n" + "x\r\n".repeat(ROWS + 2) + "bottom");
    expect(t.images.placed[0]!.line).toBeLessThan(cursor(t.term).ybase);
    expectSameScreen(t, await restore(t));
  });

  // The addon leaves the cursor at the column an image started in, so a
  // second image straight after the first shares its column and row.
  test("an image on the first line, one over another, and one on the last line", async () => {
    const t = make();
    await feed(t, sixel(10, 20) + sixel(10, 40) + "\r\n\r\n\r\ntail " + sixel(10, 20) + "end");
    expect(t.images.placed.map((p) => [p.line, p.col])).toEqual([
      [0, 0],
      [0, 0],
      [4, 5],
    ]);
    expectSameScreen(t, await restore(t));
  });

  test("an inline file from a program is placed and restored like a sixel", async () => {
    const t = make();
    const clients = await feed(t, "A" + iip(png(15, 25)) + "B");
    expect(clients).toBe("A" + iipSequence(t.images.placed[0]!) + "B");
    expect(t.images.placed).toMatchObject([{ line: 0, col: 1, cols: 2, rows: 2 }]);
    expect(cursor(t.term)).toEqual({ x: 2, y: 1, ybase: 0 });
    expectSameScreen(t, await restore(t));
  });

  test("attributes are carried across the splice", async () => {
    const t = make();
    await feed(t, "\x1b[32mgreen " + sixel(10, 40) + "still\x1b[0m plain");
    const v = await restore(t);
    expectSameScreen(t, v);
    const line = v.term.buffer.active.getLine(1)!;
    expect(line.getCell(6)!.getFgColor()).toBe(2);
    expect(line.getCell(12)!.getFgColor()).toBe(-1);
  });

  test("the alternate buffer is restored with its own images, and the modes follow", async () => {
    const t = make();
    await feed(t, "normal " + sixel(10, 20) + "\x1b[?1049h\x1b[H\x1b[?2004halt " + sixel(10, 40) + "!");
    const v = await restore(t);
    expect(v.term.buffer.active.type).toBe("alternate");
    expect(v.term.modes.bracketedPasteMode).toBe(true);
    expect(lines(v.term)).toEqual(lines(t.term));
    expect(cursor(v.term)).toEqual(cursor(t.term));
    expect(v.placed).toEqual([{ line: 0, col: 7, cols: 1, rows: 1 }, { line: 0, col: 4, cols: 1, rows: 2 }]);
  });

  test("an image taller than the screen is stepped over, and what follows lands where it was", async () => {
    const t = make();
    await feed(t, "top " + sixel(10, 20 * (ROWS + 2)) + "\r\nafter");
    expect(t.images.placed).toMatchObject([{ line: 0, col: 4, rows: ROWS + 2 }]);
    const v = await restore(t);
    expectSameScreen(t, v);
    expect(lines(v.term)[0]).toBe("top ");
    expect(lines(v.term)[ROWS + 2]).toBe("after");
  });

  test("leaving the alternate screen after a restore lands the cursor where the shell had it", async () => {
    const t = make();
    await feed(t, "one\r\ntwo\r\nthree " + sixel(10, 20) + "\x1b[?1049h\x1b[Halt");
    const v = await restore(t);
    await feed(t, "\x1b[?1049l");
    await new Promise<void>((resolve) => v.term.write("\x1b[?1049l", resolve));
    expect(cursor(v.term)).toEqual(cursor(t.term));
  });

  test("display mode is put back", async () => {
    const t = make();
    await feed(t, "\x1b[?80h");
    expect(t.images.serialize(t.addon)).toEndWith("\x1b[?80h");
  });

  test("the sequence a viewer gets names the box", () => {
    expect(iipSequence({ id: 1, cols: 3, rows: 2, base64: "QUJD", bytes: 3 })).toBe(
      "\x1b]1337;File=inline=1;size=3;width=3;height=2;preserveAspectRatio=0:QUJD\x1b\\",
    );
  });
});
