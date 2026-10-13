import { Lru } from "./lru";
import { slotIndex, type Slot } from "./palette";

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A drawn sprite: one palette slot index per pixel, row-major. Theme independent. */
export interface Bitmap {
  /** Identifies the drawing; equal keys mean equal pixels. */
  readonly key: string;
  readonly width: number;
  readonly height: number;
  /** The pixel that sits on the sprite's position: under the feet, or the bottom centre. */
  readonly anchor: Point;
  readonly pixels: Uint8Array;
}

export interface Canvas {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
}

/** One character per pixel; `.` is transparent, every other character needs a legend entry. */
export type Legend = Readonly<Record<string, Slot>>;

export function canvas(width: number, height: number): Canvas {
  return { width, height, pixels: new Uint8Array(width * height) };
}

export function paint(rows: readonly string[], legend: Legend): Canvas {
  const width = rows[0]?.length ?? 0;
  const out = canvas(width, rows.length);
  rows.forEach((row, y) => {
    if (row.length !== width) throw new Error(`row ${y} is ${row.length} wide, expected ${width}: "${row}"`);
    for (let x = 0; x < width; x++) {
      const char = row[x]!;
      if (char === ".") continue;
      const slot = legend[char];
      if (slot === undefined) throw new Error(`no legend entry for "${char}" in row ${y}: "${row}"`);
      out.pixels[y * width + x] = slotIndex(slot);
    }
  });
  return out;
}

/** Draws `source` onto `target` at an offset. Transparent pixels leave the target alone. */
export function blit(target: Canvas, source: Canvas, dx = 0, dy = 0): void {
  for (let y = 0; y < source.height; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= target.height) continue;
    for (let x = 0; x < source.width; x++) {
      const tx = x + dx;
      if (tx < 0 || tx >= target.width) continue;
      const value = source.pixels[y * source.width + x]!;
      if (value !== 0) target.pixels[ty * target.width + tx] = value;
    }
  }
}

export function mirror(source: Canvas): Canvas {
  const out = canvas(source.width, source.height);
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      out.pixels[y * source.width + x] = source.pixels[y * source.width + (source.width - 1 - x)]!;
    }
  }
  return out;
}

/** Makes every row from `fromRow` down transparent. */
export function clearBelow(target: Canvas, fromRow: number): void {
  target.pixels.fill(0, fromRow * target.width);
}

/** Builds a row from `[text, repeat]` pairs and plain strings, for sprites too wide to type out. */
export function row(...parts: readonly (string | readonly [string, number])[]): string {
  return parts.map((part) => (typeof part === "string" ? part : part[0].repeat(part[1]))).join("");
}

export interface Layer {
  readonly bitmap: Bitmap;
  /** Where the bitmap's anchor goes, in the composite's pixels. */
  readonly x: number;
  readonly y: number;
}

/** Room backdrops are large; the least recently used are dropped past either cap. */
export const COMPOSITE_MAX_ENTRIES = 32;
export const COMPOSITE_MAX_PIXELS = 8_000_000;
const composites = new Lru<Bitmap>(COMPOSITE_MAX_ENTRIES, COMPOSITE_MAX_PIXELS, (bitmap) => bitmap.pixels.length);

/**
 * Flattens layers, in order, into one bitmap, so a whole floor or a furnished room costs one image.
 * `key` must describe the layers: while a result is cached, the same key returns it. A composite
 * dropped from the cache is simply drawn again on the next call.
 */
export function composite(key: string, width: number, height: number, layers: readonly Layer[]): Bitmap {
  const cacheKey = `x:${width}x${height}:${key}`;
  let bitmap = composites.get(cacheKey);
  if (!bitmap) {
    const out = canvas(width, height);
    for (const layer of layers) {
      blit(out, layer.bitmap, layer.x - layer.bitmap.anchor.x, layer.y - layer.bitmap.anchor.y);
    }
    bitmap = { key: cacheKey, anchor: { x: 0, y: 0 }, ...out };
    composites.set(cacheKey, bitmap);
  }
  return bitmap;
}
