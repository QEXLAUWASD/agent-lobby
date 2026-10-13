import { memo } from "react";
import { Image, PixelRatio, type ImageStyle, type StyleProp } from "react-native";
import { bubbleScale } from "./bubble";
import type { Bitmap } from "./grid";
import { Lru } from "./lru";
import type { Palette } from "./palette";
import { pngDataUri } from "./png";
import { crispScale, devicePixels, snap } from "./scale";

/** A theme switch or a new pixel density re-encodes everything on screen; the old images age out. */
export const URI_MAX_ENTRIES = 1024;
export const URI_MAX_CHARS = 6_000_000;
const uris = new Lru<string>(URI_MAX_ENTRIES, URI_MAX_CHARS, (uri) => uri.length);

/**
 * The image for a bitmap in a palette, `pixelScale` real pixels per sprite pixel. Encoded on
 * first use and kept while it is among the most recently used.
 */
export function spriteUri(bitmap: Bitmap, palette: Palette, pixelScale: number): string {
  const key = `${bitmap.key}|${palette.key}|${pixelScale}`;
  let uri = uris.get(key);
  if (uri === undefined) {
    uri = pngDataUri(bitmap.pixels, bitmap.width, bitmap.height, palette.colors, pixelScale);
    uris.set(key, uri);
  }
  return uri;
}

/**
 * Sprite pixels are encoded at device resolution and shown at their layout size. An image encoded
 * at layout size is scaled by the platform on any dense screen and blurs. `scale` should come from
 * `crispScale`; any other value is drawn at the nearest whole number of device pixels and resampled.
 */
export function devicePixelScale(scale: number): number {
  return devicePixels(scale, PixelRatio.get());
}

/** `crispScale` and `snap` for this device. */
export const deviceCrispScale = (target: number, round?: "down" | "up" | "nearest") =>
  crispScale(target, PixelRatio.get(), round);
export const deviceSnap = (value: number) => snap(value, PixelRatio.get());
export const deviceBubbleScale = () => bubbleScale(PixelRatio.get());

export interface SpriteProps {
  sprite: Bitmap;
  palette: Palette;
  /** Layout pixels per art pixel. Take it from `crispScale`; fractions are fine on dense screens. */
  scale?: number;
  style?: StyleProp<ImageStyle>;
}

/** One sprite, one node. It holds no state and never animates: the caller picks the frame. */
export const Sprite = memo(function Sprite({ sprite, palette, scale = 1, style }: SpriteProps) {
  const size = { width: sprite.width * scale, height: sprite.height * scale };
  return (
    <Image
      accessible={false}
      fadeDuration={0}
      source={{ uri: spriteUri(sprite, palette, devicePixelScale(scale)), ...size }}
      style={[size, style]}
    />
  );
});

/** Absolute position that puts the sprite's anchor at (`x`, `y`), in layout pixels. */
export function anchored(sprite: Bitmap, scale: number, x: number, y: number): ImageStyle {
  return { position: "absolute", left: x - sprite.anchor.x * scale, top: y - sprite.anchor.y * scale };
}
