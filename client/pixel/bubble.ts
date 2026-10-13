import { FACES, ICON, glyph, type Face } from "./font";
import { canvas, type Bitmap, type Canvas } from "./grid";
import { Lru } from "./lru";
import { slotIndex, type Slot } from "./palette";
import { crispScale } from "./scale";
import { stampText, textWidth, wrapText } from "./text";

/**
 * Speech bubbles with the words drawn in: one bitmap, one image, whatever the text. The tail
 * points down at the speaker. Tones differ in shape and icon as well as colour. Bubbles are drawn
 * at the room's scale, so they stay in proportion to the character they belong to.
 */

export type BubbleTone = "say" | "tool" | "tell" | "ask" | "alert";
export type BubbleStatus = "running" | "completed" | "failed" | "canceled";

export interface BubbleSpec {
  /** Raw text; it is folded to the font and cut to fit. */
  readonly text: string;
  readonly tone: BubbleTone;
  /** For `tool`: picks the icon, and `failed` takes the danger colour. */
  readonly status?: BubbleStatus;
  /** `small` (3 x 5, the default) sits in proportion to a character; `regular` is 5 x 7. */
  readonly face?: Face;
  /** Widest the whole bubble may be, in art pixels. Defaults to the face's `maxWidth`. */
  readonly maxWidth?: number;
  /** Most lines the text may wrap to. A `tool` bubble is always one line. */
  readonly maxLines?: number;
  /** Where the tail's tip sits, in art pixels from the left edge. Defaults to the centre. */
  readonly tailX?: number;
}

interface Metrics {
  readonly maxWidth: number;
  readonly padX: number;
  /** Rows between the top border and the capitals. */
  readonly padTop: number;
  /** Rows from one line's capitals to the next line's. */
  readonly linePitch: number;
  readonly iconGap: number;
  readonly tail: number;
  /** The tail keeps this far from either end, clear of the corners. */
  readonly tailMargin: number;
}

const METRICS: Readonly<Record<Face, Metrics>> = {
  small: { maxWidth: 64, padX: 1, padTop: 1, linePitch: 7, iconGap: 1, tail: 1, tailMargin: 2 },
  regular: { maxWidth: 88, padX: 2, padTop: 1, linePitch: 9, iconGap: 2, tail: 2, tailMargin: 4 },
};

export const BUBBLE_FACE: Face = "small";
export const BUBBLE_MAX_WIDTH = METRICS[BUBBLE_FACE].maxWidth;
export const BUBBLE_MAX_LINES = 3;

/** Border, padding, the lines, border, tail. A tool box has no padding above its one line. */
function heightOf(face: Face, lines: number, tight: boolean): number {
  const metrics = METRICS[face];
  return 1 + (tight ? 0 : metrics.padTop) + (lines - 1) * metrics.linePitch + FACES[face].height + 1 + metrics.tail;
}

/** The height of a one-line speech bubble in the default face. See `bubbleSize` for the rest. */
export const BUBBLE_HEIGHT = heightOf(BUBBLE_FACE, 1, false);

/**
 * The smallest crisp scale at or above 1: what a room in a narrow pane is drawn at. Bubbles no
 * longer have a scale of their own; draw them at the room's.
 */
export function bubbleScale(pixelRatio: number): number {
  return crispScale(1, pixelRatio, "up");
}

interface Style {
  readonly fill: Slot;
  readonly ink: Slot;
  readonly icon: string | null;
  /** Rounded bubbles are speech; the square one is a terminal. */
  readonly square: boolean;
}

