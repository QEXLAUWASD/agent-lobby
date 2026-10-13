import { CHARACTER_FRAMES, character, type CharacterPose, type CharacterSpec } from "./characters";
import { EMOTE_FRAMES, EMOTE_FRAME_MS, emote, type EmoteId } from "./emotes";
import { blit, canvas, type Bitmap, type Point } from "./grid";
import { ICON_FRAMES, ICON_FRAME_MS, icon, type IconState } from "./icons";
import { Lru } from "./lru";
import { SCREEN_FRAMES, prop, type ScreenState } from "./props";

/**
 * Animations as strips: every frame of a loop side by side in one bitmap, so a platform animation
 * that slides the strip a frame at a time can play it with no script running per frame.
 */
export interface Animation {
  /** All frames left to right, each `frameWidth` wide. */
  readonly strip: Bitmap;
  /** Frame 0 alone: the still for reduced motion and for anything not moving. */
  readonly still: Bitmap;
  /** 1 means there is nothing to play: draw `still`. */
  readonly frames: number;
  readonly frameWidth: number;
  readonly frameHeight: number;
  /** A suggested time per frame, in milliseconds; a loop lasts `frames` times this. */
  readonly frameMs: number;
  /** The anchor of one frame, the same as the still's. */
  readonly anchor: Point;
}

export const ANIMATION_MAX_CACHED = 256;
const cache = new Lru<Animation>(ANIMATION_MAX_CACHED);

/** Lays equal-sized frames out as a strip. The same `key` returns the same animation while cached. */
export function animation(key: string, frames: readonly Bitmap[], frameMs: number): Animation {
  let found = cache.get(key);
  if (!found) {
    const still = frames[0];
    if (!still) throw new Error("an animation needs at least one frame");
    const sheet = canvas(still.width * frames.length, still.height);
    frames.forEach((frame, index) => {
      if (frame.width !== still.width || frame.height !== still.height) throw new Error(`frame ${index} of ${key} is a different size`);
      blit(sheet, frame, index * still.width, 0);
    });
    found = {
      strip: frames.length === 1 ? still : { key: `s:${key}`, anchor: still.anchor, ...sheet },
      still,
      frames: frames.length,
      frameWidth: still.width,
      frameHeight: still.height,
      frameMs,
      anchor: still.anchor,
    };
    cache.set(key, found);
  }
  return found;
}

const each = <T>(count: number, make: (frame: number) => T): T[] => Array.from({ length: count }, (_, frame) => make(frame));

/** The list icon for a state, 8 x 8. */
export function stateIcon(state: IconState): Animation {
  return animation(`icon:${state}`, each(ICON_FRAMES[state], (frame) => icon(state, frame)), ICON_FRAME_MS[state]);
}

export const SCREEN_FRAME_MS = 160;

/** The desk with its monitor: a lit screen scrolls code, the others are still. */
export function deskAnimation(screen: ScreenState): Animation {
  return animation(`desk:${screen}`, each(SCREEN_FRAMES[screen], (frame) => prop("desk", { screen, frame })), SCREEN_FRAME_MS);
}

export function emoteAnimation(id: EmoteId): Animation {
  return animation(`emote:${id}`, each(EMOTE_FRAMES[id], (frame) => emote(id, frame)), EMOTE_FRAME_MS[id]);
}

/** A suggested time per frame for each pose, in milliseconds. */
export const POSE_FRAME_MS: Readonly<Record<CharacterPose, number>> = {
  idle: 900,
  walk: 140,
  sit: 220,
  sleep: 1200,
  drink: 600,
  talk: 320,
  stretch: 700,
  doze: 1200,
  lie: 1500,
};

/** A character's pose as a loop. The strip's key is the first frame's, so equal specs share it. */
export function characterAnimation(spec: Omit<CharacterSpec, "frame">): Animation {
  const pose = spec.pose ?? "idle";
  const frames = each(CHARACTER_FRAMES[pose], (frame) => character({ ...spec, frame }));
  return animation(`char:${frames[0]!.key}`, frames, POSE_FRAME_MS[pose]);
}
