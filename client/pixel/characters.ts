import { blit, canvas, mirror, paint, type Bitmap, type Canvas, type Legend } from "./grid";
import { Lru } from "./lru";
import type { CharacterLook, Slot } from "./palette";
import { CHAIR_ROWS, PROP_LEGEND } from "./props";

/**
 * People, 16 x 24, feet on the bottom row. A character is composed from layers (cape or tail,
 * body, chair back, head, headgear), so every role shares one body and every pose shares one head.
 *
 * Legend: o outline, s/S skin, h/H hair, t/T shirt, p pants, b shoes,
 * a/A the role's gear colours, c/C cape.
 */

export type CharacterRole = "overseer" | "nexus" | "meow" | "agent";
/** `sit` facing up is the back view at a desk, and its two frames are typing. */
export type CharacterPose = "idle" | "walk" | "sit" | "sleep";
export type Facing = "down" | "up" | "left" | "right";

export const CHARACTER_WIDTH = 16;
export const CHARACTER_HEIGHT = 24;
export const CHARACTER_FRAMES: Readonly<Record<CharacterPose, number>> = { idle: 2, walk: 4, sit: 2, sleep: 2 };

export interface CharacterSpec {
  readonly role: CharacterRole;
  readonly look: CharacterLook;
  readonly pose?: CharacterPose;
  readonly facing?: Facing;
  /** Any integer; wraps at the pose's frame count. Frame 0 is the still to show under reduced motion. */
  readonly frame?: number;
}

// Rows 0 to 12. Rows 0 to 2 stay empty for headgear.
const HEAD_DOWN = [
  "................",
  "................",
  "................",
  "....oooooooo....",
  "...ohhhhhhhho...",
  "...ohhhhhhhho...",
  "...ohhsssshho...",
  "...ohssssssho...",
  "...ossossosso...",
  "...ossossosso...",
  "...osssssssso...",
  "...oSssssssSo...",
  "....oooooooo....",
];
const HEAD_RIGHT = [
  "................",
  "................",
  "................",
  "....oooooooo....",
  "...ohhhhhhhho...",
  "...ohhhhhhhho...",
  "...ohhhhhssso...",
  "...ohhhssssso...",
  "...ohhssossoo...",
  "...ohsssossoo...",
  "...ohssssssso...",
  "...oSssssssso...",
  "....oooooooo....",
];
const HEAD_UP = [
  "................",
  "................",
  "................",
  "....oooooooo....",
  "...ohhhhhhhho...",
  "...ohhhhhhhho...",
  "...ohhhhhhhho...",
  "...ohhhhhhhho...",
  "...ohhhhhhhho...",
  "...ohhhhhhhho...",
  "...oHhhhhhhHo...",
  "...ossHHHHsso...",
  "....oooooooo....",
];
type Patch = readonly [x: number, y: number, char: string];

const LONG_HAIR: readonly Patch[] = [
  ...[6, 7, 8, 9, 10, 11].flatMap((y): Patch[] => [
    [4, y, "h"],
    [11, y, "h"],
  ]),
  ...[12, 13].flatMap((y): Patch[] => [
    [3, y, "o"],
    [4, y, "h"],
    [5, y, "o"],
    [10, y, "o"],
    [11, y, "h"],
    [12, y, "o"],
  ]),
];
const FRINGE: readonly Patch[] = [
  [6, 6, "h"],
  [7, 6, "h"],
  [8, 6, "h"],
  [5, 7, "h"],
  [6, 7, "h"],
  [9, 6, "H"],
  [7, 7, "H"],
];

/**
 * Hair styles are small edits to the head, so they survive under a hat or a headset. The side
 * view (drawn facing right) keeps only what does not cover the face.
 */
const HAIR_STYLES: readonly Readonly<Record<"down" | "up" | "side", readonly Patch[]>>[] = [
  { down: [], up: [], side: [] },
  { down: LONG_HAIR, up: LONG_HAIR, side: LONG_HAIR.filter(([x]) => x <= 5) },
  { down: FRINGE, up: [], side: [] },
];

