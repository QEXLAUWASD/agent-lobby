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
  "7": "carpet",
  "8": "carpetShade",
  "9": "kitchen",
  "0": "kitchenAlt",
  q: "partition",
  Q: "partitionShade",
};

export type ScreenState = "lit" | "off" | "error";
export type PropId =
  | "desk"
  | "chair"
  | "plant"
  | "coffee"
  | "sofa"
  | "water"
  | "envelope"
  | "fridge"
  | "counter"
  | "table"
  | "bookshelf"
  | "lowTable"
  | "beanbag"
  | "rug";
export type TileId =
  | "floor"
  | "floorAlt"
  | "wall"
  | "wallCap"
  | "carpet"
  | "kitchen"
  | "partition"
  | "door"
  | "doorway";

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

const FRIDGE_ROWS = [
  "..oooooooooooo..",
  "..onnnnnnnnnno..",
  "..onnnnnnnnnmo..",
  "..onMnnnnnnnmo..",
  "..onMnnnnnnnmo..",
  "..onMnnnnnnnmo..",
  "..onnnnnnnnnmo..",
  "..onnnnnnnnnmo..",
  "..oooooooooooo..",
  "..onnnnnnnnnmo..",
  "..onMnnnnnnnmo..",
  "..onMnnnnwwnmo..",
  "..onMnnnnwwnmo..",
  "..onMnnnnnnnmo..",
  "..onMnnnnennmo..",
  ...Array.from({ length: 10 }, () => "..onnnnnnnnnmo.."),
  "..ommmmmmmmmmo..",
  "..oooooooooooo..",
];

// Cabinets at the height of the coffee machine's, so the two stand as one run. The sink is on top.
const COUNTER_ROWS = [
  row([".", 13], "oooo", [".", 15]),
  row([".", 13], "oMMo", [".", 15]),
  row([".", 13], "oMoo", [".", 15]),
  row(".", ["o", 30], "."),
  row(".o", ["l", 9], "oMMMMMMo", ["l", 11], "o."),
  row(".", ["o", 30], "."),
  row(".o", ["d", 9], "o", ["d", 8], "o", ["d", 9], "o."),
  row(".o", ["d", 9], "o", ["d", 8], "o", ["d", 9], "o."),
  row(".o", ["d", 8], "non", ["d", 6], "non", ["d", 8], "o."),
  row(".o", ["d", 9], "o", ["d", 8], "o", ["d", 9], "o."),
  row(".o", ["d", 9], "o", ["d", 8], "o", ["d", 9], "o."),
  row(".o", ["D", 9], "o", ["D", 8], "o", ["D", 9], "o."),
  row(".", ["o", 30], "."),
];

/** A standing table for the pantry. */
const TABLE_ROWS = [
  "...oooooooooo...",
  "..ollllllllllo..",
  "..oddddddddddo..",
  "...oooooooooo...",
  ...Array.from({ length: 9 }, () => "......oMMo......"),
  "....oooMMooo....",
  "...oMMMMMMMMo...",
  "...oooooooooo...",
];

const SPINES = ["ffppggaaFFuuDDGGcceeAAwwDDPP", "ppDDaaffggPPuuwwDDeeFFccGGaa", "GGwwffDDppaaeeccFFDDuuggPPff"];
/** The top row of a shelf: every third book is a pixel shorter. */
const shortBooks = (spines: string) => spines.replace(/../g, (pair, at: number) => ((at / 2) % 3 === 1 ? "DD" : pair));
const BOOKSHELF_ROWS = [
  row(["o", 32]),
  row("o", ["l", 30], "o"),
  ...SPINES.flatMap((spines) => [
    row("oD", shortBooks(spines), "Do"),
    ...Array.from({ length: 5 }, () => row("oD", spines, "Do")),
    row("o", ["l", 30], "o"),
  ]),
  ...Array.from({ length: 3 }, () => row("o", ["d", 30], "o")),
  row("o", ["D", 30], "o"),
  row(["o", 32]),
];

const LOW_TABLE_ROWS = [
  ".oooooooooooooo.",
  ".olllwwwllllllo.",
  ".oddddddddddddo.",
  ".oooooooooooooo.",
  "..oDo......oDo..",
  "..oDo......oDo..",
  "..ooo......ooo..",
];

const BEANBAG_ROWS = [
  ".....oooooo.....",
  "...oouuuuuuoo...",
  "..ouuffffffuuo..",
  ".ouffffffffffuo.",
  ".offffFFFFffffo.",
  "offfFFFFFFFFfffo",
  "offffffffffffffo",
  "offffffffffffffo",
  "oFffffffffffffFo",
  "oFFffffffffffFFo",
  ".oFFFFFFFFFFFFo.",
  "..oooooooooooo..",
];

