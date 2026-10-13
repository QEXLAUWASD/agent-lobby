import { blit, paint, row, type Bitmap, type Legend, type Point } from "./grid";

/**
 * Furniture and floor. A tile is 16 x 16; a prop's anchor is its bottom centre, to be put on the
 * bottom centre of the tiles it stands on. Taller props rise above their footprint and overlap
 * whatever is behind them.
 */

export const TILE = 16;

export const PROP_LEGEND: Legend = {
  o: "outline",
  w: "white",
  d: "wood",
  D: "woodShade",
  l: "woodLight",
  m: "metal",
  M: "metalShade",
  n: "metalLight",
  g: "leaf",
  G: "leafShade",
  p: "pot",
  P: "potShade",
  f: "fabric",
  F: "fabricShade",
  u: "fabricLight",
  a: "glass",
  A: "glassShade",
  c: "coffee",
  e: "emoteReady",
  "1": "floor",
  "2": "floorAlt",
  "3": "floorSeam",
  "4": "wall",
  "5": "wallShade",
  "6": "wallTrim",
};

export type ScreenState = "lit" | "off" | "error";
export type PropId = "desk" | "chair" | "plant" | "coffee" | "sofa" | "water" | "envelope";
export type TileId = "floor" | "floorAlt" | "wall" | "wallCap";

/** An office chair seen from behind, one tile. Seated back-view characters carry the same drawing. */
export const CHAIR_ROWS = [
  "................",
  "................",
  "................",
  "....oooooooo....",
  "...ofuuuuuufo...",
  ...Array.from({ length: 6 }, () => "...offffffffo..."),
  "...oFFFFFFFFo...",
  "....oooooooo....",
  "......oMMo......",
  "...ooooMMoooo...",
  "...oMo.oo.oMo...",
];

// Two tiles wide. The top twelve rows are the monitor, which stands above the desk's own tile row.
const DESK_WIDTH = 32;
const DESK_ROWS = [
  ...Array.from({ length: 10 }, () => ".".repeat(DESK_WIDTH)),
  row(["o", 32]),
  row("o", ["l", 30], "o"),
  ...Array.from({ length: 9 }, () => row("o", ["d", 30], "o")),
  row(["o", 32]),
  row("o", ["d", 30], "o"),
  row("o", ["D", 30], "o"),
  row("o", ["D", 30], "o"),
  row("o", ["D", 30], "o"),
  row("oDDo", ["o", 24], "oDDo"),
  row("oooo", [".", 24], "oooo"),
];
const KEYBOARD = ["ooooooooooo", "onMnMnMnMno", "ooooooooooo"];
const MUG = [".ooo..", "occco.", "owwwoo", "owwwoo", ".ooo.."];
const PAPERS = ["oooooo", "owwwwo", "owMMwo", "owwwwo", "owMwwo", "oooooo"];

const MONITOR_FRAME = [
  "oooooooooooooo",
  ...Array.from({ length: 8 }, () => "o............o"),
  "oooooooooooooo",
  "....oMMMMo....",
  "...oMMMMMMo...",
  "...oooooooo...",
];
const MONITOR_LEFT = 9;
const MONITOR_TOP = 2;
/** 12 x 8, drawn inside the monitor frame. `k` is the screen, `K` what it shows. */
const SCREENS: Readonly<Record<ScreenState, readonly (readonly string[])[]>> = {
  lit: [
    [
      "kkkkkkkkkkkk",
      "kKKKKkkkkkkk",
      "kkkkkkkkkkkk",
      "kkKKKKKKkkkk",
      "kkKKKKkkkkkk",
      "kkkkkkkkkkkk",
      "kKKKKKKkkkkk",
      "kkkkkkkkkkkk",
    ],
    [
      "kkkkkkkkkkkk",
      "kkKKKKKKkkkk",
      "kkKKKKkkkkkk",
      "kkkkkkkkkkkk",
      "kKKKKKKkkkkk",
      "kkkkkkkkkkkk",
      "kKKKkkkkkkkk",
      "kkkkkkkkkkkk",
    ],
  ],
  off: [
    [
      "kkkkkkkkkkkk",
      "kkkkkkkkkKkk",
      "kkkkkkkkKkkk",
      "kkkkkkkkkkkk",
      "kkkkkkkkkkkk",
      "kkkkkkkkkkkk",
      "kkkkkkkkkkkk",
      "kkkkkkkkkkkk",
    ],
  ],
  error: [
    [
      "kkkkkkkkkkkk",
      "kkkKKkkKKkkk",
      "kkkkKKKKkkkk",
      "kkkkkKKkkkkk",
      "kkkkKKKKkkkk",
      "kkkKKkkKKkkk",
      "kkkkkkkkkkkk",
      "kkkkkkkkkkkk",
    ],
  ],
};
const SCREEN_LEGEND: Readonly<Record<ScreenState, Legend>> = {
  lit: { k: "screenLit", K: "screenGlow" },
  off: { k: "screenOff", K: "metalShade" },
  error: { k: "screenError", K: "screenErrorInk" },
};

