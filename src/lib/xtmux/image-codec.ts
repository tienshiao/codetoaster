// PNG writing and container-header sniffing, kept free of image libraries: the
// only thing needed here is "raw pixels out of a terminal graphics protocol,
// into a file a browser will render", plus enough of a reader to size an image
// a program handed us already encoded. The two genuinely hard parts are already
// in the runtime: node:zlib deflates, and `Bun.hash.crc32` is the standard
// reflected CRC-32 every PNG chunk is stamped with.

import { deflateSync } from "node:zlib";

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// length (BE u32) + type + data + CRC over type and data.
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, Bun.hash.crc32(out.subarray(4, 8 + data.length)), false);
  return out;
}

/** 8-bit RGBA pixels, row-major, `width * height * 4` bytes, to a PNG. */
export function encodePng(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const expected = width * height * 4;
  if (rgba.length !== expected) {
    throw new Error(`encodePng: expected ${expected} bytes for ${width}x${height}, got ${rgba.length}`);
  }

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour with alpha
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // non-interlaced

  // Every scanline gets filter type 0 (None). Filtering only buys compression
  // ratio, and these images are terminal-sized, so the simplest encoder wins.
  const stride = width * 4;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }

  // node:zlib, not `Bun.deflateSync`: that one emits raw deflate, with no zlib
  // header or adler32, and PNG's IDAT is a zlib stream. The Buffer it returns
  // is already a Uint8Array, so nothing needs copying.
  const idat = deflateSync(raw);
  const parts = [PNG_SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))];

  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}

export type ImageHeader = { mime: "image/png" | "image/gif" | "image/jpeg"; width: number; height: number };

function startsWith(bytes: Uint8Array, prefix: ArrayLike<number>): boolean {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (bytes[i] !== prefix[i]) return false;
  return true;
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  if (bytes.length < start + length) return "";
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

// SOF0..SOF15 minus the marker numbers reused for DHT (C4), JPG (C8) and DAC
// (CC). All of the rest carry the same frame header shape, so a progressive or
// arithmetic-coded JPEG sizes exactly like a baseline one.
const SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function readJpeg(bytes: Uint8Array): ImageHeader | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 2;
  while (pos + 1 < bytes.length) {
    // A marker may be preceded by any number of fill bytes, all 0xFF.
    if (bytes[pos] !== 0xff) return null;
    while (pos < bytes.length && bytes[pos] === 0xff) pos++;
    if (pos >= bytes.length) return null;

    const marker = bytes[pos]!;
    pos++;
    // Standalone markers: SOI, EOI, TEM and the restart markers carry no payload.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9) return null;

    if (pos + 2 > bytes.length) return null;
    const length = view.getUint16(pos, false);
    if (length < 2 || pos + length > bytes.length) return null;

    if (SOF_MARKERS.has(marker)) {
      if (length < 7) return null;
      return { mime: "image/jpeg", width: view.getUint16(pos + 5, false), height: view.getUint16(pos + 3, false) };
    }
    pos += length;
  }
  return null;
}

/** Pixel dimensions read from the container header alone, or null if the bytes are not a PNG, GIF or JPEG. */
export function readImageHeader(bytes: Uint8Array): ImageHeader | null {
  // Callers feed this whatever a program wrote to a PTY, so garbage in is the
  // normal case: every path returns null rather than throwing.
  let header: ImageHeader | null = null;
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    if (startsWith(bytes, PNG_SIGNATURE)) {
      // Signature, then the IHDR chunk header; width and height are the first
      // two fields of its data.
      if (bytes.length < 24) return null;
      header = { mime: "image/png", width: view.getUint32(16, false), height: view.getUint32(20, false) };
    } else if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") {
      if (bytes.length < 10) return null;
      header = { mime: "image/gif", width: view.getUint16(6, true), height: view.getUint16(8, true) };
    } else if (startsWith(bytes, [0xff, 0xd8])) {
      header = readJpeg(bytes);
    }
  } catch {
    return null;
  }

  if (!header || header.width === 0 || header.height === 0) return null;
  return header;
}
