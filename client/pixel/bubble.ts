import { FONT_HEIGHT, ICON, glyph } from "./font";
import { canvas, type Bitmap, type Canvas } from "./grid";
import { Lru } from "./lru";
import { slotIndex, type Slot } from "./palette";
import { crispScale } from "./scale";
import { stampText, textWidth, wrapText } from "./text";

/**
 * Speech bubbles with the words drawn in: one bitmap, one image, whatever the text. The tail
 * points down at the speaker. Tones differ in shape and icon as well as colour.
 */

export type BubbleTone = "say" | "tool" | "tell" | "ask" | "alert";
export type BubbleStatus = "running" | "completed" | "failed" | "canceled";

export interface BubbleSpec {
  /** Raw text; it is folded to the font and cut to fit. */
  readonly text: string;
  readonly tone: BubbleTone;
  /** For `tool`: picks the icon, and `failed` takes the danger colour. */
  readonly status?: BubbleStatus;
  /** Widest the whole bubble may be, in art pixels. */
  readonly maxWidth?: number;
  /** Most lines the text may wrap to. A `tool` bubble is always one line. */
  readonly maxLines?: number;
  /** Where the tail's tip sits, in art pixels from the left edge. Defaults to the centre. */
  readonly tailX?: number;
}

export const BUBBLE_MAX_WIDTH = 88;
export const BUBBLE_MAX_LINES = 3;
const PAD_X = 2;
const PAD_TOP = 1;
const ICON_GAP = 2;
const TAIL_HEIGHT = 2;
/** Lines sit directly under one another: a descender may touch the next line's capitals. */
const LINE_HEIGHT = FONT_HEIGHT;
/** Border, padding, the lines, border, tail. */
const heightOf = (lines: number) => 1 + PAD_TOP + lines * LINE_HEIGHT + 1 + TAIL_HEIGHT;
/** The height of a one-line bubble. Bubbles with more lines are taller: see `bubbleSize`. */
export const BUBBLE_HEIGHT = heightOf(1);
/** The tail keeps this far from either end, clear of the corners. */
const TAIL_MARGIN = 4;

/**
 * Bubbles are drawn at their own scale, whatever the room's, so the words stay readable when the
 * room is small: the smallest crisp scale that makes a capital about ten layout pixels tall.
 */
export function bubbleScale(pixelRatio: number): number {
  return crispScale(1.4, pixelRatio, "up");
}

interface Style {
  readonly fill: Slot;
  readonly ink: Slot;
  readonly icon: string | null;
  /** Rounded bubbles are speech; the square one is a terminal. */
  readonly square: boolean;
}

function styleOf(tone: BubbleTone, status: BubbleStatus | undefined): Style {
  switch (tone) {
    case "say":
      return { fill: "white", ink: "outline", icon: null, square: false };
    case "tool":
      if (status === "failed") return { fill: "emoteFail", ink: "emoteFailInk", icon: ICON.cross, square: true };
      return {
        fill: "screenOff",
        ink: "white",
        icon: status === "completed" ? ICON.check : status === "canceled" ? "-" : ICON.prompt,
        square: true,
      };
    case "tell":
      return { fill: "emoteThinking", ink: "emoteThinkingInk", icon: ICON.arrow, square: false };
    case "ask":
      return { fill: "emoteAlert", ink: "emoteAlertInk", icon: "?", square: false };
    case "alert":
      return { fill: "emoteFail", ink: "emoteFailInk", icon: "!", square: false };
  }
}

interface Plan {
  readonly style: Style;
  readonly lines: readonly string[];
  readonly width: number;
  readonly height: number;
  readonly tailX: number;
}

function plan(spec: BubbleSpec): Plan {
  const style = styleOf(spec.tone, spec.status);
  const iconWidth = style.icon ? glyph(style.icon).width + ICON_GAP : 0;
  const chrome = 2 + 2 * PAD_X + iconWidth;
  const minWidth = 2 * TAIL_MARGIN + 1;
  const maxWidth = Math.max(minWidth, Math.floor(spec.maxWidth ?? BUBBLE_MAX_WIDTH));
  const maxLines = spec.tone === "tool" ? 1 : Math.max(1, Math.floor(spec.maxLines ?? BUBBLE_MAX_LINES));
  const lines = wrapText(spec.text, Math.max(0, maxWidth - chrome), maxLines);
  const widest = Math.max(0, ...lines.map(textWidth));
  // With no words left, the icon does not need the gap after it.
  const content = widest === 0 && iconWidth > 0 ? iconWidth - ICON_GAP : iconWidth + widest;
  const width = Math.min(maxWidth, Math.max(minWidth, 2 + 2 * PAD_X + content));
  const wanted = spec.tailX === undefined ? Math.floor(width / 2) : Math.round(spec.tailX);
  const tailX = Math.min(width - 1 - TAIL_MARGIN, Math.max(TAIL_MARGIN, wanted));
  return { style, lines, width, height: heightOf(Math.max(1, lines.length)), tailX };
}