const TORSO_IDLE = [
  "...otttttttto...",
  "..otTttttttTto..",
  "..otTttttttTto..",
  "..osTttttttTso..",
  "..oottttttttoo..",
];
const TORSO_WALK = [
  "...otttttttto...",
  "..otTttttttTto..",
  "..otTttttttTso..",
  "..osTttttttToo..",
  "..oottttttttto..",
];
// Back view at a keyboard: forearms are out of sight, the elbows move.
const TORSO_TYPE_OUT = [
  "...otttttttto...",
  ".ottTttttttTtto.",
  ".ootTttttttTtoo.",
  "...oTttttttTo...",
  "...otttttttto...",
];
const TORSO_TYPE_IN = [
  "...otttttttto...",
  "..otTttttttTto..",
  "..ooTttttttToo..",
  "...oTttttttTo...",
  "...otttttttto...",
];
const LEGS_IDLE = [
  "...oppppppppo...",
  "...oppppppppo...",
  "...opppoopppo...",
  "...opppoopppo...",
  "...obbboobbbo...",
  "...oooooooooo...",
];
const LEGS_STEP = [
  "...oppppppppo...",
  "...oppppppppo...",
  "...opppoopppo...",
  "...opppoobbbo...",
  "...obbboooooo...",
  "...ooooo........",
];
const LEGS_SEATED = ["...oppppppppo...", "...opppoopppo...", "...obbboobbbo...", "...oooooooooo..."];

const TORSO_TOP = 13;
const SEATED_DROP = 2;

const CAPE = [
  "..occcccccccco..",
  ".occcccccccccco.",
  ".occCccccccCcco.",
  ".occCccccccCcco.",
  ".occCccccccCcco.",
  ".occCccccccCcco.",
  ".occCccccccCcco.",
  ".oCCCCCCCCCCCCo.",
  ".oooooooooooooo.",
];
const TAIL = [
  "..............o.",
  ".............oao",
  ".............oao",
  "............oao.",
  "...........oao..",
  "...........oo...",
];
const BACK_ITEM_TOP: Readonly<Record<CharacterRole, number>> = { overseer: 13, meow: 15, nexus: 0, agent: 0 };

const HAT = [
  "................",
  ".....oooooo.....",
  "....oaaaaaao....",
  "....oaaaaaao....",
  ".ooooAAAAAAoooo.",
  ".oaaaaaaaaaaaao.",
  "..oooooooooooo..",
];
const HEADSET_FRONT = [
  "..........oAo...",
  "..........oAo...",
  "...........o....",
  "....oooooooo....",
  "...oaaaaaaaao...",
  "................",
  "................",
  "..oa........ao..",
  "..oa........ao..",
  "..oa........ao..",
  "..........Aaa...",
];
const HEADSET_BACK = HEADSET_FRONT.slice(0, 10);
const EARS = [
  "....o......o....",
  "...oao....oao...",
  "...oaAo..oAao...",
  "...oaaaooaaao...",
];
const EARS_BACK = EARS.map((line) => line.replace(/A/g, "a"));

function legendFor(look: CharacterLook, role: CharacterRole): Legend {
  const gear: Record<CharacterRole, readonly [Slot, Slot]> = {
    overseer: ["hat", "hatBand"],
    nexus: ["headset", "headsetLight"],
    meow: [`hair${look.hair}` as Slot, "earInner"],
    agent: ["outline", "outline"],
  };
  return {
    o: "outline",
    s: `skin${look.skin}` as Slot,
    S: `skinShade${look.skin}` as Slot,
    h: `hair${look.hair}` as Slot,
    H: `hairShade${look.hair}` as Slot,
    t: `shirt${look.shirt}` as Slot,
    T: `shirtShade${look.shirt}` as Slot,
    p: `pants${look.pants}` as Slot,
    b: "shoes",
    a: gear[role][0],
    A: gear[role][1],
    c: "cape",
    C: "capeShade",
  };
}

function patched(rows: readonly string[], patches: readonly Patch[]): string[] {
  const out = rows.map((line) => line.split(""));
  for (const [x, y, char] of patches) {
    while (out.length <= y) out.push(".".repeat(CHARACTER_WIDTH).split(""));
    out[y]![x] = char;
  }
  return out.map((line) => line.join(""));
}

