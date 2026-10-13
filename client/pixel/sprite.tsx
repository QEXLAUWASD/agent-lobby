import { memo } from "react";
import { Image, PixelRatio, type ImageStyle, type StyleProp } from "react-native";
import type { Bitmap } from "./grid";
import type { Palette } from "./palette";
import { pngDataUri } from "./png";

const MAX_CACHED = 2048;
const uris = new Map<string, string>();

/**
 * The image for a bitmap in a palette, `pixelScale` real pixels per sprite pixel. Encoded once;
 * the cache drops its oldest entries past `MAX_CACHED`.
 */
export function spriteUri(bitmap: Bitmap, palette: Palette, pixelScale: number): string {
  const key = `${bitmap.key}|${palette.key}|${pixelScale}`;
  let uri = uris.get(key);
  if (uri === undefined) {
    uri = pngDataUri(bitmap.pixels, bitmap.width, bitmap.height, palette.colors, pixelScale);
    if (uris.size >= MAX_CACHED) uris.delete(uris.keys().next().value!);
    uris.set(key, uri);
  }
  return uri;
}

/**
 * Sprite pixels are encoded at the device's resolution, rounded up, and shown at their layout
 * size. An image encoded at layout size is scaled by the platform on any dense screen and blurs.
 */
export function devicePixelScale(scale: number): number {
  return scale * Math.max(1, Math.ceil(PixelRatio.get()));
}

export interface SpriteProps {
  sprite: Bitmap;
  palette: Palette;
  /** Layout pixels per sprite pixel. Keep it a whole number. */
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
