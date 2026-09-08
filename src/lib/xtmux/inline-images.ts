/**
 * Inline images on the server side of the terminal (TASK-98).
 *
 * The headless terminal in `pty.ts` is the authority on the grid and answers
 * the PTY's questions; a browser is the only thing that can paint pixels. An
 * image needs both: pixels on the viewer, and a cursor on the server that has
 * moved below it, so the prompt that follows lands on the same row everywhere.
 *
 * The split here is: `ImageStream` (image-stream.ts) lifts each sixel or
 * iTerm inline image out of the byte stream; `box` decodes it far enough to
 * know its size and fixes it into a whole number of cells against `CELL`, a
 * canonical cell size every viewer is told about through the geometry queries
 * a program asks before drawing. Every browser then gets the same image as an
 * OSC 1337 sequence with that cell box spelled out, so the image addon there
 * takes exactly `rows` rows whatever font the viewer uses. The headless
 * terminal gets a placeholder DCS instead, and its handler here does what the
 * addon does with the cursor: a line feed per row, back to the starting
 * column. Each placed image is remembered against a buffer marker, so
 * `serialize` can splice it back into the screen a reattaching client (or the
 * scrollback snapshot on disk) is restored from.
 *
 * The cursor emulation mirrors @xterm/addon-image 0.9.0's `ImageStorage.addImage`
 * — line feeds for all but the last row, then the origin column — through the
 * same internals it reaches for. An addon bump that changes its placement is
 * a change to `place` too.
 */

import { Decoder } from "sixel";
import type { IBuffer, IDisposable, IMarker, Terminal } from "@xterm/headless";
import type { SerializeAddon } from "@xterm/addon-serialize";
import { encodePng, readImageHeader } from "./image-codec";
import { IIP_SIZE_LIMIT, ImageStream, PIXEL_LIMIT, type Captured, type Substitute } from "./image-stream";

/** The cell, in pixels, that images are laid out against on the server and
 * reported to programs asking how big a cell is. A viewer's real cell is
 * whatever its font makes it; the addon scales the image into the cell box it
 * is given, so this only sets the resolution a program renders at. */
export const CELL = { width: 10, height: 20 } as const;

/** The grid an image is sized against: what a percentage is a percentage of. */
export interface Grid {
  cols: number;
  rows: number;
}

/** Colour registers a sixel may use; what XTSMGRAPHICS reports. */
export const PALETTE_LIMIT = 4096;
/** Base64 bytes of images one PTY keeps for restore, oldest evicted first. */
export const IMAGE_BYTES_LIMIT = 64 * 1024 * 1024;

export interface BoxedImage {
  id: number;
  /** Cells the image occupies. */
  cols: number;
  rows: number;
  /** The encoded file the viewer decodes, base64. */
  base64: string;
  /** Its decoded byte length, which the addon's IIP parser insists on. */
  bytes: number;
}

export interface PlacedImage extends BoxedImage {
  col: number;
  /** Absolute buffer line of the image's first row. */
  readonly line: number;
  alternate: boolean;
}

/** The private DCS the headless terminal is handed in an image's place:
 * `DCS ? <id> $ i ST`. Nothing else uses this identifier. */
const PLACEHOLDER = { prefix: "?", intermediates: "$", final: "i" } as const;
export function placeholder(id: number): string {
  return `\x1bP?${id}$i\x1b\\`;
}

/** What a viewer's image addon gets: an iTerm inline image sized in cells and
 * stretched to fill them exactly, so its row count is the server's. */
export function iipSequence(img: BoxedImage): string {
  return `\x1b]1337;File=inline=1;size=${img.bytes};width=${img.cols};height=${img.rows};preserveAspectRatio=0:${img.base64}\x1b\\`;
}

// One decoder for the process: decoding is synchronous, and its wasm instance
// is the expensive part. Created on first use so importing this module in a
// test that never sees a sixel pays nothing.
let decoder: Decoder | null = null;