function headCanvas(
  facing: Facing,
  look: CharacterLook,
  role: CharacterRole,
  legend: Legend,
): Canvas {
  const view = facing === "up" || facing === "down" ? facing : "side";
  const base = view === "up" ? HEAD_UP : view === "down" ? HEAD_DOWN : HEAD_RIGHT;
  const hair = HAIR_STYLES[look.hairStyle % HAIR_STYLES.length]![view];
  const head = paint(patched(base, hair), legend);
  const gear =
    role === "overseer"
      ? HAT
      : role === "nexus"
        ? facing === "up"
          ? HEADSET_BACK
          : HEADSET_FRONT
        : role === "meow"
          ? facing === "up"
            ? EARS_BACK
            : EARS
          : null;
  if (gear) blit(head, paint(gear, legend));
  return facing === "left" ? mirror(head) : head;
}

function compose(spec: Required<CharacterSpec>): Canvas {
  const { role, look } = spec;
  const seated = spec.pose === "sit" || spec.pose === "sleep";
  // Seated characters face the desk or the viewer; asleep is always slumped toward the desk.
  const facing: Facing = spec.pose === "sleep" ? "up" : seated && spec.facing !== "up" ? "down" : spec.facing;
  const back = facing === "up";
  const legend = legendFor(look, role);
  const out = canvas(CHARACTER_WIDTH, CHARACTER_HEIGHT);
  const drop = seated ? SEATED_DROP : 0;

  const backItem = role === "overseer" ? CAPE : role === "meow" ? TAIL : null;
  const drawBackItem = () => {
    if (backItem) blit(out, paint(backItem, legend), 0, BACK_ITEM_TOP[role] + drop);
  };

  let torso = TORSO_IDLE;
  let legs = seated ? LEGS_SEATED : LEGS_IDLE;
  let flip = false;
  let headDrop = drop;
  if (spec.pose === "walk") {
    const step = spec.frame % 4;
    if (step === 0 || step === 2) {
      torso = TORSO_WALK;
      legs = LEGS_STEP;
      flip = step === 2;
    } else {
      headDrop += 1;
    }
  } else if (spec.pose === "sit" && back) {
    torso = spec.frame === 0 ? TORSO_TYPE_OUT : TORSO_TYPE_IN;
  } else if (spec.pose === "sleep") {
    headDrop += 3 + spec.frame;
  } else {
    headDrop += spec.frame;
  }

  if (!back) drawBackItem();
  const body = canvas(CHARACTER_WIDTH, CHARACTER_HEIGHT);
  blit(body, paint(legs, legend), 0, CHARACTER_HEIGHT - legs.length);
  blit(body, paint(torso, legend), 0, TORSO_TOP + drop);
  blit(out, flip ? mirror(body) : body);
  if (back) drawBackItem();
  if (seated && back) blit(out, paint(CHAIR_ROWS, PROP_LEGEND), 0, CHARACTER_HEIGHT - CHAIR_ROWS.length);
  blit(out, headCanvas(facing, look, role, legend), 0, headDrop);
  return out;
}

/** Looks times roles times frames runs to hundreds of thousands of drawings; keep the recent ones. */
export const CHARACTER_MAX_CACHED = 1024;
const cache = new Lru<Bitmap>(CHARACTER_MAX_CACHED);

/** The drawing for one character in one pose. While it is cached, the same spec returns the same object. */
export function character(spec: CharacterSpec): Bitmap {
  const pose = spec.pose ?? "idle";
  const frames = CHARACTER_FRAMES[pose];
  const frame = (((spec.frame ?? 0) % frames) + frames) % frames;
  const full = { role: spec.role, look: spec.look, pose, facing: spec.facing ?? "down", frame };
  const { skin, hair, hairStyle, shirt, pants } = spec.look;
  const key = `c:${full.role}:${pose}:${full.facing}:${frame}:${skin}.${hair}.${hairStyle}.${shirt}.${pants}`;
  let bitmap = cache.get(key);
  if (!bitmap) {
    const drawn = compose(full);
    bitmap = { key, ...drawn, anchor: { x: CHARACTER_WIDTH / 2, y: CHARACTER_HEIGHT } };
    cache.set(key, bitmap);
  }
  return bitmap;
}
