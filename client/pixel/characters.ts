import { blit, canvas, mirror, paint, type Bitmap, type Canvas, type Legend } from "./grid";
import { Lru } from "./lru";
import type { CharacterLook, Slot } from "./palette";
import { CHAIR_ROWS, PROP_LEGEND } from "./props";

/**
 * People, 16 x 24, feet on the bottom row (lying down, 24 x 16). A character is composed from layers (cape or tail,
 * body, chair back, head, headgear), so every role shares one body and every pose shares one head.
 *
 * Legend: o outline, s/S skin, h/H hair, t/T shirt, p pants, b shoes,
 * a/A the role's gear colours, c/C cape.
 */

export type CharacterRole = "overseer" | "nexus" | "meow" | "agent";
/** `sit` facing up is the back view at a desk, and its two frames are typing. */
export type CharacterPose =
  | "idle"
  | "walk"
  | "sit"
  | "sleep"
  /** Standing with a cup; frame 1 lifts it to the mouth. */
  | "drink"
  /** Standing; frame 1 opens the mouth and moves a hand. */
  | "talk"
  /** Standing; frame 1 has both arms up. */
  | "stretch"
  /** Seated facing the viewer with eyes shut, head nodding. */
  | "doze"
  /** Lying asleep, drawn sideways: this pose alone is 24 x 16. */
  | "lie";
export type Facing = "down" | "up" | "left" | "right";

export const CHARACTER_WIDTH = 16;
export const CHARACTER_HEIGHT = 24;
export const CHARACTER_FRAMES: Readonly<Record<CharacterPose, number>> = {
  idle: 2,
  walk: 4,
  sit: 2,
  sleep: 2,
  drink: 2,
  talk: 2,
  stretch: 2,
  doze: 2,
  lie: 2,
};

export interface CharacterSpec {
  readonly role: CharacterRole;
  readonly look: CharacterLook;
  readonly pose?: CharacterPose;
  readonly facing?: Facing;
  /** Something in the hand. Shown from the front and the sides, not from behind. */
  readonly carry?: "cup" | "book" | null;
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

const CUP = ["oooo", "occo", "owwo", "oooo"];
const CUP_LEFT = 11;
const BOOK = ["ooooooo", "owwowwo", "owwowwo", "ooooooo"];
const BOOK_LEFT = 5;
// Drinking: the right arm leaves the side and comes up beside the face, cup at the mouth.
const TORSO_DRINK = [
  "...otttttttto...",
  "..otTttttttTo...",
  "..otTttttttTo...",
  "..osTttttttTo...",
  "..ootttttttto...",
];
const ARM_RAISED = ["oo", "to", "to", "to"];
const TORSO_ARMLESS = [
  "...otttttttto...",
  "...oTttttttTo...",
  "...oTttttttTo...",
  "...oTttttttTo...",
  "...otttttttto...",
];
// Rows 5 to 13: both arms straight up past the head.
const ARMS_UP = [
  ".oo..........oo.",
  "oso..........oso",
  "oto..........oto",
  "oto..........oto",
  "oto..........oto",
  "oto..........oto",
  "oto..........oto",
  ".oto........oto.",
  "..oto......oto..",
];
const ARMS_UP_TOP = 5;
const EYES_SHUT: readonly Patch[] = [
  [6, 8, "s"],
  [9, 8, "s"],
  [5, 9, "o"],
  [10, 9, "o"],
];
const EYES_SHUT_SIDE: readonly Patch[] = [
  [8, 8, "s"],
  [11, 8, "s"],
  [7, 9, "o"],
];

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
  ".........oAAo...",
  ".........oAAo...",
  "..........oo....",
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
  eyesShut: boolean,
): Canvas {
  const view = facing === "up" || facing === "down" ? facing : "side";
  const base = view === "up" ? HEAD_UP : view === "down" ? HEAD_DOWN : HEAD_RIGHT;
  const hair = HAIR_STYLES[look.hairStyle % HAIR_STYLES.length]![view];
  const eyes = !eyesShut ? [] : view === "down" ? EYES_SHUT : view === "side" ? EYES_SHUT_SIDE : [];
  const head = paint(patched(base, [...hair, ...eyes]), legend);
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
  return head;
}