/** Decode a captured sequence far enough to fix it into cells. Null when it
 * is not an image anyone could show.
 *
 * "Anyone" includes the viewer: its addon refuses an image over its pixel or
 * byte limit and, having refused it, moves its cursor nowhere — while the
 * placeholder here would already have moved the server's. So every limit the
 * addon applies is applied here first, to the same box it will see, and the
 * comparisons are the addon's own (`<` the pixel limit, `<=` the byte one). */
export function box(captured: Captured, id: number, grid: Grid): BoxedImage | null {
  return captured.kind === "sixel" ? boxSixel(captured.body, id) : boxIip(captured.body, id, grid);
}

function boxSixel(body: string, id: number): BoxedImage | null {
  decoder ??= new Decoder();
  try {
    // The introducer's P2 = 1 asks for unpainted pixels to stay transparent;
    // its other values want them in the background colour, which the server
    // does not know. Transparent shows the viewer's background through, which
    // is the same thing over cells nothing was written to, so P2 is ignored.
    decoder.init(0, undefined, PALETTE_LIMIT, true);
    decoder.decode(Buffer.from(body, "latin1"));
    const { width, height } = decoder;
    if (!width || !height) return null;
    const cols = Math.ceil(width / CELL.width);
    const rows = Math.ceil(height / CELL.height);
    // Pad to the cell box rather than let the addon stretch to it: the box
    // is what fixes the row count, and the padding is what keeps the picture
    // undistorted inside it. The box is also what the addon measures.
    const boxW = cols * CELL.width;
    const boxH = rows * CELL.height;
    if (boxW * boxH >= PIXEL_LIMIT) return null;
    // Read once: the getter re-aligns the decoder's bands on every call.
    const data = decoder.data32;
    const src = new Uint8Array(data.buffer, data.byteOffset, width * height * 4);
    const rgba = new Uint8Array(boxW * boxH * 4);
    for (let y = 0; y < height; y++) {
      rgba.set(src.subarray(y * width * 4, (y + 1) * width * 4), y * boxW * 4);
    }
    const png = encodePng(rgba, boxW, boxH);
    if (png.byteLength > IIP_SIZE_LIMIT) return null;
    return { id, cols, rows, base64: Buffer.from(png).toString("base64"), bytes: png.byteLength };
  } catch {
    return null;
  } finally {
    decoder.release();
  }
}

/** A `width=` or `height=` as iTerm defines it: cells, `Npx`, `N%` of the
 * grid, or `auto` (0, the picture's own). Undefined for a value the addon
 * would refuse the whole header for. */
function askedSize(value: string | undefined, cell: number, total: number): number | undefined {
  if (value === undefined || value === "auto") return 0;
  const m = /^(\d+)(px|%)?$/.exec(value);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (m[2] === "px") return Math.ceil(n / cell);
  if (m[2] === "%") return Math.ceil((total * n) / 100);
  return n;
}

function boxIip(body: string, id: number, grid: Grid): BoxedImage | null {
  // `File=k=v;k=v:<base64>`
  const colon = body.indexOf(":");
  if (colon === -1) return null;
  const fields = new Map<string, string>();
  for (const part of body.slice("File=".length, colon).split(";")) {
    const eq = part.indexOf("=");
    if (eq !== -1) fields.set(part.slice(0, eq), part.slice(eq + 1));
  }
  if (fields.get("inline") !== "1") return null;
  const base64 = body.slice(colon + 1);
  let bytes: Buffer;
  try {
    bytes = Buffer.from(base64, "base64");
  } catch {
    return null;
  }
  if (bytes.byteLength > IIP_SIZE_LIMIT) return null;
  const header = readImageHeader(bytes);
  if (!header || header.width * header.height >= PIXEL_LIMIT) return null;
  // A program may ask for a size; a missing side follows the picture's aspect.
  let cols = askedSize(fields.get("width"), CELL.width, grid.cols);
  let rows = askedSize(fields.get("height"), CELL.height, grid.rows);
  if (cols === undefined || rows === undefined) return null;
  if (!cols && !rows) {
    cols = Math.ceil(header.width / CELL.width);
    rows = Math.ceil(header.height / CELL.height);
  } else if (!rows) {
    rows = Math.max(1, Math.ceil((header.height * ((cols * CELL.width) / header.width)) / CELL.height));
  } else if (!cols) {
    cols = Math.max(1, Math.ceil((header.width * ((rows * CELL.height) / header.height)) / CELL.width));
  }
  if (cols * CELL.width * rows * CELL.height >= PIXEL_LIMIT) return null;
  return { id, cols, rows, base64: bytes.toString("base64"), bytes: bytes.byteLength };
}

