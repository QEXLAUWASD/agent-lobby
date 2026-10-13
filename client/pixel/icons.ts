import { paint, type Bitmap, type Legend } from "./grid";
import type { Slot } from "./palette";

/**
 * State icons for a list row, 8 x 8: the Office's marks at text size. Each is one colour from the
 * theme plus its contrasting ink, with no outline, so it holds on either surface. Shape tells the
 * states apart; where an icon moves, it moves instead of blinking.
 */

export type IconState = "needs-input" | "failed" | "working" | "ready" | "idle" | "closed";

export const ICON_SIZE = 8;

type Rows = readonly string[];

const blank = "........";
const placed = (rows: Rows, top: number): Rows => [
  ...Array.from({ length: top }, () => blank),
  ...rows,
  ...Array.from({ length: ICON_SIZE - top - rows.length }, () => blank),
];

// An exclamation badge that hops: up two pixels and back.
const BADGE: Rows = ["..kkkk..", ".kkiikk.", ".kkiikk.", ".kkkkkk.", ".kkiikk.", "..kkkk.."];
const CROSS: Rows = ["kk....kk", "kkk..kkk", ".kkkkkk.", "..kkkk..", "..kkkk..", ".kkkkkk.", "kkk..kkk", "kk....kk"];
// A monitor whose lines of code scroll.
const SCREEN_LINES = [3, 5, 2, 4];
const monitor = (frame: number): Rows => [
  "kkkkkkkk",
  ...Array.from({ length: 4 }, (_, y) => {
    const length = (y + frame) % 2 === 0 ? SCREEN_LINES[Math.floor((y + frame) / 2) % SCREEN_LINES.length]! : 0;
    return `k${"k".repeat(length).padEnd(6, "i")}k`;
  }),
  "kkkkkkkk",
  "...kk...",
  "..kkkk..",
];
const CHECK: Rows = [blank, "......kk", ".....kk.", "k...kk..", "kk.kk...", ".kkk....", "..k.....", blank];
/** A twinkle beside the check: nothing, a dot, a plus, a dot. */
const TWINKLE: readonly (readonly (readonly [number, number])[])[] = [
  [],
  [],
  [[1, 1]],
  [
    [1, 0],
    [0, 1],
    [1, 1],
    [2, 1],
    [1, 2],
  ],
  [[1, 1]],
  [],
];
const twinkling = (marks: readonly (readonly [number, number])[]): Rows =>
  CHECK.map((line, y) => {
    const chars = line.split("");
    for (const [x, at] of marks) if (at === y) chars[x] = "k";
    return chars.join("");
  });
const BIG_Z: Rows = ["...kkkkk", "......k.", ".....k..", "....k...", "...kkkkk"];
const SMALL_Z: Rows = ["kkk.....", ".k......", "kkk....."];
const snore = (big: boolean, small: boolean): Rows => [
  ...(big ? BIG_Z : Array.from({ length: BIG_Z.length }, () => blank)),
  ...(small ? SMALL_Z : Array.from({ length: SMALL_Z.length }, () => blank)),
];
// A filing cabinet: the agents who have left.
const CABINET: Rows = [".kkkkkk.", ".kiiiik.", ".kkkkkk.", ".kiiiik.", ".kkkkkk.", ".kiiiik.", ".kkkkkk.", blank];

const FRAMES: Readonly<Record<IconState, readonly Rows[]>> = {
  "needs-input": [2, 1, 0, 1].map((top) => placed(BADGE, top)),
  failed: [CROSS],
  working: [0, 1, 2, 3].map(monitor),
  ready: TWINKLE.map(twinkling),
  // The still is the full "Zz"; the loop lets one drift off at a time.
  idle: [snore(true, true), snore(true, false), snore(false, true)],
  closed: [CABINET],
};

const COLOURS: Readonly<Record<IconState, readonly [Slot, Slot]>> = {
  "needs-input": ["emoteAlert", "emoteAlertInk"],
  failed: ["emoteFail", "emoteFailInk"],
  working: ["emoteThinking", "emoteThinkingInk"],
  ready: ["emoteReady", "emoteReadyInk"],
  idle: ["emoteIdle", "emoteIdleInk"],
  closed: ["emoteIdle", "emoteIdleInk"],
};

/** A suggested time per frame, in milliseconds. */
export const ICON_FRAME_MS: Readonly<Record<IconState, number>> = {
  "needs-input": 140,
  failed: 1000,
  working: 180,
  ready: 320,
  idle: 800,
  closed: 1000,
};

export const ICON_FRAMES = Object.fromEntries(
  Object.entries(FRAMES).map(([state, frames]) => [state, frames.length]),
) as Readonly<Record<IconState, number>>;

const cache = new Map<string, Bitmap>();

/** One frame of a state's icon. `frame` wraps; frame 0 is the still. */
export function icon(state: IconState, frame = 0): Bitmap {
  const frames = FRAMES[state];
  const index = ((frame % frames.length) + frames.length) % frames.length;
  const key = `i:${state}:${index}`;
  let bitmap = cache.get(key);
  if (!bitmap) {
    const [fill, ink] = COLOURS[state];
    const legend: Legend = { k: fill, i: ink };
    bitmap = { key, anchor: { x: 0, y: 0 }, ...paint(frames[index]!, legend) };
    cache.set(key, bitmap);
  }
  return bitmap;
}