/** Draws one frame facing down, up or right. Left is the mirror of right, done by the caller. */
function compose(spec: Required<CharacterSpec>, eyesShut = false): Canvas {
  const { role, look, pose, frame } = spec;
  const seated = pose === "sit" || pose === "sleep" || pose === "doze";
  // Seated characters face the desk or the viewer; asleep at a desk is always slumped toward it.
  const facing: Facing =
    pose === "sleep"
      ? "up"
      : pose === "doze" || (seated && spec.facing !== "up") || (pose === "stretch" && spec.facing !== "up")
        ? "down"
        : spec.facing;
  const back = facing === "up";
  const legend = legendFor(look, role);
  const out = canvas(CHARACTER_WIDTH, CHARACTER_HEIGHT);
  const drop = seated ? SEATED_DROP : 0;
  const acting = frame === 1 && !back;

  const backItem = role === "overseer" ? CAPE : role === "meow" ? TAIL : null;
  const drawBackItem = () => {
    if (backItem) blit(out, paint(backItem, legend), 0, BACK_ITEM_TOP[role] + drop);
  };

  let torso = TORSO_IDLE;
  let legs = seated ? LEGS_SEATED : LEGS_IDLE;
  let flip = false;
  let headDrop = drop;
  if (pose === "walk") {
    const step = frame % 4;
    if (step === 0 || step === 2) {
      torso = TORSO_WALK;
      legs = LEGS_STEP;
      flip = step === 2;
    } else {
      headDrop += 1;
    }
  } else if (pose === "sit" && back) {
    torso = frame === 0 ? TORSO_TYPE_OUT : TORSO_TYPE_IN;
  } else if (pose === "sleep") {
    headDrop += 3 + frame;
  } else if (pose === "doze") {
    headDrop += 1 + frame;
  } else if (pose === "drink") {
    if (acting) torso = TORSO_DRINK;
  } else if (pose === "talk") {
    if (acting) torso = TORSO_WALK;
    else headDrop += back ? frame : 0;
  } else if (pose === "stretch") {
    if (frame === 1) torso = TORSO_ARMLESS;
  } else {
    headDrop += frame;
  }

  if (!back) drawBackItem();
  const body = canvas(CHARACTER_WIDTH, CHARACTER_HEIGHT);
  blit(body, paint(legs, legend), 0, CHARACTER_HEIGHT - legs.length);
  blit(body, paint(torso, legend), 0, TORSO_TOP + drop);
  blit(out, flip ? mirror(body) : body);
  if (back) drawBackItem();
  const cup = spec.carry === "cup" || pose === "drink";
  const sipping = pose === "drink" && acting;
  if (cup && !back && !sipping) blit(out, paint(CUP, PROP_LEGEND), CUP_LEFT, TORSO_TOP + 1 + drop);
  if (spec.carry === "book" && !back && pose !== "drink") {
    blit(out, paint(BOOK, PROP_LEGEND), BOOK_LEFT, TORSO_TOP + 1 + drop);
  }
  if (seated && back) blit(out, paint(CHAIR_ROWS, PROP_LEGEND), 0, CHARACTER_HEIGHT - CHAIR_ROWS.length);
  blit(out, headCanvas(facing, look, role, legend, eyesShut || pose === "doze"), 0, headDrop);
  if (sipping) {
    blit(out, paint(ARM_RAISED, legend), 12, 10);
    blit(out, paint(CUP, PROP_LEGEND), 8, 9);
  }
  if (pose === "talk" && acting) blit(out, paint(["oo"], legend), facing === "down" ? 7 : 9, 10 + headDrop);
  if (pose === "stretch" && frame === 1) blit(out, paint(ARMS_UP, legend), 0, ARMS_UP_TOP);
  return out;
}

export const LYING_WIDTH = CHARACTER_HEIGHT;
export const LYING_HEIGHT = CHARACTER_WIDTH;

/** Turns a standing figure a quarter turn, head to the left. */
function laidDown(standing: Canvas): Canvas {
  const out = canvas(LYING_WIDTH, LYING_HEIGHT);
  for (let y = 0; y < standing.height; y++) {
    for (let x = 0; x < standing.width; x++) {
      out.pixels[(standing.width - 1 - x) * LYING_WIDTH + y] = standing.pixels[y * standing.width + x]!;
    }
  }
  return out;
}

function draw(spec: Required<CharacterSpec>): Canvas {
  if (spec.pose === "lie") return laidDown(compose({ ...spec, pose: "idle", facing: "down", carry: null }, true));
  return spec.facing === "left" ? mirror(compose({ ...spec, facing: "right" })) : compose(spec);
}

/** Looks times roles times frames runs to hundreds of thousands of drawings; keep the recent ones. */
export const CHARACTER_MAX_CACHED = 1024;
const cache = new Lru<Bitmap>(CHARACTER_MAX_CACHED);

/** The drawing for one character in one pose. While it is cached, the same spec returns the same object. */
export function character(spec: CharacterSpec): Bitmap {
  const pose = spec.pose ?? "idle";
  const frames = CHARACTER_FRAMES[pose];
  const frame = (((spec.frame ?? 0) % frames) + frames) % frames;
  const carry = spec.carry ?? null;
  const full = { role: spec.role, look: spec.look, pose, facing: spec.facing ?? "down", frame, carry };
  const { skin, hair, hairStyle, shirt, pants } = spec.look;
  const key = `c:${full.role}:${pose}:${full.facing}:${frame}:${skin}.${hair}.${hairStyle}.${shirt}.${pants}:${carry ?? ""}`;
  let bitmap = cache.get(key);
  if (!bitmap) {
    const drawn = draw(full);
    bitmap = { key, ...drawn, anchor: { x: drawn.width / 2, y: drawn.height } };
    cache.set(key, bitmap);
  }
  return bitmap;
}