// The internals the addon itself uses to move the cursor past an image.
interface Core {
  buffer: { x: number; y: number; ybase: number };
  _inputHandler: { lineFeed(): void };
}

// SerializeAddon's building blocks, which `serialize()` composes for the
// whole buffer. Splicing images in means composing them for ranges of it.
interface SerializeInternals {
  _serializeBufferByRange(terminal: Terminal, buffer: IBuffer, range: { start: number; end: number }, excludeFinalCursorPosition: boolean): string;
  _serializeModes(terminal: Terminal): string;
}

interface Record_ {
  image: BoxedImage;
  col: number;
  marker: IMarker | null;
  row: number;
  alternate: boolean;
}

/** The buffer line an image's first row is on now: its marker's, which
 * follows the line through the buffer, or the row it was placed at on the
 * alternate buffer, which has no markers and does not scroll off. */
function lineOf(r: Record_): number {
  return r.marker ? r.marker.line : r.row;
}

export class InlineImages implements IDisposable {
  readonly stream: ImageStream;
  private nextId = 1;
  private pending = new Map<number, BoxedImage>();
  private records: Record_[] = [];
  private bytes = 0;
  /** DECSET 80: images are displayed at the top-left and the cursor stays put. */
  private displayMode = false;
  private handlers: IDisposable[] = [];
  private disposed = false;

  constructor(
    private readonly terminal: Terminal,
    private readonly reply: (data: string) => void,
    private readonly limits = { bytes: IMAGE_BYTES_LIMIT },
  ) {
    this.stream = new ImageStream((captured) => this.substitute(captured));
    // xterm's public API wraps every custom `CSI t` handler in a check of
    // this option and swallows the request unless the report is enabled, so
    // the handler below never runs without these. The built-in that would
    // then answer 18 itself is outrun by ours.
    terminal.options.windowOptions = {
      ...terminal.options.windowOptions,
      getWinSizePixels: true,
      getCellSizePixels: true,
      getWinSizeChars: true,
    };
    const { parser } = terminal;
    this.handlers.push(
      parser.registerDcsHandler(PLACEHOLDER, (_data, params) => {
        const id = typeof params[0] === "number" ? params[0] : -1;
        const image = this.pending.get(id);
        // A placeholder the parser dropped (inside an aborted string, say)
        // leaves its image pending; anything older than the one that did
        // arrive is never coming.
        for (const key of this.pending.keys()) if (key <= id) this.pending.delete(key);
        if (image) this.place(image);
        return true;
      }),
      // Where the addon resets: RIS and DECSTR drop every image and put
      // sixel scrolling back to its default.
      parser.registerEscHandler({ final: "c" }, () => (this.reset(), false)),
      parser.registerCsiHandler({ intermediates: "!", final: "p" }, () => (this.reset(), false)),
      // Erase in display over an image's rows takes the image with it, as
      // writing over its cells does in the viewer.
      parser.registerCsiHandler({ final: "J" }, (params) => (this.erased(params), false)),
      parser.registerCsiHandler({ prefix: "?", final: "J" }, (params) => (this.erased(params), false)),
      parser.registerCsiHandler({ prefix: "?", final: "h" }, (params) => (this.mode(params, true), false)),
      parser.registerCsiHandler({ prefix: "?", final: "l" }, (params) => (this.mode(params, false), false)),
      // Primary DA, as the addon reports it: VT220, sixel, charsets, ANSI colour.
      parser.registerCsiHandler({ final: "c" }, (params) => {
        if ((params[0] ?? 0) !== 0) return false;
        this.reply("\x1b[?62;4;9;22c");
        return true;
      }),
      parser.registerCsiHandler({ prefix: "?", final: "S" }, (params) => (this.graphicsAttributes(params), true)),
      parser.registerCsiHandler({ final: "t" }, (params) => this.windowOps(params)),
      // Images on the alternate buffer are gone once it is: that is the
      // addon's rule, and markers do not track that buffer anyway.
      terminal.buffer.onBufferChange(() => this.drop((r) => r.alternate)),
    );
  }

