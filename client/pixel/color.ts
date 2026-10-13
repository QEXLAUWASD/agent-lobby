import type { Rgba } from "./png";

export const BLACK: Rgba = [0, 0, 0, 255];
export const WHITE: Rgba = [255, 255, 255, 255];
const FALLBACK: Rgba = [128, 128, 128, 255];

const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

/** Reads `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()` and `rgba()`. Anything else is mid grey. */
export function parseColor(input: string): Rgba {
  const text = input.trim().toLowerCase();
  if (text.startsWith("#")) {
    const hex = text.slice(1);
    if (!/^[0-9a-f]+$/.test(hex)) return FALLBACK;
    if (hex.length === 3 || hex.length === 4) {
      const [r, g, b, a = "f"] = hex;
      return [parseInt(r! + r, 16), parseInt(g! + g, 16), parseInt(b! + b, 16), parseInt(a + a, 16)];
    }
    if (hex.length === 6 || hex.length === 8) {
      const part = (at: number) => parseInt(hex.slice(at, at + 2), 16);
      return [part(0), part(2), part(4), hex.length === 8 ? part(6) : 255];
    }
    return FALLBACK;
  }
  const match = /^rgba?\(([^)]+)\)$/.exec(text);
  if (!match) return FALLBACK;
  const parts = match[1]!.split(/[\s,/]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.some(Number.isNaN)) return FALLBACK;
  const alpha = parts[3] === undefined ? 255 : clampByte(parts[3] * 255);
  return [clampByte(parts[0]!), clampByte(parts[1]!), clampByte(parts[2]!), alpha];
}

/** `amount` 0 gives `from`, 1 gives `to`. The result is opaque. */
export function mix(from: Rgba, to: Rgba, amount: number): Rgba {
  const blend = (a: number, b: number) => clampByte(a + (b - a) * amount);
  return [blend(from[0], to[0]), blend(from[1], to[1]), blend(from[2], to[2]), 255];
}

export const darken = (color: Rgba, amount: number) => mix(color, BLACK, amount);
export const lighten = (color: Rgba, amount: number) => mix(color, WHITE, amount);

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance([red, green, blue]: Rgba): number {
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

export function contrast(a: Rgba, b: Rgba): number {
  const [low, high] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (high! + 0.05) / (low! + 0.05);
}

/** Whichever of `options` stands out most against `background`. */
export function readableOn(background: Rgba, options: readonly Rgba[]): Rgba {
  return options.reduce((best, option) =>
    contrast(option, background) > contrast(best, background) ? option : best,
  );
}
