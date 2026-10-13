/**
 * A PNG encoder small enough to run in a plugin client: no canvas, no DOM, no Node. It writes
 * palette-indexed images (colour type 3) and deflates them with fixed Huffman codes, matching only
 * against the previous pixel and the previous row. Upscaled pixel art is almost nothing but those
 * two repeats, so a sprite comes out at a few hundred bytes.
 */

export type Rgba = readonly [red: number, green: number, blue: number, alpha: number];

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ADLER_MOD = 65521;
const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]!) % ADLER_MOD;
    b = (b + a) % ADLER_MOD;
  }
  return ((b << 16) | a) >>> 0;
}

export function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += BASE64[b0 >> 2]!;
    out += BASE64[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)]!;
    out += b1 === undefined ? "=" : BASE64[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)]!;
    out += b2 === undefined ? "=" : BASE64[b2 & 63]!;
  }
  return out;
}

/** Repeats every pixel `scale` times in both directions: nearest-neighbour, done before encoding. */
export function upscale(
  pixels: Uint8Array,
  width: number,
  height: number,
  scale: number,
): Uint8Array {
  if (scale === 1) return pixels;
  const out = new Uint8Array(width * scale * height * scale);
  const stride = width * scale;
  for (let y = 0; y < height; y++) {
    const first = y * scale * stride;
    for (let x = 0; x < width; x++) {
      out.fill(pixels[y * width + x]!, first + x * scale, first + (x + 1) * scale);
    }
    for (let copy = 1; copy < scale; copy++) {
      out.copyWithin(first + copy * stride, first, first + stride);
    }
  }
  return out;
}

const MIN_MATCH = 3;
const MAX_MATCH = 258;
const END_OF_BLOCK = 256;
const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258,
];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DISTANCE_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145,
  8193, 12289, 16385, 24577,
];
const DISTANCE_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];
const MAX_DISTANCE = 32768;

class BitWriter {
  private bytes: number[] = [];
  private buffer = 0;
  private count = 0;

  /** Extra bits and headers go in least significant bit first. */
  bits(value: number, length: number): void {
    this.buffer |= value << this.count;
    this.count += length;
    while (this.count >= 8) {
      this.bytes.push(this.buffer & 0xff);
      this.buffer >>>= 8;
      this.count -= 8;
    }
  }

  /** Huffman codes go in most significant bit first. */
  code(value: number, length: number): void {
    let reversed = 0;
    for (let i = 0; i < length; i++) reversed |= ((value >> i) & 1) << (length - 1 - i);
    this.bits(reversed, length);
  }

  /** A literal byte, a length symbol or end-of-block, in the fixed Huffman table. */
  symbol(value: number): void {
    if (value < 144) this.code(0x30 + value, 8);
    else if (value < 256) this.code(0x190 + value - 144, 9);
    else if (value < 280) this.code(value - 256, 7);
    else this.code(0xc0 + value - 280, 8);
  }

  finish(): number[] {
    if (this.count > 0) this.bytes.push(this.buffer & 0xff);
    return this.bytes;
  }
}

function bucket(bases: readonly number[], value: number): number {
  let index = bases.length - 1;
  while (bases[index]! > value) index--;
  return index;
}

function matchLength(raw: Uint8Array, at: number, distance: number): number {
  if (distance > at || distance > MAX_DISTANCE) return 0;
  const limit = Math.min(MAX_MATCH, raw.length - at);
  let length = 0;
  while (length < limit && raw[at + length] === raw[at + length - distance]) length++;
  return length;
}

/** A zlib stream of `raw`. `stride` is the length of one scanline, the second distance tried. */
export function deflate(raw: Uint8Array, stride: number): Uint8Array {
  const writer = new BitWriter();
  writer.bits(1, 1); // final block
  writer.bits(1, 2); // fixed Huffman codes
  let at = 0;
  while (at < raw.length) {
    const run = matchLength(raw, at, 1);
    const above = matchLength(raw, at, stride);
    const length = Math.max(run, above);
    if (length < MIN_MATCH) {
      writer.symbol(raw[at]!);
      at++;
      continue;
    }
    const distance = above > run ? stride : 1;
    const lengthCode = bucket(LENGTH_BASE, length);
    writer.symbol(257 + lengthCode);
    writer.bits(length - LENGTH_BASE[lengthCode]!, LENGTH_EXTRA[lengthCode]!);
    const distanceCode = bucket(DISTANCE_BASE, distance);
    writer.code(distanceCode, 5);
    writer.bits(distance - DISTANCE_BASE[distanceCode]!, DISTANCE_EXTRA[distanceCode]!);
    at += length;
  }
  writer.symbol(END_OF_BLOCK);
  const body = writer.finish();
  const out = new Uint8Array(2 + body.length + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  out.set(body, 2);
  writeUint32(out, 2 + body.length, adler32(raw));
  return out;
}

function writeUint32(target: Uint8Array, at: number, value: number): void {
  target[at] = value >>> 24;
  target[at + 1] = (value >>> 16) & 0xff;
  target[at + 2] = (value >>> 8) & 0xff;
  target[at + 3] = value & 0xff;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  writeUint32(out, 0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  writeUint32(out, 8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

/**
 * Encodes `pixels` (one palette index per pixel, row-major) as a PNG. Palette alpha goes to a
 * tRNS chunk, so index 0 can be fully transparent.
 */
export function encodeIndexedPng(
  pixels: Uint8Array,
  width: number,
  height: number,
  palette: readonly Rgba[],
): Uint8Array {
  if (pixels.length !== width * height) throw new Error("pixel count does not match the size");
  if (palette.length === 0 || palette.length > 256) throw new Error("palette must hold 1 to 256 colours");

  const header = new Uint8Array(13);
  writeUint32(header, 0, width);
  writeUint32(header, 4, height);
  header[8] = 8; // bit depth
  header[9] = 3; // indexed colour

  const colours = new Uint8Array(palette.length * 3);
  const alphas = new Uint8Array(palette.length);
  palette.forEach(([red, green, blue, alpha], index) => {
    colours[index * 3] = red;
    colours[index * 3 + 1] = green;
    colours[index * 3 + 2] = blue;
    alphas[index] = alpha;
  });

  // Each scanline is prefixed with filter type 0 (none).
  const raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw.set(pixels.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  }

  const parts = [
    Uint8Array.from(SIGNATURE),
    chunk("IHDR", header),
    chunk("PLTE", colours),
    chunk("tRNS", alphas),
    chunk("IDAT", deflate(raw, width + 1)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export function pngDataUri(
  pixels: Uint8Array,
  width: number,
  height: number,
  palette: readonly Rgba[],
  scale = 1,
): string {
  const png = encodeIndexedPng(upscale(pixels, width, height, scale), width * scale, height * scale, palette);
  return `data:image/png;base64,${toBase64(png)}`;
}
