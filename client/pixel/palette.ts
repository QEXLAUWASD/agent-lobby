import type { PluginTheme } from "@getpaseo/plugin";
import { BLACK, WHITE, darken, lighten, luminance, mix, parseColor, readableOn } from "./color";
import type { Rgba } from "./png";

/**
 * Every sprite is drawn in palette slots, never in colours. Slot order is fixed, so a sprite's
 * pixels do not depend on the theme: only the palette handed to the encoder does.
 */

const SKINS = ["#f6d3b3", "#e8b98f", "#c98f62", "#9a6541", "#6b4429"] as const;
const HAIRS = ["#2b2330", "#5a3825", "#a5632a", "#d9a441", "#b9422f", "#8d95a3"] as const;
const SHIRTS = [
  "#4a86c7",
  "#d2603f",
  "#4f9d6b",
  "#8a63c4",
  "#d9a13b",
  "#3fa3a8",
  "#c9588f",
  "#7b8794",
] as const;
const PANTS = ["#39445f", "#4b4038", "#2f4a45"] as const;

export const SKIN_COUNT = SKINS.length;
export const HAIR_COUNT = HAIRS.length;
export const SHIRT_COUNT = SHIRTS.length;
export const PANTS_COUNT = PANTS.length;

type Indexed<Name extends string, Count extends number> = `${Name}${Count}`;
type SkinIndex = 0 | 1 | 2 | 3 | 4;
type HairIndex = 0 | 1 | 2 | 3 | 4 | 5;
type ShirtIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
type PantsIndex = 0 | 1 | 2;

const FIXED_SLOTS = [
  "transparent",
  "outline",
  "white",
  "shoes",
  "hat",
  "hatBand",
  "cape",
  "capeShade",
  "headset",
  "headsetLight",
  "earInner",
  "floor",
  "floorAlt",
  "floorSeam",
  "wall",
  "wallShade",
  "wallTrim",
  "wood",
  "woodShade",
  "woodLight",
  "metal",
  "metalShade",
  "metalLight",
  "screenLit",
  "screenGlow",
  "screenOff",
  "screenError",
  "screenErrorInk",
  "leaf",
  "leafShade",
  "pot",
  "potShade",
  "fabric",
  "fabricShade",
  "fabricLight",
  "glass",
  "glassShade",
  "coffee",
  "emoteAlert",
  "emoteAlertInk",
  "emoteFail",
  "emoteFailInk",
  "emoteReady",
  "emoteReadyInk",
  "emoteIdle",
  "emoteIdleInk",
  "emoteThinking",
  "emoteThinkingInk",
  "carpet",
  "carpetShade",
  "kitchen",
  "kitchenAlt",
  "partition",
  "partitionShade",
  "partitionLight",
  "pod0",
  "pod0Shade",
  "pod1",
  "pod1Shade",
  "pod2",
  "pod2Shade",
  "pod3",
  "pod3Shade",
] as const;

export type Slot =
  | (typeof FIXED_SLOTS)[number]
  | Indexed<"skin" | "skinShade", SkinIndex>
  | Indexed<"hair" | "hairShade", HairIndex>
  | Indexed<"shirt" | "shirtShade", ShirtIndex>
  | Indexed<"pants", PantsIndex>;

const numbered = (name: string, count: number) => Array.from({ length: count }, (_, index) => `${name}${index}`);

export const SLOTS = [
  ...FIXED_SLOTS,
  ...numbered("skin", SKIN_COUNT),
  ...numbered("skinShade", SKIN_COUNT),
  ...numbered("hair", HAIR_COUNT),
  ...numbered("hairShade", HAIR_COUNT),
  ...numbered("shirt", SHIRT_COUNT),
  ...numbered("shirtShade", SHIRT_COUNT),
  ...numbered("pants", PANTS_COUNT),
] as readonly Slot[];

const SLOT_INDEX = new Map(SLOTS.map((slot, index) => [slot, index]));

export function slotIndex(slot: Slot): number {
  const index = SLOT_INDEX.get(slot);
  if (index === undefined) throw new Error(`unknown palette slot ${slot}`);
  return index;
}

export interface Palette {
  /** Changes whenever a colour does; part of the image cache key. */
  readonly key: string;
  readonly dark: boolean;
  /** One colour per entry of `SLOTS`, in that order. */
  readonly colors: readonly Rgba[];
}

export function paletteColor(palette: Palette, slot: Slot): Rgba {
  return palette.colors[slotIndex(slot)]!;
}

const INK: Rgba = [24, 22, 28, 255];
const PAPER: Rgba = [250, 248, 244, 255];