const PLANT_ROWS = [
  "......oo........",
  ".....oggo..oo...",
  "..oo.oggo.oggo..",
  ".oggoogGoogggo..",
  ".ogggogGogGgo...",
  "..ogGggGgGgo.oo.",
  ".oooggGGGgooggo.",
  "oggggogGgogGggo.",
  "ogGGggoGogggGo..",
  ".ooggGgGgGggo...",
  "...oogGGGgoo....",
  ".....ogGgo......",
  "....oooooooo....",
  "...opppppppo....",
  "...oPppppppo....",
  "....opppppo.....",
  "....oPppppo.....",
  "....oPPPPPo.....",
  ".....ooooo......",
];

const COFFEE_ROWS = [
  "..oooooooooooo..",
  "..ommmmmmmmmmo..",
  "..omnnnnnnnnmo..",
  "..omMMMMMMeMmo..",
  "..ommmmmmmmmmo..",
  "..omoooooooomo..",
  "..omMMMooMMMmo..",
  "..omMMMMMMMMmo..",
  "..omMMwccwMMmo..",
  "..omMMwwwwMMmo..",
  "..ommmmmmmmmmo..",
  ".oooooooooooooo.",
  ".ollllllllllllo.",
  ".oooooooooooooo.",
  ".odddddoodddddo.",
  ".odddddoodddddo.",
  ".oddddnoonddddo.",
  ".odddddoodddddo.",
  ".odddddoodddddo.",
  ".oDDDDDooDDDDDo.",
  ".oooooooooooooo.",
];

const WATER_ROWS = [
  ".....oooooo.....",
  "....oaaaaaao....",
  "....oawaaaao....",
  "....oawaaaao....",
  "....oaaaaaao....",
  "....oAAAAAAo....",
  "....oAAAAAAo....",
  ".....oAAAAo.....",
  "....oooooooo....",
  "...onnnnnnnno...",
  "...onnnnnnnmo...",
  "...onaMnnMcmo...",
  "...onnnnnnnmo...",
  "...onMMMMMMmo...",
  "...onnnnnnnmo...",
  "...onnnnnnnmo...",
  "...onnnnnnnmo...",
  "...onnnnnnnmo...",
  "...onnnnnnnmo...",
  "...onnnnnnnmo...",
  "...ommmmmmmmo...",
  "...oooooooooo...",
];

const SOFA_ROWS = [
  row("...", ["o", 26], "..."),
  row("..o", ["u", 26], "o.."),
  ...Array.from({ length: 4 }, () => row("..o", ["f", 12], "FF", ["f", 12], "o..")),
  row("oooo", ["f", 11], "FF", ["f", 11], "oooo"),
  ...Array.from({ length: 3 }, () => row("ouuo", ["f", 11], "FF", ["f", 11], "ouuo")),
  row("offo", ["o", 24], "offo"),
  row("offo", ["u", 24], "offo"),
  ...Array.from({ length: 3 }, () => row("offo", ["f", 11], "FF", ["f", 11], "offo")),
  row("offo", ["F", 24], "offo"),
  row("oFFo", ["o", 24], "oFFo"),
  row("oooo", ["F", 24], "oooo"),
  row(".oMo", ["o", 24], "oMo."),
  row(".ooo", [".", 24], "ooo."),
];

const FLOOR_ROWS = [...Array.from({ length: 15 }, () => row(["1", 15], "3")), row(["3", 16])];
const FLOOR_ALT_ROWS = FLOOR_ROWS.map((line) => line.replace(/1/g, "2"));
const WALL_ROWS = [
  row(["6", 16]),
  row(["5", 16]),
  ...Array.from({ length: 10 }, () => row(["4", 15], "5")),
  row(["5", 16]),
  row(["6", 16]),
  row(["6", 16]),
  row(["o", 16]),
];