/** How wide `bubble(spec)` will be, in art pixels, without drawing it. */
export function bubbleWidth(spec: BubbleSpec): number {
  return plan(spec).width;
}

/** The size `bubble(spec)` will have, in art pixels, tail included, without drawing it. */
export function bubbleSize(spec: BubbleSpec): { width: number; height: number } {
  const { width, height } = plan(spec);
  return { width, height };
}

function draw({ style, lines, width, height, tailX }: Plan): Canvas {
  const out = canvas(width, height);
  const outline = slotIndex("outline");
  const fill = slotIndex(style.fill);
  const ink = slotIndex(style.ink);
  const set = (x: number, y: number, value: number) => {
    out.pixels[y * width + x] = value;
  };
  const bottom = height - TAIL_HEIGHT - 1;
  for (let y = 0; y <= bottom; y++) {
    for (let x = 0; x < width; x++) {
      const edge = x === 0 || y === 0 || x === width - 1 || y === bottom;
      set(x, y, edge ? outline : fill);
    }
  }
  if (!style.square) {
    // Take the corner pixel away and bring the outline one step in.
    for (const [x, inner] of [
      [0, 1],
      [width - 1, width - 2],
    ] as const) {
      for (const [y, innerY] of [
        [0, 1],
        [bottom, bottom - 1],
      ] as const) {
        set(x, y, 0);
        set(inner, innerY, outline);
      }
    }
  }
  // The tail opens the bottom border for three pixels and closes to a point two rows down.
  for (let dx = -1; dx <= 1; dx++) set(tailX + dx, bottom, fill);
  set(tailX - 2, bottom, outline);
  set(tailX + 2, bottom, outline);
  set(tailX - 1, bottom + 1, outline);
  set(tailX, bottom + 1, fill);
  set(tailX + 1, bottom + 1, outline);
  set(tailX, bottom + 2, outline);

  let x = 1 + PAD_X;
  const top = 1 + PAD_TOP;
  if (style.icon) {
    stampText(out.pixels, width, style.icon, x, top, ink);
    x += glyph(style.icon).width + ICON_GAP;
  }
  lines.forEach((line, index) => stampText(out.pixels, width, line, x, top + index * LINE_HEIGHT, ink));
  return out;
}

export const BUBBLE_MAX_CACHED = 256;
const cache = new Lru<Bitmap>(BUBBLE_MAX_CACHED);

const TAG_HEIGHT = heightOf(1) - TAIL_HEIGHT;

/** A small plate with a few characters on it, such as a count. No tail; anchored bottom centre. */
export function tag(text: string): Bitmap {
  const label = wrapText(text, BUBBLE_MAX_WIDTH, 1)[0] ?? "";
  const width = 2 + 2 * PAD_X + textWidth(label);
  const key = `g:${label}`;
  let bitmap = cache.get(key);
  if (!bitmap) {
    const out = canvas(width, TAG_HEIGHT);
    const [outline, fill] = [slotIndex("outline"), slotIndex("white")];
    for (let y = 0; y < TAG_HEIGHT; y++) {
      for (let x = 0; x < width; x++) {
        const edge = x === 0 || y === 0 || x === width - 1 || y === TAG_HEIGHT - 1;
        out.pixels[y * width + x] = edge ? outline : fill;
      }
    }
    stampText(out.pixels, width, label, 1 + PAD_X, 1 + PAD_TOP, outline);
    bitmap = { key, anchor: { x: Math.floor(width / 2), y: TAG_HEIGHT }, ...out };
    cache.set(key, bitmap);
  }
  return bitmap;
}


/** The bubble for `spec`. Its anchor is the tip of the tail. */
export function bubble(spec: BubbleSpec): Bitmap {
  const planned = plan(spec);
  const key = `b:${spec.tone}:${spec.status ?? ""}:${planned.width}:${planned.tailX}:${planned.lines.join("\n")}`;
  let bitmap = cache.get(key);
  if (!bitmap) {
    bitmap = { key, anchor: { x: planned.tailX, y: planned.height }, ...draw(planned) };
    cache.set(key, bitmap);
  }
  return bitmap;
}