/** Lies flat: draw it straight after the floor, under everything else. */
const RUG_ROWS = [
  row("..", ["P", 28], ".."),
  row(".P", ["p", 28], "P."),
  row("Pp", ["l", 28], "pP"),
  ...Array.from({ length: 10 }, () => row("Ppl", ["p", 26], "lpP")),
  row("Pp", ["l", 28], "pP"),
  row(".P", ["p", 28], "P."),
  row("..", ["P", 28], ".."),
];

// Zone floors: a speckled carpet for the lounge, small checkers for the pantry.
const CARPET_ROWS = Array.from({ length: 16 }, (_, y) =>
  Array.from({ length: 16 }, (_, x) => ((x * 5 + y * 3) % 8 === 0 ? "8" : "7")).join(""),
);
const KITCHEN_ROWS = Array.from({ length: 16 }, (_, y) =>
  Array.from({ length: 16 }, (_, x) => ((x >> 3) + (y >> 3)) % 2 ? "0" : "9").join(""),
);

// A dividing wall seen from above. It has no edge of its own, so it joins along a row, down a
// column and round a corner without a seam.
const PARTITION_ROWS = Array.from({ length: 16 }, (_, y) =>
  Array.from({ length: 16 }, (_, x) => ((x + y) % 8 === 0 ? "Q" : "q")).join(""),
);
// A doorway through a wall across the top of a room: floor between two jambs. `door` has the lintel
// and goes in the wall's top row; `doorway` continues the opening through any wall-face rows below.
const DOORWAY_ROWS = Array.from({ length: 16 }, () => row("odo", ["1", 10], "odo"));
const DOOR_ROWS = [row(["o", 16]), row("o", ["l", 14], "o"), row("o", ["d", 14], "o"), row(["o", 16]), ...DOORWAY_ROWS.slice(4)];

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

/** Where a character goes to use a prop, so the layout and the art agree on one table. */
export interface UsePoint {
  /** Tiles from the prop's leftmost tile; `dy` 1 is the tile in front of it. */
  readonly dx: number;
  readonly dy: number;
  readonly pose: "idle" | "sit";
  readonly facing: "up" | "down" | "left" | "right";
  /** Art pixels to raise the character so it sits on the seat instead of the floor. */
  readonly lift: number;
}

const use = (dx: number, dy: number, pose: UsePoint["pose"], facing: UsePoint["facing"], lift = 0): UsePoint => ({
  dx,
  dy,
  pose,
  facing,
  lift,
});

/**
 * A character on a prop's own tile (`dy` 0) is drawn after the prop. Props with no entry are
 * scenery: nobody stands on their tiles.
 */
export const PROP_USES: Readonly<Record<PropId, readonly UsePoint[]>> = {
  desk: [],
  chair: [],
  envelope: [],
  plant: [],
  lowTable: [],
  rug: [],
  sofa: [use(0, 0, "sit", "down", 4), use(1, 0, "sit", "down", 4)],
  beanbag: [use(0, 0, "sit", "down", 3)],
  coffee: [use(0, 1, "idle", "up")],
  water: [use(0, 1, "idle", "up")],
  fridge: [use(0, 1, "idle", "up")],
  counter: [use(0, 1, "idle", "up"), use(1, 1, "idle", "up")],
  bookshelf: [use(0, 1, "idle", "up"), use(1, 1, "idle", "up")],
  table: [use(-1, 0, "idle", "right"), use(1, 0, "idle", "left")],
};

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
  fridge: info(FRIDGE_ROWS, 1),
  counter: info(COUNTER_ROWS, 2),
  table: info(TABLE_ROWS, 1),
  bookshelf: info(BOOKSHELF_ROWS, 2),
  lowTable: info(LOW_TABLE_ROWS, 1),
  beanbag: info(BEANBAG_ROWS, 1),
  rug: info(RUG_ROWS, 2),
};

const STATIC_ROWS: Readonly<Record<Exclude<PropId, "desk">, readonly string[]>> = {
  chair: CHAIR_ROWS,
  plant: PLANT_ROWS,
  coffee: COFFEE_ROWS,
  sofa: SOFA_ROWS,
  water: WATER_ROWS,
  envelope: ENVELOPE_ROWS,
  fridge: FRIDGE_ROWS,
  counter: COUNTER_ROWS,
  table: TABLE_ROWS,
  bookshelf: BOOKSHELF_ROWS,
  lowTable: LOW_TABLE_ROWS,
  beanbag: BEANBAG_ROWS,
  rug: RUG_ROWS,
};
const TILE_ROWS: Readonly<Record<TileId, readonly string[]>> = {
  floor: FLOOR_ROWS,
  floorAlt: FLOOR_ALT_ROWS,
  wall: WALL_ROWS,
  wallCap: WALL_CAP_ROWS,
  carpet: CARPET_ROWS,
  kitchen: KITCHEN_ROWS,
  partition: PARTITION_ROWS,
  door: DOOR_ROWS,
  doorway: DOORWAY_ROWS,
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
