import { test, expect } from "bun:test";
import { inflateSync } from "node:zlib";
import { encodePng, readImageHeader } from "./image-codec";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// A second, deliberately naive CRC-32 so the chunk checksums are checked
// against something other than the table the encoder itself builds.
function crc32Reference(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

// Signature (8) + IHDR chunk (4 length + 4 type + 13 data + 4 CRC).
const IHDR_START = 8;
const IDAT_START = 33;

const ROW_0 = [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255];
const ROW_1 = [1, 2, 3, 4, 250, 251, 252, 253, 128, 128, 128, 0];
const IMAGE_3X2 = Uint8Array.from([...ROW_0, ...ROW_1]);

test("encodePng writes a readable 3x2 PNG", () => {
  const png = encodePng(IMAGE_3X2, 3, 2);

  expect([...png.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
  expect(readImageHeader(png)).toEqual({ mime: "image/png", width: 3, height: 2 });
});

test("encodePng's IDAT inflates to filter-0 scanlines", () => {
  const png = encodePng(IMAGE_3X2, 3, 2);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);

  expect(String.fromCharCode(...png.subarray(IDAT_START + 4, IDAT_START + 8))).toBe("IDAT");
  const length = view.getUint32(IDAT_START, false);
  const payload = png.subarray(IDAT_START + 8, IDAT_START + 8 + length);

  expect([...inflateSync(payload)]).toEqual([0, ...ROW_0, 0, ...ROW_1]);
});

test("encodePng's IHDR carries a valid CRC", () => {
  const png = encodePng(IMAGE_3X2, 3, 2);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);

  // CRC covers the type and the data, not the length.
  const end = IHDR_START + 8 + 13;
  expect(view.getUint32(end, false)).toBe(crc32Reference(png.subarray(IHDR_START + 4, end)));
});

test("encodePng rejects a buffer that is not width * height * 4", () => {
  expect(() => encodePng(new Uint8Array(23), 3, 2)).toThrow();
});

test("readImageHeader sizes a GIF89a", () => {
  const gif = new Uint8Array(13);
  gif.set([..."GIF89a"].map((c) => c.charCodeAt(0)));
  new DataView(gif.buffer).setUint16(6, 640, true);
  new DataView(gif.buffer).setUint16(8, 480, true);

  expect(readImageHeader(gif)).toEqual({ mime: "image/gif", width: 640, height: 480 });
});

// SOI, a short APP0, then a baseline SOF0 whose payload is precision, height,
// width — the reader has to skip the APP0 by its length to reach it.
function buildJpeg(width: number, height: number, includeSof = true): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x06, 0x4a, 0x46, 0x49, 0x46];
  if (!includeSof) return Uint8Array.from([0xff, 0xd8, ...app0]);
  // Length 0x0b covers itself, precision, height, width, the component count
  // and that one component's three-byte spec.
  const sof = [
    0xff, 0xc0, 0x00, 0x0b, 0x08,
    height >> 8, height & 0xff, width >> 8, width & 0xff,
    0x01, 0x01, 0x11, 0x00,
  ];
  return Uint8Array.from([0xff, 0xd8, ...app0, ...sof]);
}

test("readImageHeader sizes a JPEG from its SOF0", () => {
  expect(readImageHeader(buildJpeg(1024, 768))).toEqual({ mime: "image/jpeg", width: 1024, height: 768 });
});

test("readImageHeader returns null for input it cannot size", () => {
  expect(readImageHeader(new Uint8Array(0))).toBeNull();
  expect(readImageHeader(new TextEncoder().encode("not an image at all, just text"))).toBeNull();
  expect(readImageHeader(encodePng(IMAGE_3X2, 3, 2).subarray(0, 12))).toBeNull();
  expect(readImageHeader(buildJpeg(1024, 768, false))).toBeNull();
});