  /** Images on the buffer that is currently active, in placement order. */
  get placed(): PlacedImage[] {
    return this.records.map((r) => ({
      ...r.image,
      col: r.col,
      alternate: r.alternate,
      get line() {
        return lineOf(r);
      },
    }));
  }

  private substitute(captured: Captured): Substitute | null {
    const image = box(captured, this.nextId++, { cols: this.terminal.cols, rows: this.terminal.rows });
    if (!image) return null;
    this.pending.set(image.id, image);
    return { headless: placeholder(image.id), clients: iipSequence(image) };
  }

  private place(image: BoxedImage): void {
    const core = (this.terminal as unknown as { _core: Core })._core;
    const { buffer } = core;
    const alternate = this.terminal.buffer.active.type === "alternate";
    let col: number;
    let marker: IMarker | null = null;
    let row: number;
    if (this.displayMode) {
      col = 0;
      row = buffer.ybase;
      marker = alternate ? null : (this.terminal.registerMarker(-buffer.y) ?? null);
    } else {
      col = buffer.x;
      row = buffer.ybase + buffer.y;
      marker = alternate ? null : (this.terminal.registerMarker(0) ?? null);
      for (let r = 1; r < image.rows; r++) core._inputHandler.lineFeed();
      buffer.x = col;
    }
    const record: Record_ = { image, col, marker, row, alternate };
    this.records.push(record);
    this.bytes += image.base64.length;
    marker?.onDispose(() => this.drop((r) => r === record));
    while (this.bytes > this.limits.bytes && this.records.length > 1) {
      const oldest = this.records[0]!;
      this.drop((r) => r === oldest);
    }
  }

  // Forget first, dispose after: disposing a marker fires its listener, which
  // is a drop of the same record, and that one must find it already gone.
  private drop(where: (r: Record_) => boolean): void {
    const kept: Record_[] = [];
    const victims: Record_[] = [];
    for (const r of this.records) (where(r) ? victims : kept).push(r);
    if (victims.length === 0) return;
    this.records = kept;
    for (const r of victims) {
      this.bytes -= r.image.base64.length;
      if (r.marker && !r.marker.isDisposed) r.marker.dispose();
    }
  }

  private reset(): void {
    this.drop(() => true);
    this.displayMode = false;
  }