// The top of a wall seen from above, for the sides and the bottom of a room.
const WALL_CAP_ROWS = [row(["6", 16]), ...Array.from({ length: 14 }, () => row("6", ["5", 14], "6")), row(["6", 16])];

/** A message in transit, 12 x 9. */
const ENVELOPE_ROWS = [
  "oooooooooooo",
  "owwwwwwwwwwo",
  "oMwwwwwwwwMo",
  "owMMwwwwMMwo",
  "owwwMMMMwwwo",
  "owwwwwwwwwwo",
  "owwwwwwwwwwo",
  "owwwwwwwwwwo",
  "oooooooooooo",
];

export interface PropInfo {
  readonly width: number;
  readonly height: number;
  readonly anchor: Point;
  /** How many tiles wide the prop stands; it is always one tile deep. */
  readonly tilesWide: number;
  readonly frames: number;
}

const bottomCentre = (rows: readonly string[]): Point => ({ x: rows[0]!.length / 2, y: rows.length });

function info(rows: readonly string[], tilesWide: number, frames = 1): PropInfo {
  return {
    width: rows[0]!.length,
    height: rows.length,
    anchor: bottomCentre(rows),
    tilesWide,
    frames,
  };
}

export const PROPS: Readonly<Record<PropId, PropInfo>> = {
  desk: info(DESK_ROWS, 2, SCREENS.lit.length),
  chair: info(CHAIR_ROWS, 1),
  plant: info(PLANT_ROWS, 1),
  coffee: info(COFFEE_ROWS, 1),
  sofa: info(SOFA_ROWS, 2),
  water: info(WATER_ROWS, 1),
  envelope: info(ENVELOPE_ROWS, 1),
};

const STATIC_ROWS: Readonly<Record<Exclude<PropId, "desk">, readonly string[]>> = {
  chair: CHAIR_ROWS,
  plant: PLANT_ROWS,
  coffee: COFFEE_ROWS,
  sofa: SOFA_ROWS,
  water: WATER_ROWS,
  envelope: ENVELOPE_ROWS,
};
const TILE_ROWS: Readonly<Record<TileId, readonly string[]>> = {
  floor: FLOOR_ROWS,
  floorAlt: FLOOR_ALT_ROWS,
  wall: WALL_ROWS,
  wallCap: WALL_CAP_ROWS,
};

function drawDesk(screen: ScreenState, frame: number) {
  const desk = paint(DESK_ROWS, PROP_LEGEND);
  blit(desk, paint(MUG, PROP_LEGEND), 2, 14);
  blit(desk, paint(PAPERS, PROP_LEGEND), 24, 14);
  blit(desk, paint(KEYBOARD, PROP_LEGEND), 10, 17);
  blit(desk, paint(MONITOR_FRAME, PROP_LEGEND), MONITOR_LEFT, MONITOR_TOP);
  blit(desk, paint(SCREENS[screen][frame]!, SCREEN_LEGEND[screen]), MONITOR_LEFT + 1, MONITOR_TOP + 1);
  return desk;
}

const cache = new Map<string, Bitmap>();

function cached(key: string, anchor: Point, draw: () => { width: number; height: number; pixels: Uint8Array }): Bitmap {
  let bitmap = cache.get(key);
  if (!bitmap) {
    bitmap = { key, anchor, ...draw() };
    cache.set(key, bitmap);
  }
  return bitmap;
}

export interface PropOptions {
  /** Desk only: what the monitor shows. Defaults to `off`. */
  readonly screen?: ScreenState;
  /** Desk only: a lit screen has two frames. Wraps. */
  readonly frame?: number;
}

export function prop(id: PropId, options: PropOptions = {}): Bitmap {
  if (id !== "desk") return cached(`p:${id}`, PROPS[id].anchor, () => paint(STATIC_ROWS[id], PROP_LEGEND));
  const screen = options.screen ?? "off";
  const frames = SCREENS[screen].length;
  const frame = (((options.frame ?? 0) % frames) + frames) % frames;
  return cached(`p:desk:${screen}:${frame}`, PROPS.desk.anchor, () => drawDesk(screen, frame));
}

export function tile(id: TileId): Bitmap {
  return cached(`t:${id}`, { x: 0, y: 0 }, () => paint(TILE_ROWS[id], PROP_LEGEND));
}
