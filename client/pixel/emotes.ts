import { paint, type Bitmap, type Legend, type Point } from "./grid";
import type { Slot } from "./palette";

/**
 * Status bubbles, 12 x 12, shown above a head. The bubble takes the theme's status colour and the
 * glyph inside tells the states apart without it.
 */

export type EmoteId =
  | "alert"
  | "question"
  | "fail"
  | "check"
  | "zzz"
  | "thinking"
  /** Ready, breathing: the check bubble settles a pixel and rises again. */
  | "readyBob"
  /** Ready, with a glint that runs along the check now and then. */
  | "readySpark"
  /** Ready, at the pantry: a steaming cup. */
  | "readyCup";

export const EMOTE_SIZE = 12;

const BUBBLE_TOP = ["..oooooooo..", ".okkkkkkkko."];
const BUBBLE_BOTTOM = [".okkkkkkkko.", "..oookkooo..", "....okko....", ".....oo....."];

type Rows = readonly string[];

/** Six glyph rows set between the bubble's top and bottom. */
const inBubble = (glyph: Rows): Rows => [...BUBBLE_TOP, ...glyph, ...BUBBLE_BOTTOM];
/** The same bubble a pixel lower with its tail a row shorter, as if it had settled. */
const settled = (glyph: Rows): Rows => [
  "............",
  ...BUBBLE_TOP,
  ...glyph,
  BUBBLE_BOTTOM[0]!,
  BUBBLE_BOTTOM[1]!,
  BUBBLE_BOTTOM[3]!,
];

const CHECK: Rows = ["okkkkkkkkiko", "okkkkkkkiiko", "okikkkkiikko", "okiikkiikkko", "okkiiiikkkko", "okkkiikkkkko"];
/** Where the glint sits on the check, frame by frame: [column, glyph row], or null for a rest. */
const GLINT: readonly (readonly [number, number] | null)[] = [null, [2, 2], [4, 4], [6, 4], [8, 2], [9, 0], null, null];
const glinting = (at: readonly [number, number] | null): Rows =>
  at ? CHECK.map((line, y) => (y === at[1] ? `${line.slice(0, at[0])}w${line.slice(at[0] + 1)}` : line)) : CHECK;
const CUP: Rows = ["okkwwwwwwkko", "okkwwwwwwwko", "okkwwwwwwwko", "okkkwwwwkkko"];

// One entry per frame, each a whole 12 x 12 drawing.
const FRAMES: Readonly<Record<EmoteId, readonly Rows[]>> = {
  alert: [["okkkkiikkkko", "okkkkiikkkko", "okkkkiikkkko", "okkkkiikkkko", "okkkkkkkkkko", "okkkkiikkkko"]].map(inBubble),
  question: [["okkkiiiikkko", "okkkkkkiikko", "okkkkkiikkko", "okkkkiikkkko", "okkkkkkkkkko", "okkkkiikkkko"]].map(inBubble),
  fail: [["okkiikkiikko", "okkkiiiikkko", "okkkkiikkkko", "okkkiiiikkko", "okkiikkiikko", "okkkkkkkkkko"]].map(inBubble),
  check: [CHECK].map(inBubble),
  zzz: [
    ["okkkkkkkkkko", "okkiiiikkkko", "okkkkikkkkko", "okkkikkkkkko", "okkiiiikkkko", "okkkkkkkkkko"],
    ["okkkkiiiikko", "okkkkkkikkko", "okkkkkikkkko", "okkkkiiiikko", "okiikkkkkkko", "okkkkkkkkkko"],
  ].map(inBubble),
  thinking: [
    ["okkkkkkkkkko", "okkkkkkkkkko", "okiikiikiiko", "okiikiikiiko", "okkkkkkkkkko", "okkkkkkkkkko"],
    ["okkkkkkkkkko", "okiikkkkkkko", "okiikiikiiko", "okkkkiikiiko", "okkkkkkkkkko", "okkkkkkkkkko"],
    ["okkkkkkkkkko", "okkkkiikkkko", "okiikiikiiko", "okiikkkkiiko", "okkkkkkkkkko", "okkkkkkkkkko"],
    ["okkkkkkkkkko", "okkkkkkkiiko", "okiikiikiiko", "okiikiikkkko", "okkkkkkkkkko", "okkkkkkkkkko"],
  ].map(inBubble),
  readyBob: [inBubble(CHECK), settled(CHECK)],
  readySpark: GLINT.map((at) => inBubble(glinting(at))),
  readyCup: [
    ["okkkikkikkko", "okkkkikkikko", ...CUP],
    ["okkkkikkikko", "okkkikkikkko", ...CUP],
    ["okkkikkkikko", "okkkkkikkkko", ...CUP],
  ].map(inBubble),
};

const FILL: Readonly<Record<EmoteId, readonly [Slot, Slot]>> = {
  alert: ["emoteAlert", "emoteAlertInk"],
  question: ["emoteAlert", "emoteAlertInk"],
  fail: ["emoteFail", "emoteFailInk"],
  check: ["emoteReady", "emoteReadyInk"],
  zzz: ["emoteIdle", "emoteIdleInk"],
  thinking: ["emoteThinking", "emoteThinkingInk"],
  readyBob: ["emoteReady", "emoteReadyInk"],
  readySpark: ["emoteReady", "emoteReadyInk"],
  readyCup: ["emoteReady", "emoteReadyInk"],
};

/** A suggested time per frame, in milliseconds. */
export const EMOTE_FRAME_MS: Readonly<Record<EmoteId, number>> = {
  alert: 1000,
  question: 1000,
  fail: 1000,
  check: 1000,
  zzz: 900,
  thinking: 300,
  readyBob: 800,
  readySpark: 160,
  readyCup: 450,
};

export const EMOTE_FRAMES = Object.fromEntries(
  Object.entries(FRAMES).map(([id, frames]) => [id, frames.length]),
) as Readonly<Record<EmoteId, number>>;

/** The tip of the bubble's tail. */
export const EMOTE_ANCHOR: Point = { x: EMOTE_SIZE / 2, y: EMOTE_SIZE };

const cache = new Map<string, Bitmap>();

/** `frame` wraps; frame 0 is the still to show under reduced motion. */
export function emote(id: EmoteId, frame = 0): Bitmap {
  const frames = FRAMES[id];
  const index = ((frame % frames.length) + frames.length) % frames.length;
  const key = `e:${id}:${index}`;
  let bitmap = cache.get(key);
  if (!bitmap) {
    const [fill, ink] = FILL[id];
    const legend: Legend = { o: "outline", k: fill, i: ink, w: "white" };
    bitmap = { key, anchor: EMOTE_ANCHOR, ...paint(frames[index]!, legend) };
    cache.set(key, bitmap);
  }
  return bitmap;
}