  private erased(params: (number | number[])[]): void {
    const mode = typeof params[0] === "number" ? params[0] : 0;
    const { buffer } = (this.terminal as unknown as { _core: Core })._core;
    const alternate = this.terminal.buffer.active.type === "alternate";
    const top = buffer.ybase;
    const bottom = buffer.ybase + this.terminal.rows - 1;
    const cursor = buffer.ybase + buffer.y;
    let from: number;
    let to: number;
    switch (mode) {
      case 0: [from, to] = [cursor, bottom]; break;
      case 1: [from, to] = [top, cursor]; break;
      case 2: [from, to] = [top, bottom]; break;
      case 3: [from, to] = [0, top - 1]; break;
      default: return;
    }
    // Below (0) and above (1) take the cursor's own row only from, or up to,
    // the cursor's column; the other rows go whole. An image touching the
    // cursor's row alone survives in the viewer if it lies on the other side
    // of the cursor, so it survives here too.
    const wholeFrom = mode === 0 ? cursor + 1 : from;
    const wholeTo = mode === 1 ? cursor - 1 : to;
    const partFrom = mode === 0 ? buffer.x : 0;
    const partTo = mode === 1 ? buffer.x : this.terminal.cols - 1;
    this.drop((r) => {
      if (r.alternate !== alternate) return false;
      const first = lineOf(r);
      const last = first + r.image.rows - 1;
      if (last >= wholeFrom && first <= wholeTo) return true;
      if (mode > 1 || first > cursor || last < cursor) return false;
      return r.col <= partTo && r.col + r.image.cols - 1 >= partFrom;
    });
  }

  private mode(params: (number | number[])[], set: boolean): void {
    for (const p of params) if (p === 80) this.displayMode = set;
  }

  // XTSMGRAPHICS, as the addon answers it, with the canonical cell standing
  // in for the viewer's canvas.
  private graphicsAttributes(params: (number | number[])[]): void {
    const item = params[0];
    const action = params[1];
    if (params.length < 2 || typeof item !== "number") return;
    if (item === 1) {
      switch (action) {
        case 1:
        case 2:
        case 4:
          this.reply(`\x1b[?1;0;${PALETTE_LIMIT}S`);
          return;
        case 3: {
          const asked = params[2];
          this.reply(typeof asked === "number" && asked <= PALETTE_LIMIT ? `\x1b[?1;0;${asked}S` : "\x1b[?1;2S");
          return;
        }
        default:
          this.reply("\x1b[?1;2S");
          return;
      }
    }
    if (item === 2) {
      const side = Math.floor(Math.sqrt(PIXEL_LIMIT));
      if (action === 1) {
        const w = this.terminal.cols * CELL.width;
        const h = this.terminal.rows * CELL.height;
        this.reply(w * h < PIXEL_LIMIT ? `\x1b[?2;0;${w};${h}S` : `\x1b[?2;0;${side};${side}S`);
      } else if (action === 4) {
        this.reply(`\x1b[?2;0;${side};${side}S`);
      } else {
        this.reply("\x1b[?2;2S");
      }
      return;
    }
    this.reply(`\x1b[?${item};1S`);
  }

  // XTWINOPS reports a program sizes an image with. xterm.js answers none of
  // them unless a windowOptions flag is on, and none is; these three are the
  // ones about geometry, answered from the same cell the images are boxed to.
  private windowOps(params: (number | number[])[]): boolean {
    switch (params[0]) {
      case 14:
        this.reply(`\x1b[4;${this.terminal.rows * CELL.height};${this.terminal.cols * CELL.width}t`);
        return true;
      case 16:
        this.reply(`\x1b[6;${CELL.height};${CELL.width}t`);
        return true;
      case 18:
        this.reply(`\x1b[8;${this.terminal.rows};${this.terminal.cols}t`);
        return true;
      default:
        return false;
    }
  }

