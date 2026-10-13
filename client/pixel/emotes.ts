import { paint, type Bitmap, type Legend, type Point } from "./grid";
import type { Slot } from "./palette";

/**
 * Status bubbles, 12 x 12, shown above a head. The bubble takes the theme's status colour and the
 * glyph inside tells the states apart without it.
 */

export type EmoteId = "alert" | "question" | "fail" | "check" | "zzz" | "thinking";

export const EMOTE_SIZE = 12;

const BUBBLE_TOP = ["..oooooooo..", ".okkkkkkkko."];
const BUBBLE_BOTTOM = [".okkkkkkkko.", "..oookkooo..", "....okko....", ".....oo....."];

// Six rows each, set between the bubble's top and bottom.
const GLYPHS: Readonly<Record<EmoteId, readonly (readonly string[])[]>> = {
  alert: [
    ["okkkkiikkkko", "okkkkiikkkko", "okkkkiikkkko", "okkkkiikkkko", "okkkkkkkkkko", "okkkkiikkkko"],
  ],
  question: [
    ["okkkiiiikkko", "okkkkkkiikko", "okkkkkiikkko", "okkkkiikkkko", "okkkkkkkkkko", "okkkkiikkkko"],
  ],
  fail: [
    ["okkiikkiikko", "okkkiiiikkko", "okkkkiikkkko", "okkkiiiikkko", "okkiikkiikko", "okkkkkkkkkko"],
  ],
  check: [
    ["okkkkkkkkiko", "okkkkkkkiiko", "okikkkkiikko", "okiikkiikkko", "okkiiiikkkko", "okkkiikkkkko"],
  ],
  zzz: [
    ["okkkkkkkkkko", "okkiiiikkkko", "okkkkikkkkko", "okkkikkkkkko", "okkiiiikkkko", "okkkkkkkkkko"],
    ["okkkkiiiikko", "okkkkkkikkko", "okkkkkikkkko", "okkkkiiiikko", "okiikkkkkkko", "okkkkkkkkkko"],
  ],
  thinking: [
    ["okkkkkkkkkko", "okkkkkkkkkko", "okiikiikiiko", "okiikiikiiko", "okkkkkkkkkko", "okkkkkkkkkko"],
    ["okkkkkkkkkko", "okiikkkkkkko", "okiikiikiiko", "okkkkiikiiko", "okkkkkkkkkko", "okkkkkkkkkko"],
    ["okkkkkkkkkko", "okkkkiikkkko", "okiikiikiiko", "okiikkkkiiko", "okkkkkkkkkko", "okkkkkkkkkko"],
    ["okkkkkkkkkko", "okkkkkkkiiko", "okiikiikiiko", "okiikiikkkko", "okkkkkkkkkko", "okkkkkkkkkko"],
  ],
};

const FILL: Readonly<Record<EmoteId, readonly [Slot, Slot]>> = {
  alert: ["emoteAlert", "emoteAlertInk"],
  question: ["emoteAlert", "emoteAlertInk"],
  fail: ["emoteFail", "emoteFailInk"],
  check: ["emoteReady", "emoteReadyInk"],
  zzz: ["emoteIdle", "emoteIdleInk"],
  thinking: ["emoteThinking", "emoteThinkingInk"],
};

export const EMOTE_FRAMES = Object.fromEntries(
  Object.entries(GLYPHS).map(([id, frames]) => [id, frames.length]),
) as Readonly<Record<EmoteId, number>>;

/** The tip of the bubble's tail. */
export const EMOTE_ANCHOR: Point = { x: EMOTE_SIZE / 2, y: EMOTE_SIZE };

const cache = new Map<string, Bitmap>();

/** `frame` wraps; frame 0 is the still to show under reduced motion. */
export function emote(id: EmoteId, frame = 0): Bitmap {
  const frames = GLYPHS[id];
  const index = ((frame % frames.length) + frames.length) % frames.length;
  const key = `e:${id}:${index}`;
  let bitmap = cache.get(key);
  if (!bitmap) {
    const [fill, ink] = FILL[id];
    const legend: Legend = { o: "outline", k: fill, i: ink };
    bitmap = { key, anchor: EMOTE_ANCHOR, ...paint([...BUBBLE_TOP, ...frames[index]!, ...BUBBLE_BOTTOM], legend) };
    cache.set(key, bitmap);
  }
  return bitmap;
}