function build(theme: PluginTheme): Palette {
  const read = (name: keyof PluginTheme["colors"]) => {
    const [red, green, blue] = parseColor(theme.colors[name]);
    return [red, green, blue, 255] as Rgba;
  };
  const surface0 = read("surface0");
  const surface1 = read("surface1");
  const surface2 = read("surface2");
  const foreground = read("foreground");
  const muted = read("foregroundMuted");
  const accent = read("accent");
  const dark = luminance(surface0) < 0.2;

  // The room is made of the theme's own surfaces, so it sits in the pane instead of on it.
  const outline = dark ? darken(surface0, 0.55) : mix(INK, foreground, 0.5);
  // Fixed hues (wood, leaves, skin) are pulled a little toward the surface so they share its cast.
  const tint = (hex: string, towards = 0.12) => mix(parseColor(hex), surface1, dark ? towards + 0.1 : towards);
  const wood = tint(dark ? "#8a6444" : "#c79a6c");
  const metal = mix(muted, surface2, 0.45);
  const fabric = mix(accent, surface2, dark ? 0.45 : 0.35);
  const leaf = tint(dark ? "#3f8a54" : "#55a868");
  const pot = tint("#c0693f");
  const glass = tint("#8fd0f0");
  const status = {
    emoteAlert: read("statusWarning"),
    emoteFail: read("statusDanger"),
    emoteReady: read("statusSuccess"),
    emoteIdle: mix(muted, surface2, 0.25),
    emoteThinking: accent,
  };
  const inkOn = (color: Rgba) => readableOn(color, [INK, PAPER]);

  const colors: Record<string, Rgba> = {
    transparent: [0, 0, 0, 0],
    outline,
    white: dark ? mix(PAPER, surface0, 0.08) : PAPER,
    shoes: mix(INK, surface2, 0.18),
    hat: tint("#33457a", 0.04),
    hatBand: tint("#e6b83f", 0.04),
    cape: tint("#8f3046", 0.04),
    capeShade: darken(tint("#8f3046", 0.04), 0.28),
    headset: tint("#39414f", 0.04),
    headsetLight: tint("#35d0c0", 0.02),
    earInner: tint("#f3a6bb", 0.04),
    floor: surface1,
    floorAlt: mix(surface1, foreground, 0.025),
    floorSeam: mix(surface1, foreground, 0.06),
    wall: mix(surface2, foreground, 0.12),
    wallShade: mix(surface2, foreground, 0.24),
    wallTrim: mix(surface2, foreground, 0.42),
    wood,
    woodShade: darken(wood, 0.24),
    woodLight: lighten(wood, 0.2),
    metal,
    metalShade: mix(metal, outline, 0.4),
    metalLight: mix(metal, WHITE, dark ? 0.25 : 0.55),
    screenLit: accent,
    screenGlow: lighten(accent, 0.55),
    screenOff: mix(outline, metal, 0.22),
    screenError: status.emoteFail,
    screenErrorInk: inkOn(status.emoteFail),
    leaf,
    leafShade: darken(leaf, 0.28),
    pot,
    potShade: darken(pot, 0.25),
    fabric,
    fabricShade: mix(fabric, BLACK, 0.22),
    fabricLight: mix(fabric, WHITE, 0.2),
    glass,
    glassShade: darken(glass, 0.22),
    coffee: tint("#5b3a26", 0.04),
    ...status,
    emoteAlertInk: inkOn(status.emoteAlert),
    emoteFailInk: inkOn(status.emoteFail),
    emoteReadyInk: inkOn(status.emoteReady),
    emoteIdleInk: inkOn(status.emoteIdle),
    emoteThinkingInk: inkOn(status.emoteThinking),
    // Zone floors stay close to the plain floor: enough to mark a zone, not enough to fight it.
    carpet: mix(surface1, fabric, 0.22),
    carpetShade: mix(surface1, fabric, 0.34),
    kitchen: mix(surface1, glass, 0.12),
    kitchenAlt: mix(mix(surface1, glass, 0.12), foreground, 0.07),
    // Room dividers lean well toward the text colour, so they stand off the floor on either theme.
    partition: mix(surface1, foreground, 0.6),
    partitionShade: mix(surface1, foreground, 0.72),
    partitionLight: mix(surface1, foreground, 0.46),
  };
  // Pod floors: four quiet tints of the plain floor, told apart by their weave as much as their hue.
  ["#6f9fd8", "#d8a64f", "#a884d0", "#58b8a6"].forEach((hex, index) => {
    colors[`pod${index}`] = mix(surface1, parseColor(hex), dark ? 0.14 : 0.16);
    colors[`pod${index}Shade`] = mix(surface1, parseColor(hex), dark ? 0.3 : 0.36);
  });
  SKINS.forEach((hex, index) => {
    colors[`skin${index}`] = parseColor(hex);
    colors[`skinShade${index}`] = darken(parseColor(hex), 0.18);
  });
  HAIRS.forEach((hex, index) => {
    colors[`hair${index}`] = parseColor(hex);
    colors[`hairShade${index}`] = darken(parseColor(hex), 0.3);
  });
  SHIRTS.forEach((hex, index) => {
    colors[`shirt${index}`] = parseColor(hex);
    colors[`shirtShade${index}`] = darken(parseColor(hex), 0.22);
  });
  PANTS.forEach((hex, index) => {
    colors[`pants${index}`] = parseColor(hex);
  });

  const ordered = SLOTS.map((slot) => colors[slot]!);
  const key = hash(ordered.map((color) => color.join(".")).join("|")).toString(36);
  return { key, dark, colors: ordered };
}

const cache = new WeakMap<PluginTheme, Palette>();

/** The office palette for a Paseo theme. Stable for a given theme object. */
export function officePalette(theme: PluginTheme): Palette {
  let palette = cache.get(theme);
  if (!palette) {
    palette = build(theme);
    cache.set(theme, palette);
  }
  return palette;
}

export interface CharacterLook {
  readonly skin: number;
  readonly hair: number;
  readonly hairStyle: number;
  readonly shirt: number;
  readonly pants: number;
}

export const HAIR_STYLE_COUNT = 3;

function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193);
  }
  // Avalanche, so ids that differ in one character do not share most of their look.
  value ^= value >>> 16;
  value = Math.imul(value, 0x85ebca6b);
  value ^= value >>> 13;
  value = Math.imul(value, 0xc2b2ae35);
  value ^= value >>> 16;
  return value >>> 0;
}

/** The same id always gets the same person. */
export function lookFor(agentId: string): CharacterLook {
  const seed = hash(agentId);
  const other = hash(`${agentId}/look`);
  return {
    skin: seed % SKIN_COUNT,
    hair: (seed >>> 8) % HAIR_COUNT,
    hairStyle: (seed >>> 16) % HAIR_STYLE_COUNT,
    shirt: other % SHIRT_COUNT,
    pants: (other >>> 8) % PANTS_COUNT,
  };
}