function styleOf(tone: BubbleTone, status: BubbleStatus | undefined, face: Face): Style {
  switch (tone) {
    case "say":
      return { fill: "white", ink: "outline", icon: null, square: false };
    case "tool":
      if (status === "failed") return { fill: "emoteFail", ink: "emoteFailInk", icon: ICON.cross, square: true };
      return {
        fill: "screenOff",
        ink: "white",
        // At the small size the square dark box is the mark of a running tool; the prompt would
        // double its width.
        icon: status === "completed" ? ICON.check : status === "canceled" ? "-" : face === "small" ? null : ICON.prompt,
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
  readonly face: Face;
  readonly style: Style;
  readonly lines: readonly string[];
  readonly width: number;
  readonly height: number;
  readonly tailX: number;
}

function plan(spec: BubbleSpec): Plan {
  const face = spec.face ?? BUBBLE_FACE;
  const metrics = METRICS[face];
  const style = styleOf(spec.tone, spec.status, face);
  const iconWidth = style.icon ? glyph(style.icon, face).width + metrics.iconGap : 0;
  const chrome = 2 + 2 * metrics.padX + iconWidth;
  const minWidth = 2 * metrics.tailMargin + 1;
  const maxWidth = Math.max(minWidth, Math.floor(spec.maxWidth ?? metrics.maxWidth));
  const maxLines = spec.tone === "tool" ? 1 : Math.max(1, Math.floor(spec.maxLines ?? BUBBLE_MAX_LINES));
  const lines = wrapText(spec.text, Math.max(0, maxWidth - chrome), maxLines, face);
  const widest = Math.max(0, ...lines.map((line) => textWidth(line, face)));
  // With no words left, the icon does not need the gap after it.
  const content = widest === 0 && iconWidth > 0 ? iconWidth - metrics.iconGap : iconWidth + widest;
  const width = Math.min(maxWidth, Math.max(minWidth, 2 + 2 * metrics.padX + content));
  const wanted = spec.tailX === undefined ? Math.floor(width / 2) : Math.round(spec.tailX);
  const tailX = Math.min(width - 1 - metrics.tailMargin, Math.max(metrics.tailMargin, wanted));
  const height = heightOf(face, Math.max(1, lines.length), style.square);
  return { face, style, lines, width, height, tailX };
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

/** A filled box with a one-pixel outline, covering rows 0 to `bottom`. */
function box(out: Canvas, bottom: number, fill: number, outline: number, square: boolean): void {
  const { width } = out;
  for (let y = 0; y <= bottom; y++) {
    for (let x = 0; x < width; x++) {
      const edge = x === 0 || y === 0 || x === width - 1 || y === bottom;
      out.pixels[y * width + x] = edge ? outline : fill;
    }
  }
  if (square) return;
  // Take each corner pixel away.
  for (const x of [0, width - 1]) {
    for (const y of [0, bottom]) out.pixels[y * width + x] = 0;
  }
}

function draw({ face, style, lines, width, height, tailX }: Plan): Canvas {
  const metrics = METRICS[face];
  const out = canvas(width, height);
  const outline = slotIndex("outline");
  const fill = slotIndex(style.fill);
  const ink = slotIndex(style.ink);
  const set = (x: number, y: number, value: number) => {
    out.pixels[y * width + x] = value;
  };
  const bottom = height - metrics.tail - 1;
  box(out, bottom, fill, outline, style.square);
  if (!style.square && face === "regular") {
    for (const x of [1, width - 2]) {
      for (const y of [1, bottom - 1]) set(x, y, outline);
    }
  }
  if (metrics.tail === 1) {
    // A one-pixel nub under the border.
    set(tailX, bottom + 1, outline);
  } else {
    // The tail opens the bottom border for three pixels and closes to a point two rows down.
    for (let dx = -1; dx <= 1; dx++) set(tailX + dx, bottom, fill);
    set(tailX - 2, bottom, outline);
    set(tailX + 2, bottom, outline);
    set(tailX - 1, bottom + 1, outline);
    set(tailX, bottom + 1, fill);
    set(tailX + 1, bottom + 1, outline);
    set(tailX, bottom + 2, outline);
  }

  let x = 1 + metrics.padX;
  const top = 1 + (style.square ? 0 : metrics.padTop);
  if (style.icon) {
    stampText(out.pixels, width, style.icon, x, top, ink, face);
    x += glyph(style.icon, face).width + metrics.iconGap;
  }
  lines.forEach((line, index) => stampText(out.pixels, width, line, x, top + index * metrics.linePitch, ink, face));
  return out;
}

export const BUBBLE_MAX_CACHED = 256;
const cache = new Lru<Bitmap>(BUBBLE_MAX_CACHED);

/** The bubble for `spec`. Its anchor is the tip of the tail. */
export function bubble(spec: BubbleSpec): Bitmap {
  const planned = plan(spec);
  const key = `b:${planned.face}:${spec.tone}:${spec.status ?? ""}:${planned.width}:${planned.tailX}:${planned.lines.join("\n")}`;
  let bitmap = cache.get(key);
  if (!bitmap) {
    bitmap = { key, anchor: { x: planned.tailX, y: planned.height }, ...draw(planned) };
    cache.set(key, bitmap);
  }
  return bitmap;
}

/** A small plate with a few characters on it, such as a count. No tail; anchored bottom centre. */
export function tag(text: string, face: Face = BUBBLE_FACE): Bitmap {
  const metrics = METRICS[face];
  const label = wrapText(text, metrics.maxWidth, 1, face)[0] ?? "";
  const key = `g:${face}:${label}`;
  let bitmap = cache.get(key);
  if (!bitmap) {
    const { ascent, descent } = FACES[face];
    const out = canvas(2 + 2 * metrics.padX + textWidth(label, face), 1 + metrics.padTop + ascent + descent + 1);
    box(out, out.height - 1, slotIndex("white"), slotIndex("outline"), true);
    stampText(out.pixels, out.width, label, 1 + metrics.padX, 1 + metrics.padTop, slotIndex("outline"), face);
    bitmap = { key, anchor: { x: Math.floor(out.width / 2), y: out.height }, ...out };
    cache.set(key, bitmap);
  }
  return bitmap;
}