  /** The screen as `SerializeAddon.serialize()` gives it, with each image
   * written back in at its row.
   *
   * The addon can only put an image at the cursor, and the cursor cannot be
   * sent into scrollback, so an image is emitted at the moment the replay
   * reaches its row: the rows before it, a newline onto its row, its column,
   * the image — which the addon lays down and scrolls for — then back up to
   * the row it started on, and the replay continues over the rows it covers.
   * Cells under an image were never written on the server, so the serializer
   * steps over them with cursor-forward rather than spaces, and the tiles the
   * addon put there survive. Each range starts from default attributes, as
   * the serializer assumes, and ends at the terminal's current ones, as it
   * guarantees; the reset between them keeps both true. */
  serialize(addon: SerializeAddon): string {
    if (this.records.length === 0 && !this.displayMode) return addon.serialize();
    const internals = addon as unknown as Partial<SerializeInternals>;
    // These are the addon's private parts. Should a bump rename them, a
    // restore without its pictures is the right price; a restore that throws
    // strands the client attaching, and is not.
    if (typeof internals._serializeBufferByRange !== "function" || typeof internals._serializeModes !== "function") {
      return addon.serialize();
    }
    const term = this.terminal;
    const normal = term.buffer.normal;
    const alternate = term.buffer.active.type === "alternate";

    let out = this.splice(internals as SerializeInternals, normal, this.records.filter((r) => !r.alternate));
    if (alternate) {
      // Switching to the alternate screen saves the cursor, and leaving it
      // restores it; what is saved has to be where the shell left it, not
      // where the replay did.
      out += `\x1b[${normal.cursorY + 1};${normal.cursorX + 1}H`;
      out += "\x1b[?1049h\x1b[H";
      out += this.splice(internals as SerializeInternals, term.buffer.alternate, this.records.filter((r) => r.alternate));
    }
    const active = term.buffer.active;
    out += `\x1b[${active.cursorY + 1};${active.cursorX + 1}H`;
    out += internals._serializeModes(term);
    if (this.displayMode) out += "\x1b[?80h";
    return out;
  }

  private splice(internals: SerializeInternals, buffer: IBuffer, records: Record_[]): string {
    const end = buffer.length - 1;
    const images = records
      .map((r) => ({ r, line: lineOf(r) }))
      .filter(({ line }) => line >= 0 && line <= end)
      .sort((a, b) => a.line - b.line || a.r.image.id - b.r.image.id);
    // The serializer leaves out the empty rows at the end of a range when
    // the range starts within the last screenful, trusting its own final
    // cursor move to make up the difference. Here the row after a range is
    // an image's, reached by one newline, so every row has to be written,
    // empty or not. It decides by comparing the buffer's length with the
    // screen's height, and this view of the buffer is a screen taller.
    const screen = this.terminal.rows;
    const every: IBuffer = {
      get type() { return buffer.type; },
      get cursorY() { return buffer.cursorY; },
      get cursorX() { return buffer.cursorX; },
      get viewportY() { return buffer.viewportY; },
      get baseY() { return buffer.baseY; },
      get length() { return buffer.length + screen; },
      getLine: (y) => buffer.getLine(y),
      getNullCell: () => buffer.getNullCell(),
    };
    const range = (start: number, stop: number): string =>
      start > stop ? "" : "\x1b[0m" + internals._serializeBufferByRange(this.terminal, every, { start, end: stop }, true);
    let out = "";
    let cur = 0;
    for (const { r, line } of images) {
      // Inside the rows a taller image below has already stepped over.
      if (line < cur) continue;
      if (line > cur) out += range(cur, line - 1) + "\r\n";
      const image = `\x1b[0m\x1b[${r.col + 1}G${iipSequence(r.image)}`;
      if (r.image.rows > screen) {
        // The addon feeds a line per row, and the first rows scroll off the
        // top, where cursor-up cannot follow: it stops at the screen's edge
        // and every row after would land short by the difference. So write
        // the image's first row before it, carry on from its last row — the
        // one the cursor is on — and give up whatever sat beside the image
        // on the rows between.
        out += range(line, line) + "\r" + image + "\r";
        cur = line + r.image.rows - 1;
      } else {
        out += image;
        if (r.image.rows > 1) out += `\x1b[${r.image.rows - 1}A`;
        out += "\r";
        cur = line;
      }
    }
    return out + range(cur, end);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const h of this.handlers) h.dispose();
    this.records = [];
    this.pending.clear();
  }
}
