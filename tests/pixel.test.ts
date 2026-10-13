import type { PluginTheme } from "@getpaseo/plugin";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  CHARACTER_FRAMES,
  CHARACTER_HEIGHT,
  CHARACTER_MAX_CACHED,
  CHARACTER_WIDTH,
  character,
} from "../client/pixel/characters";
import type { CharacterPose, CharacterRole, Facing } from "../client/pixel/characters";
import {
  BUBBLE_HEIGHT,
  BUBBLE_MAX_CACHED,
  BUBBLE_MAX_WIDTH,
  bubble,
  bubbleScale,
  bubbleSize,
  bubbleWidth,
  tag,
  type BubbleTone,
} from "../client/pixel/bubble";
import { contrast, luminance, mix, parseColor } from "../client/pixel/color";
import { EMOTE_FRAMES, EMOTE_SIZE, emote, type EmoteId } from "../client/pixel/emotes";
import { ELLIPSIS, FALLBACK, FONT_HEIGHT, GLYPH_CHARS, ICON, glyph } from "../client/pixel/font";
import { COMPOSITE_MAX_ENTRIES, composite, mirror, paint, type Bitmap } from "../client/pixel/grid";
import { Lru } from "../client/pixel/lru";
import { SLOTS, lookFor, officePalette, paletteColor, slotIndex } from "../client/pixel/palette";
import { adler32, crc32, deflate, encodeIndexedPng, pngDataUri, toBase64, upscale, type Rgba } from "../client/pixel/png";
import { PROPS, PROP_USES, TILE, archiveLevel, door, prop, tile, wallTop, wallTopAt } from "../client/pixel/props";
import type { PropId, ScreenState, TileId } from "../client/pixel/props";
import { crispScale, devicePixels, snap } from "../client/pixel/scale";
import { fitText, foldText, textWidth, wrapText } from "../client/pixel/text";

const LIGHT: PluginTheme = {
  colors: {
    surface0: "#ffffff",
    surface1: "#f6f6f4",
    surface2: "#ececea",
    border: "#dcdcd8",
    foreground: "#1b1d1c",
    foregroundMuted: "#6c706e",
    accent: "#2f7d5b",
    accentForeground: "#ffffff",
    statusSuccess: "#2e9e5b",
    statusWarning: "#d9982b",
    statusDanger: "#d6453d",
  },
};
const DARK: PluginTheme = {
  colors: {
    surface0: "#181b1a",
    surface1: "#1f2322",
    surface2: "#272c2a",
    border: "#333937",
    foreground: "#e8ebe9",
    foregroundMuted: "#98a09c",
    accent: "#4fbf8f",
    accentForeground: "#0d1411",
    statusSuccess: "#45c27a",
    statusWarning: "#e3b04b",
    statusDanger: "#ef6a61",
  },
};

const ROLES: CharacterRole[] = ["overseer", "nexus", "meow", "agent"];
const POSES: CharacterPose[] = ["idle", "walk", "sit", "sleep", "drink", "talk", "stretch", "doze", "lie"];
const FACINGS: Facing[] = ["down", "up", "left", "right"];
const EMOTES: EmoteId[] = ["alert", "question", "fail", "check", "zzz", "thinking"];
const PROP_IDS: PropId[] = [
  "desk",
  "chair",
  "plant",
  "coffee",
  "sofa",
  "water",
  "envelope",
  "fridge",
  "counter",
  "table",
  "bookshelf",
  "lowTable",
  "beanbag",
  "rug",
  "screenH",
  "screenV",
  "stool",
  "archive",
];
const TILE_IDS: TileId[] = [
  "floor",
  "floorAlt",
  "wall",
  "wallCap",
  "carpet",
  "kitchen",
  "partition",
  "door",
  "doorway",
  "doormat",
  "pod0",
  "pod1",
  "pod2",
  "pod3",
];
const LOOK = lookFor("agent-1");
const bytes = (text: string) => Uint8Array.from(Buffer.from(text, "latin1"));

/** Reads back a PNG written by the encoder: checks every CRC and returns the palette indices. */
function decode(png: Uint8Array) {
  const view = Buffer.from(png);
  expect([...view.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunks = new Map<string, Buffer>();
  for (let at = 8; at < view.length; ) {
    const length = view.readUInt32BE(at);
    const type = view.toString("latin1", at + 4, at + 8);
    expect(view.readUInt32BE(at + 8 + length)).toBe(crc32(png, at + 4, at + 8 + length));
    chunks.set(type, view.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const header = chunks.get("IHDR")!;
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const raw = inflateSync(chunks.get("IDAT")!);
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    expect(raw[y * (width + 1)]).toBe(0);
    pixels.set(raw.subarray(y * (width + 1) + 1, (y + 1) * (width + 1)), y * width);
  }
  return { width, height, depth: header[8], colourType: header[9], pixels, chunks };
}

const opaque = (bitmap: Bitmap) => Array.from(bitmap.pixels, (value) => (value === 0 ? 0 : 1));
const difference = (a: readonly number[], b: readonly number[]) => a.filter((value, index) => value !== b[index]).length;

describe("png", () => {
  it("computes the standard checksums", () => {
    expect(crc32(bytes("123456789"))).toBe(0xcbf43926);
    expect(adler32(bytes("Wikipedia"))).toBe(0x11e60398);
  });

  it("encodes base64 with padding", () => {
    for (const text of ["", "f", "fo", "foo", "foob", "fooba", "foobar"]) {
      expect(toBase64(bytes(text))).toBe(Buffer.from(text, "latin1").toString("base64"));
    }
  });

  it("deflates to a stream zlib inflates back", () => {
    let seed = 7;
    const noise = Uint8Array.from({ length: 5000 }, () => (seed = (seed * 1103515245 + 12345) >>> 0) >>> 24);
    const runs = Uint8Array.from({ length: 70000 }, (_, index) => Math.floor(index / 700) % 5);
    const rows = Uint8Array.from({ length: 4000 }, (_, index) => (index % 40) * 3);
    for (const [raw, stride] of [
      [new Uint8Array(0), 1],
      [Uint8Array.of(9), 1],
      [noise, 50],
      [runs, 701],
      [rows, 40],
    ] as const) {
      expect(Uint8Array.from(inflateSync(deflate(raw, stride)))).toEqual(raw);
    }
    expect(deflate(runs, 701).length).toBeLessThan(runs.length / 50);
  });

  it("writes an indexed image that decodes to the same pixels", () => {
    const palette: Rgba[] = [
      [0, 0, 0, 0],
      [255, 0, 0, 255],
      [0, 128, 255, 128],
    ];
    const pixels = Uint8Array.of(0, 1, 2, 2, 1, 0);
    const image = decode(encodeIndexedPng(pixels, 3, 2, palette));
    expect(image).toMatchObject({ width: 3, height: 2, depth: 8, colourType: 3 });
    expect(image.pixels).toEqual(pixels);
    expect([...image.chunks.get("PLTE")!]).toEqual([0, 0, 0, 255, 0, 0, 0, 128, 255]);
    expect([...image.chunks.get("tRNS")!]).toEqual([0, 255, 128]);
  });

  it("upscales by repeating pixels", () => {
    expect([...upscale(Uint8Array.of(1, 2, 3, 4), 2, 2, 2)]).toEqual([1, 1, 2, 2, 1, 1, 2, 2, 3, 3, 4, 4, 3, 3, 4, 4]);
    const sprite = character({ role: "meow", look: LOOK });
    const uri = pngDataUri(sprite.pixels, sprite.width, sprite.height, officePalette(LIGHT).colors, 4);
    expect(uri.startsWith("data:image/png;base64,")).toBe(true);
    const image = decode(Uint8Array.from(Buffer.from(uri.slice(uri.indexOf(",") + 1), "base64")));
    expect(image.width).toBe(CHARACTER_WIDTH * 4);
    expect(image.pixels).toEqual(upscale(sprite.pixels, sprite.width, sprite.height, 4));
    expect(uri.length).toBeLessThan(2000);
  });

  it("rejects a pixel buffer of the wrong size", () => {
    expect(() => encodeIndexedPng(new Uint8Array(5), 2, 2, [[0, 0, 0, 0]])).toThrow();
  });
});

describe("color", () => {
  it("parses the forms a theme can hand over", () => {
    expect(parseColor("#fff")).toEqual([255, 255, 255, 255]);
    expect(parseColor("#1A2b3C")).toEqual([26, 43, 60, 255]);
    expect(parseColor("#11223380")).toEqual([17, 34, 51, 128]);
    expect(parseColor("rgb(1, 2, 3)")).toEqual([1, 2, 3, 255]);
    expect(parseColor("rgba(10 20 30 / 0.5)")).toEqual([10, 20, 30, 128]);
    expect(parseColor("tomato")).toEqual([128, 128, 128, 255]);
  });

  it("mixes and measures", () => {
    expect(mix([0, 0, 0, 255], [255, 255, 255, 255], 0.5)).toEqual([128, 128, 128, 255]);
    expect(luminance([255, 255, 255, 255])).toBeCloseTo(1);
    expect(contrast([0, 0, 0, 255], [255, 255, 255, 255])).toBeCloseTo(21);
  });
});

describe("palette", () => {
  it("fills every slot, with only the first transparent", () => {
    for (const theme of [LIGHT, DARK]) {
      const palette = officePalette(theme);
      expect(palette.colors).toHaveLength(SLOTS.length);
      expect(SLOTS.length).toBeLessThanOrEqual(256);
      palette.colors.forEach((color, index) => expect(color[3]).toBe(index === 0 ? 0 : 255));
    }
    expect(slotIndex("transparent")).toBe(0);
  });

  it("follows the theme", () => {
    const light = officePalette(LIGHT);
    const dark = officePalette(DARK);
    expect(light.dark).toBe(false);
    expect(dark.dark).toBe(true);
    expect(light.key).not.toBe(dark.key);
    expect(officePalette(LIGHT)).toBe(light);
    expect(paletteColor(dark, "floor")).toEqual(parseColor(DARK.colors.surface1));
    expect(paletteColor(dark, "emoteAlert")).toEqual(parseColor(DARK.colors.statusWarning));
    expect(paletteColor(dark, "emoteFail")).toEqual(parseColor(DARK.colors.statusDanger));
    expect(paletteColor(light, "emoteReady")).toEqual(parseColor(LIGHT.colors.statusSuccess));
    expect(paletteColor(light, "screenLit")).toEqual(parseColor(LIGHT.colors.accent));
    expect(paletteColor(light, "screenError")).toEqual(parseColor(LIGHT.colors.statusDanger));
  });

  it("keeps glyphs readable on their bubbles", () => {
    for (const theme of [LIGHT, DARK]) {
      const palette = officePalette(theme);
      for (const name of ["emoteAlert", "emoteFail", "emoteReady", "emoteIdle", "emoteThinking"] as const) {
        expect(contrast(paletteColor(palette, name), paletteColor(palette, `${name}Ink`))).toBeGreaterThan(3);
      }
    }
  });

  it("gives an id one look, and a crowd many", () => {
    expect(lookFor("a1b2c3d4")).toEqual(lookFor("a1b2c3d4"));
    const looks = new Set(Array.from({ length: 40 }, (_, index) => JSON.stringify(lookFor(`agent-${index}`))));
    expect(looks.size).toBeGreaterThanOrEqual(36);
  });
});

describe("characters", () => {
  it("draws every role, pose, facing and frame at one size", () => {
    for (const role of ROLES) {
      for (const pose of POSES) {
        for (const facing of FACINGS) {
          for (let frame = 0; frame < CHARACTER_FRAMES[pose]; frame++) {
            const sprite = character({ role, look: LOOK, pose, facing, frame });
            // Lying down is the one pose drawn sideways.
            const [width, height] = pose === "lie" ? [24, 16] : [CHARACTER_WIDTH, CHARACTER_HEIGHT];
            expect([sprite.width, sprite.height]).toEqual([width, height]);
            expect(sprite.anchor).toEqual({ x: width / 2, y: height });
            // Feet, or the chair they sit on, reach the bottom row; lying, they reach the right edge.
            const reach =
              pose === "lie"
                ? Array.from({ length: height }, (_, y) => sprite.pixels[y * width + width - 1]!)
                : [...sprite.pixels.slice(-width)];
            expect(reach.some(Boolean)).toBe(true);
          }
        }
      }
    }
  });

  it("tells the roles apart by outline alone, from the front and from behind", () => {
    for (const facing of ["down", "up"] as const) {
      for (const pose of ["idle", "sit"] as const) {
        const shapes = ROLES.map((role) => opaque(character({ role, look: LOOK, pose, facing })));
        for (let a = 0; a < shapes.length; a++) {
          for (let b = a + 1; b < shapes.length; b++) {
            expect(difference(shapes[a]!, shapes[b]!), `${ROLES[a]} vs ${ROLES[b]} ${pose} ${facing}`).toBeGreaterThanOrEqual(8);
          }
        }
      }
    }
  });

  it("returns one object per drawing and wraps frames", () => {
    const spec = { role: "nexus", look: LOOK, pose: "walk", facing: "left" } as const;
    expect(character({ ...spec, frame: 1 })).toBe(character({ ...spec, frame: 5 }));
    expect(character({ ...spec, frame: -1 })).toBe(character({ ...spec, frame: 3 }));
    expect(character({ role: "agent", look: LOOK })).toBe(character({ role: "agent", look: { ...LOOK }, pose: "idle", facing: "down", frame: 0 }));
  });

  it("moves between frames", () => {
    for (const [pose, facing] of [
      ["idle", "down"],
      ["walk", "down"],
      ["walk", "up"],
      ["sit", "up"],
      ["sleep", "up"],
    ] as const) {
      const first = character({ role: "agent", look: LOOK, pose, facing, frame: 0 });
      const second = character({ role: "agent", look: LOOK, pose, facing, frame: 1 });
      expect(difference([...first.pixels], [...second.pixels]), `${pose} ${facing}`).toBeGreaterThan(0);
    }
  });

  it("mirrors left from right", () => {
    const right = character({ role: "agent", look: LOOK, facing: "right" });
    const left = character({ role: "agent", look: LOOK, facing: "left" });
    // The body is symmetric; the head is the part that turns.
    const head = (bitmap: Bitmap) => ({ width: 16, height: 12, pixels: bitmap.pixels.slice(0, 16 * 12) });
    expect(mirror(head(left)).pixels).toEqual(head(right).pixels);
    expect(left.pixels).not.toEqual(right.pixels);
  });

  it("puts a cup in the hand, except from behind", () => {
    const empty = character({ role: "agent", look: LOOK });
    const holding = character({ role: "agent", look: LOOK, carry: "cup" });
    expect(difference([...empty.pixels], [...holding.pixels])).toBeGreaterThanOrEqual(8);
    expect(holding).toBe(character({ role: "agent", look: LOOK, carry: "cup" }));
    expect(character({ role: "agent", look: LOOK, facing: "up", carry: "cup" }).pixels).toEqual(
      character({ role: "agent", look: LOOK, facing: "up" }).pixels,
    );
  });

  it("acts on the second frame of each activity", () => {
    const frames = (pose: CharacterPose, facing: Facing) =>
      [0, 1].map((frame) => character({ role: "agent", look: LOOK, pose, facing, frame }));
    for (const [pose, facing, least] of [
      ["drink", "down", 10],
      ["drink", "right", 10],
      ["talk", "down", 4],
      ["talk", "left", 4],
      ["stretch", "down", 30],
      ["stretch", "up", 30],
      ["doze", "down", 8],
      ["lie", "down", 4],
    ] as const) {
      const [still, moving] = frames(pose, facing);
      expect(difference([...still!.pixels], [...moving!.pixels]), `${pose} ${facing}`).toBeGreaterThanOrEqual(least);
    }
    // Stretching reaches above where the standing figure ends.
    const reach = (bitmap: Bitmap) => opaque(bitmap).slice(0, 16 * 7).filter((value, index) => value && (index % 16 < 3 || index % 16 > 12)).length;
    expect(reach(frames("stretch", "down")[1]!)).toBeGreaterThan(reach(frames("stretch", "down")[0]!) + 6);
    // Drinking carries the cup without being told to.
    expect(frames("drink", "down")[0]!.pixels).toEqual(character({ role: "agent", look: LOOK, carry: "cup" }).pixels);
  });

  it("shuts the eyes to doze and to lie down", () => {
    const eye = slotIndex("outline");
    const awake = character({ role: "agent", look: LOOK, pose: "sit", facing: "down" });
    const dozing = character({ role: "agent", look: LOOK, pose: "doze" });
    expect(difference([...awake.pixels], [...dozing.pixels])).toBeGreaterThan(6);
    // A lying figure is a standing one turned a quarter turn: same number of drawn pixels, bar the eyes.
    const lying = character({ role: "meow", look: LOOK, pose: "lie" });
    const standing = character({ role: "meow", look: LOOK });
    const drawn = (bitmap: Bitmap) => opaque(bitmap).filter(Boolean).length;
    expect(drawn(lying)).toBe(drawn(standing));
    expect([...lying.pixels].filter((value) => value === eye).length).not.toBe(0);
  });

  it("holds a book from the front only", () => {
    const empty = character({ role: "agent", look: LOOK, pose: "sit", facing: "down" });
    const reading = character({ role: "agent", look: LOOK, pose: "sit", facing: "down", carry: "book" });
    expect(difference([...empty.pixels], [...reading.pixels])).toBeGreaterThanOrEqual(12);
    expect(character({ role: "agent", look: LOOK, facing: "up", carry: "book" }).pixels).toEqual(
      character({ role: "agent", look: LOOK, facing: "up" }).pixels,
    );
  });

  it("shows a different person for a different look", () => {
    const one = character({ role: "meow", look: { skin: 0, hair: 0, hairStyle: 0, shirt: 0, pants: 0 } });
    const other = character({ role: "meow", look: { skin: 3, hair: 4, hairStyle: 1, shirt: 5, pants: 2 } });
    expect(difference([...one.pixels], [...other.pixels])).toBeGreaterThan(60);
  });
});

describe("props, tiles and emotes", () => {
  it("draws every prop at its catalogued size", () => {
    for (const id of PROP_IDS) {
      const sprite = prop(id);
      expect([sprite.width, sprite.height]).toEqual([PROPS[id].width, PROPS[id].height]);
      expect(sprite.anchor).toEqual({ x: sprite.width / 2, y: sprite.height });
      expect(sprite.width).toBeLessThanOrEqual(PROPS[id].tilesWide * TILE);
    }
    expect([PROPS.desk.width, PROPS.chair.width, PROPS.chair.height]).toEqual([2 * TILE, TILE, TILE]);
  });

  it("shows the screen state in shape as well as colour", () => {
    const states: ScreenState[] = ["lit", "off", "error"];
    const marks = states.map((screen) => {
      const background = slotIndex(screen === "lit" ? "screenLit" : screen === "off" ? "screenOff" : "screenError");
      const desk = prop("desk", { screen });
      // The 12 x 8 screen sits at (10, 3).
      return Array.from({ length: 96 }, (_, index) => {
        const value = desk.pixels[(3 + Math.floor(index / 12)) * desk.width + 10 + (index % 12)]!;
        return value === background ? 0 : 1;
      });
    });
    expect(difference(marks[0]!, marks[1]!)).toBeGreaterThan(8);
    expect(difference(marks[0]!, marks[2]!)).toBeGreaterThan(8);
    expect(difference(marks[1]!, marks[2]!)).toBeGreaterThan(8);
    expect(prop("desk", { screen: "lit", frame: 0 }).pixels).not.toEqual(prop("desk", { screen: "lit", frame: 1 }).pixels);
    expect(prop("desk", { screen: "off", frame: 3 })).toBe(prop("desk"));
  });

  it("fills the archive by level, in shape", () => {
    const labels = (level: number) => [...prop("archive", { level }).pixels].filter((value) => value === slotIndex("white")).length;
    const sizes = [0, 1, 2, 3, 4].map((level) => prop("archive", { level }));
    for (const drawn of sizes) expect([drawn.width, drawn.height]).toEqual([PROPS.archive.width, PROPS.archive.height]);
    expect(labels(0)).toBe(0);
    expect(labels(1)).toBeGreaterThan(0);
    expect(labels(2)).toBeGreaterThan(labels(1));
    expect(labels(3)).toBeGreaterThan(labels(2));
    // The box on top is the only thing in the upper six rows.
    const top = (level: number) => opaque(prop("archive", { level })).slice(0, 16 * 6).some(Boolean);
    expect([top(3), top(4)]).toEqual([false, true]);
    expect(prop("archive", { level: 99 })).toBe(prop("archive", { level: 4 }));
    expect(prop("archive")).toBe(prop("archive", { level: 0 }));
    expect([0, 1, 2, 3, 9, 10, 29, 30, 500].map(archiveLevel)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it("lists use points that fit each prop", () => {
    for (const id of PROP_IDS) {
      const seats = PROP_USES[id].filter((point) => point.dy === 0 && point.pose === "sit");
      for (const point of PROP_USES[id]) {
        // Lying on the sofa is centred between its tiles; every other point is on a tile.
        expect(Number.isInteger(point.pose === "lie" ? point.dx * 2 : point.dx) && Number.isInteger(point.dy), id).toBe(true);
        // Seats are on the prop, and low enough that the sitter's feet stay inside its height.
        if (point.pose !== "idle") expect(point.dx >= 0 && point.dx < PROPS[id].tilesWide && point.dy === 0, id).toBe(true);
        expect(point.lift, id).toBeLessThan(PROPS[id].height);
      }
      expect(seats.length, id).toBeLessThanOrEqual(PROPS[id].tilesWide);
    }
    expect(PROP_USES.sofa.map((point) => point.pose)).toEqual(["sit", "sit", "lie"]);
    expect(PROP_USES.stool[0]!.lift).toBeGreaterThanOrEqual(5);
    expect(new Set(PROP_USES.table.map((point) => point.facing))).toEqual(new Set(["left", "right"]));
  });

  it("lines the counter up with the coffee machine's cabinets", () => {
    // Both stand ten rows of cabinet on the floor, so side by side they read as one run.
    const top = slotIndex("woodLight");
    const worktop = (id: PropId) => {
      const sprite = prop(id);
      const y = sprite.height - 9;
      return [...sprite.pixels.slice(y * sprite.width, (y + 1) * sprite.width)].filter((value) => value === top).length;
    };
    expect(worktop("coffee")).toBeGreaterThan(8);
    expect(worktop("counter")).toBeGreaterThan(16);
  });

  it("tells the zone floors apart from the plain floor and from each other", () => {
    const palette = officePalette(DARK);
    const colours = (id: "floor" | "carpet" | "kitchen") =>
      [...new Set(tile(id).pixels)].map((index) => palette.colors[index]!.join(",")).sort().join(" ");
    expect(new Set([colours("floor"), colours("carpet"), colours("kitchen")]).size).toBe(3);
  });

  it("makes the wall stand off every floor on both themes", () => {
    for (const theme of [LIGHT, DARK]) {
      const palette = officePalette(theme);
      for (const floor of ["floor", "floorAlt", "carpet", "kitchen", "pod0", "pod1", "pod2", "pod3"] as const) {
        expect(contrast(paletteColor(palette, "partition"), paletteColor(palette, floor)), floor).toBeGreaterThan(3);
      }
    }
  });

  it("edges a wall top only where it does not join another wall", () => {
    const outline = slotIndex("outline");
    const edge = (bitmap: Bitmap, side: "n" | "e" | "s" | "w") =>
      Array.from({ length: 14 }, (_, i) => i + 1).every((i) => {
        const [x, y] = side === "n" ? [i, 0] : side === "s" ? [i, 15] : side === "w" ? [0, i] : [15, i];
        return bitmap.pixels[y! * 16 + x!] === outline;
      });
    const all = new Set<string>();
    for (let mask = 0; mask < 16; mask++) {
      const joins = { n: !!(mask & 1), e: !!(mask & 2), s: !!(mask & 4), w: !!(mask & 8) };
      const top = wallTop(joins);
      expect([top.width, top.height, top.anchor]).toEqual([16, 16, { x: 0, y: 0 }]);
      expect(opaque(top).every(Boolean)).toBe(true);
      for (const side of ["n", "e", "s", "w"] as const) expect(edge(top, side), `${mask} ${side}`).toBe(!joins[side]);
      expect(wallTop(joins)).toBe(top);
      all.add(top.pixels.join());
    }
    expect(all.size).toBe(16);
    // An inside corner closes with one outline pixel; a straight run has none on its joined ends.
    expect(wallTop({ e: true, s: true }).pixels[15 * 16 + 15]).toBe(outline);
    expect(wallTop({ e: true, w: true }).pixels[8 * 16]).not.toBe(outline);
  });

  it("reads a wall tile's joins from its neighbours", () => {
    // A room outline, 5 by 4: the top-left corner joins east and south only.
    const isWall = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < 5 && y < 4 && (x === 0 || y === 0 || x === 4 || y === 3);
    expect(wallTopAt(isWall, 0, 0)).toBe(wallTop({ e: true, s: true }));
    expect(wallTopAt(isWall, 2, 0)).toBe(wallTop({ e: true, w: true }));
    expect(wallTopAt(isWall, 4, 2)).toBe(wallTop({ n: true, s: true }));
  });

  it("draws a door of any face height, with a knob and no holes", () => {
    for (const rows of [1, 2, 3]) {
      const drawn = door(rows);
      expect([drawn.width, drawn.height, drawn.anchor]).toEqual([16, 16 * rows, { x: 0, y: 0 }]);
      expect(opaque(drawn).every(Boolean)).toBe(true);
      expect([...drawn.pixels].filter((value) => value === slotIndex("metalLight"))).toHaveLength(2);
    }
    expect(door(1)).toBe(tile("doorway"));
    expect(door(99)).toBe(door(4));
    // Above a door the wall's top runs on, joined to both sides.
    expect(tile("door").pixels).toEqual(wallTop({ e: true, w: true }).pixels);
  });

  it("gives each pod floor its own weave and tint", () => {
    const weaves = [0, 1, 2, 3].map((index) => {
      const base = slotIndex(`pod${index}` as "pod0");
      return Array.from(tile(`pod${index}` as TileId).pixels, (value) => (value === base ? 0 : 1));
    });
    for (let a = 0; a < weaves.length; a++) {
      expect(weaves[a]!.some(Boolean)).toBe(true);
      for (let b = a + 1; b < weaves.length; b++) expect(difference(weaves[a]!, weaves[b]!)).toBeGreaterThan(20);
    }
    for (const theme of [LIGHT, DARK]) {
      const palette = officePalette(theme);
      const tints = (["pod0", "pod1", "pod2", "pod3", "floor", "carpet", "kitchen"] as const).map((slot) =>
        paletteColor(palette, slot).join(),
      );
      expect(new Set(tints).size).toBe(tints.length);
    }
  });

  it("draws square tiles with no holes", () => {
    for (const id of TILE_IDS) {
      const sprite = tile(id);
      expect([sprite.width, sprite.height]).toEqual([TILE, TILE]);
      expect(opaque(sprite).every(Boolean)).toBe(true);
    }
  });

  it("gives every emote its own glyph", () => {
    const glyphs = EMOTES.map((id) => {
      const sprite = emote(id);
      expect([sprite.width, sprite.height]).toEqual([EMOTE_SIZE, EMOTE_SIZE]);
      const fill = sprite.pixels[EMOTE_SIZE + 2]!;
      return Array.from(sprite.pixels, (value) => (value !== 0 && value !== fill && value !== slotIndex("outline") ? 1 : 0));
    });
    for (let a = 0; a < glyphs.length; a++) {
      expect(glyphs[a]!.some(Boolean)).toBe(true);
      for (let b = a + 1; b < glyphs.length; b++) {
        expect(difference(glyphs[a]!, glyphs[b]!), `${EMOTES[a]} vs ${EMOTES[b]}`).toBeGreaterThanOrEqual(6);
      }
    }
    for (const id of EMOTES) expect(emote(id, EMOTE_FRAMES[id])).toBe(emote(id, 0));
  });
});

describe("grid", () => {
  it("rejects ragged rows and unknown characters", () => {
    expect(() => paint(["oo", "o"], { o: "outline" })).toThrow(/row 1/);
    expect(() => paint(["o?"], { o: "outline" })).toThrow(/legend/);
  });

  it("flattens layers by anchor, later ones on top", () => {
    const floor = tile("floor");
    const plant = prop("plant");
    const room = composite("test-room", 32, 32, [
      { bitmap: floor, x: 0, y: 0 },
      { bitmap: floor, x: 16, y: 0 },
      { bitmap: floor, x: 0, y: 16 },
      { bitmap: floor, x: 16, y: 16 },
      { bitmap: plant, x: 16, y: 32 },
    ]);
    expect([room.width, room.height]).toEqual([32, 32]);
    expect(opaque(room).every(Boolean)).toBe(true);
    // The plant's bottom row lands on the last row, centred on x = 16.
    const bottom = [...room.pixels.slice(31 * 32)];
    expect(bottom.slice(13, 18)).toEqual([...plant.pixels.slice(-16)].slice(5, 10));
    expect(composite("test-room", 32, 32, [])).toBe(room);
  });
});

describe("cache bounds", () => {
  it("drops the least recently used entry past the entry cap", () => {
    const cache = new Lru<number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1);
    cache.set("c", 3);
    expect(cache.get("b")).toBeUndefined();
    expect([cache.get("a"), cache.get("c"), cache.size]).toEqual([1, 3, 2]);
  });

  it("drops entries past the weight cap but keeps the newest", () => {
    const cache = new Lru<string>(10, 10, (value) => value.length);
    cache.set("a", "xxxx");
    cache.set("b", "xxxx");
    cache.set("c", "xxxx");
    expect([cache.get("a"), cache.size, cache.weight]).toEqual([undefined, 2, 8]);
    cache.set("b", "x");
    expect(cache.weight).toBe(5);
    cache.set("huge", "x".repeat(50));
    expect([cache.size, cache.weight, cache.get("huge")?.length]).toEqual([1, 50, 50]);
  });

  it("forgets old room composites and redraws them on demand", () => {
    const layers = [{ bitmap: tile("floor"), x: 0, y: 0 }];
    const first = composite("bound-0", 16, 16, layers);
    expect(composite("bound-0", 16, 16, layers)).toBe(first);
    for (let index = 1; index <= COMPOSITE_MAX_ENTRIES; index++) composite(`bound-${index}`, 16, 16, layers);
    const again = composite("bound-0", 16, 16, layers);
    expect(again).not.toBe(first);
    expect(again.pixels).toEqual(first.pixels);
  });

  it("forgets old character drawings and redraws them on demand", () => {
    const look = { skin: 0, hair: 0, hairStyle: 0, shirt: 0, pants: 0 };
    const first = character({ role: "agent", look });
    for (let index = 0; index < CHARACTER_MAX_CACHED; index++) {
      character({
        role: ROLES[index % 4]!,
        look: { skin: index % 5, hair: Math.floor(index / 5) % 6, hairStyle: 1, shirt: Math.floor(index / 30) % 8, pants: 1 },
        pose: "walk",
        facing: FACINGS[Math.floor(index / 240) % 4]!,
        frame: Math.floor(index / 960),
      });
    }
    const again = character({ role: "agent", look });
    expect(again).not.toBe(first);
    expect(again.pixels).toEqual(first.pixels);
  });
});

describe("font and text", () => {
  it("draws every glyph as a clean grid inside the line", () => {
    const shapes = new Map<string, string>();
    for (const char of GLYPH_CHARS) {
      const { width, rows } = glyph(char);
      expect(width, char).toBeGreaterThan(0);
      expect(rows.length, char).toBeGreaterThanOrEqual(7);
      expect(rows.length, char).toBeLessThanOrEqual(FONT_HEIGHT);
      for (const line of rows) expect(line, char).toMatch(new RegExp(`^[#.]{${width}}$`));
      if (char !== " ") expect(rows.join("").includes("#"), char).toBe(true);
      const shape = rows.join("/").replace(/(\/\.+)+$/, "");
      expect(shapes.get(shape), `${char} looks like ${shapes.get(shape)}`).toBeUndefined();
      shapes.set(shape, char);
    }
    for (const char of "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,:;!?-_+=/()[]<>'\"#@&%*") {
      expect(GLYPH_CHARS, char).toContain(char);
    }
  });

  it("folds Vietnamese and other accents to base letters", () => {
    expect(foldText("Đang kiểm tra hiện trạng")).toBe("Dang kiem tra hien trang");
    expect(foldText("ƯỚC ĐƯỜNG người Ừ")).toBe("UOC DUONG nguoi U");
    expect(foldText("café naïve Ångström")).toBe("cafe naive Angstrom");
    // Decomposed input: letters followed by combining marks.
    expect(foldText("tie\u0302\u0301ng Vie\u0323\u0302t")).toBe("tieng Viet");
  });

  it("collapses whitespace and unknown runs, and maps typographic punctuation", () => {
    expect(foldText("  a \n\t b  ")).toBe("a b");
    expect(foldText("已完成 🎉🎉 done")).toBe(`${FALLBACK} ${FALLBACK} done`);
    expect(foldText("\u201cok\u201d \u2014 a\u2192b")).toBe('"ok" - a->b');
    expect(foldText(`${ICON.prompt}x`)).toBe(`${ICON.prompt}x`);
    expect(foldText("")).toBe("");
  });

  it("measures text in art pixels", () => {
    expect(textWidth("")).toBe(0);
    expect(textWidth("i")).toBe(1);
    expect(textWidth("ii")).toBe(3);
    expect(textWidth("A")).toBe(5);
    expect(textWidth("Ấ b")).toBe(5 + 1 + 3 + 1 + 5);
  });

  it("cuts to a width with an ellipsis and never overshoots", () => {
    const text = "Xong rồi, đã sửa lỗi ở cổng thanh toán";
    expect(fitText("Bash", 100)).toBe("Bash");
    for (const max of [0, 3, 5, 12, 40, 80, 119, 500]) {
      const cut = fitText(text, max);
      expect(textWidth(cut), `max ${max}`).toBeLessThanOrEqual(max);
      if (textWidth(text) > max && cut !== "") expect(cut.endsWith(ELLIPSIS)).toBe(true);
    }
    expect(fitText(text, 500)).toBe(foldText(text));
    expect(fitText("ab cd", textWidth("ab c") + 2)).toBe(`ab${ELLIPSIS}`);
    expect(fitText(text, 0)).toBe("");
  });
});

describe("wrapping", () => {
  it("breaks at spaces and keeps every line inside the width", () => {
    const text = "Xong rồi, đã sửa lỗi ở cổng thanh toán và chạy lại toàn bộ kiểm thử";
    for (const width of [20, 40, 78, 120]) {
      for (const maxLines of [1, 2, 3, 5]) {
        const lines = wrapText(text, width, maxLines);
        expect(lines.length).toBeGreaterThan(0);
        expect(lines.length).toBeLessThanOrEqual(maxLines);
        for (const line of lines) {
          expect(textWidth(line), `${width}/${maxLines}: ${line}`).toBeLessThanOrEqual(width);
          expect(line).toBe(line.trim());
        }
      }
    }
    expect(wrapText("one two three", textWidth("one two"), 3)).toEqual(["one two", "three"]);
    expect(wrapText("one two three", 500, 3)).toEqual(["one two three"]);
  });

  it("ends the last line with an ellipsis only when text is left over", () => {
    const width = textWidth("one two");
    expect(wrapText("one two three four five", width, 2)).toEqual(["one two", `three${ELLIPSIS}`]);
    expect(wrapText("one two three", width, 2)).toEqual(["one two", "three"]);
    expect(wrapText("one two three", width, 1)).toEqual([`one t${ELLIPSIS}`]);
    // Nothing is lost when the lines are enough: the words come back in order.
    const text = "the quick brown fox jumps over the lazy dog";
    expect(wrapText(text, 60, 20).join(" ")).toBe(text);
  });

  it("breaks a word longer than a line", () => {
    const lines = wrapText("browser_take_screenshot_fullpage", 40, 3);
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(textWidth(line)).toBeLessThanOrEqual(40);
    expect(lines[2]!.endsWith(ELLIPSIS)).toBe(true);
    expect(wrapText("abcdefghij", 500, 2)).toEqual(["abcdefghij"]);
    expect(wrapText("WWWW", 5, 4)).toEqual(["W", "W", "W", "W"]);
  });

  it("returns nothing for nothing", () => {
    expect(wrapText("", 50, 3)).toEqual([]);
    expect(wrapText("   ", 50, 3)).toEqual([]);
    expect(wrapText("word", 50, 0)).toEqual([]);
  });
});

describe("bubbles", () => {
  const TONES: BubbleTone[] = ["say", "tool", "tell", "ask", "alert"];
  const row = (bitmap: Bitmap, y: number) => [...bitmap.pixels.slice(y * bitmap.width, (y + 1) * bitmap.width)];

  it("is the size bubbleSize says, anchored at the tail", () => {
    for (const tone of TONES) {
      for (const text of ["", "ok", "Bash", "Đang kiểm tra hiện trạng của toàn bộ hệ thống thanh toán"]) {
        for (const maxWidth of [undefined, 30, 60, 146]) {
          for (const maxLines of [undefined, 1, 2]) {
            const spec = { text, tone, maxWidth, maxLines };
            const drawn = bubble(spec);
            expect({ width: drawn.width, height: drawn.height }).toEqual(bubbleSize(spec));
            expect(drawn.width).toBe(bubbleWidth(spec));
            expect(drawn.width).toBeLessThanOrEqual(maxWidth ?? BUBBLE_MAX_WIDTH);
            expect([14, 23, 32]).toContain(drawn.height);
            expect(drawn.anchor).toEqual({ x: Math.floor(drawn.width / 2), y: drawn.height });
            // The tip of the tail is the only pixel on the last row.
            expect(row(drawn, drawn.height - 1).filter(Boolean)).toHaveLength(1);
            expect(row(drawn, drawn.height - 1)[drawn.anchor.x]).toBe(slotIndex("outline"));
          }
        }
      }
    }
    expect(BUBBLE_HEIGHT).toBe(14);
  });

  it("grows a line at a time, up to the lines allowed", () => {
    const text = "Xong rồi, đã sửa lỗi ở cổng thanh toán và chạy lại toàn bộ kiểm thử";
    expect(bubbleSize({ text: "ok", tone: "say" }).height).toBe(14);
    expect(bubbleSize({ text, tone: "say", maxLines: 1 }).height).toBe(14);
    expect(bubbleSize({ text, tone: "say", maxLines: 2 }).height).toBe(23);
    expect(bubbleSize({ text, tone: "say" }).height).toBe(32);
    expect(bubbleSize({ text, tone: "say", maxLines: 9, maxWidth: 200 }).height).toBeLessThan(32);
    // A tool bubble is one short line whatever is asked.
    expect(bubbleSize({ text, tone: "tool", maxLines: 3 }).height).toBe(14);
    // Two lines hold more of the text than one.
    expect(bubble({ text, tone: "say", maxLines: 2 }).pixels.filter((value) => value === slotIndex("outline")).length).toBeGreaterThan(
      bubble({ text, tone: "say", maxLines: 1 }).pixels.filter((value) => value === slotIndex("outline")).length,
    );
  });

  it("draws at a readable crisp scale whatever the room's", () => {
    expect(bubbleScale(2)).toBe(1.5);
    expect(bubbleScale(1)).toBe(2);
    expect(bubbleScale(5 / 3)).toBeCloseTo(1.8);
    expect(bubbleScale(3)).toBeCloseTo(5 / 3);
    for (const ratio of [1, 1.25, 1.5, 5 / 3, 2, 2.625, 3]) {
      const scale = bubbleScale(ratio);
      expect(scale * 7, `capital height at ${ratio}`).toBeGreaterThanOrEqual(9.8);
      expect(scale).toBeLessThanOrEqual(2.4);
    }
  });

  it("moves the tail where asked and keeps it off the corners", () => {
    const spec = { text: "hello there", tone: "say" } as const;
    const width = bubbleWidth(spec);
    expect(bubble({ ...spec, tailX: 10 }).anchor.x).toBe(10);
    expect(bubble({ ...spec, tailX: 10.4 }).anchor.x).toBe(10);
    expect(bubble({ ...spec, tailX: -50 }).anchor.x).toBe(4);
    expect(bubble({ ...spec, tailX: 999 }).anchor.x).toBe(width - 5);
    expect(bubble({ ...spec, tailX: 10 }).width).toBe(width);
  });

  it("tells tones and tool states apart without colour", () => {
    const ink = (bitmap: Bitmap, fill: number) =>
      Array.from(bitmap.pixels, (value) => (value !== 0 && value !== fill && value !== slotIndex("outline") ? 1 : 0)).join("");
    const shapes = [
      ...TONES.map((tone) => bubble({ text: "go", tone, maxWidth: 60 })),
      bubble({ text: "go", tone: "tool", status: "completed", maxWidth: 60 }),
      bubble({ text: "go", tone: "tool", status: "failed", maxWidth: 60 }),
      bubble({ text: "go", tone: "tool", status: "canceled", maxWidth: 60 }),
    ].map((drawn) => `${drawn.width}:${ink(drawn, drawn.pixels[drawn.width + 2]!)}`);
    expect(new Set(shapes).size).toBe(shapes.length);
    // Speech has rounded corners, the tool box square ones.
    expect(bubble({ text: "go", tone: "say" }).pixels[0]).toBe(0);
    expect(bubble({ text: "go", tone: "tool" }).pixels[0]).toBe(slotIndex("outline"));
  });

  it("draws the words it was given", () => {
    const plain = bubble({ text: "Lỗi", tone: "say" });
    expect(plain).toBe(bubble({ text: "Loi", tone: "say" }));
    expect(plain.pixels).not.toEqual(bubble({ text: "Lol", tone: "say" }).pixels);
    expect(bubble({ text: "", tone: "say" }).width).toBe(9);
    expect(bubble({ text: "a b", tone: "say", maxWidth: 9 + 5 })).not.toBe(bubble({ text: "a b", tone: "say" }));
  });

  it("makes a count plate with the digits on it", () => {
    const plate = tag("159");
    expect(plate.height).toBe(12);
    expect(plate.width).toBe(2 + 4 + textWidth("159"));
    expect(plate.anchor).toEqual({ x: Math.floor(plate.width / 2), y: 12 });
    expect(opaque(plate).every(Boolean)).toBe(true);
    expect(plate.pixels).not.toEqual(tag("158").pixels);
    expect(tag("159")).toBe(plate);
  });

  it("keeps a bounded number of drawings", () => {
    const first = bubble({ text: "bound 0", tone: "say" });
    for (let index = 1; index <= BUBBLE_MAX_CACHED; index++) bubble({ text: `bound ${index}`, tone: "say" });
    const again = bubble({ text: "bound 0", tone: "say" });
    expect(again).not.toBe(first);
    expect(again.pixels).toEqual(first.pixels);
  });
});

describe("scale", () => {
  it("offers only whole numbers of device pixels per art pixel", () => {
    expect([0.4, 1, 1.4, 1.5, 1.9, 2].map((target) => crispScale(target, 2))).toEqual([0.5, 1, 1, 1.5, 1.5, 2]);
    expect([0.5, 1, 1.5, 2.9].map((target) => crispScale(target, 1))).toEqual([1, 1, 1, 2]);
    expect(crispScale(1.5, 3)).toBeCloseTo(4 / 3);
    const ratio = 5 / 3;
    for (const target of [1, 1.2, 1.5, 2]) {
      const scale = crispScale(target, ratio);
      expect(scale).toBeLessThanOrEqual(target + 1e-9);
      expect(scale * ratio).toBeCloseTo(Math.round(scale * ratio));
    }
    expect(crispScale(1.2, ratio)).toBeCloseTo(1.2);
  });

  it("rounds up or to the nearest when asked", () => {
    expect(crispScale(1.4, 2, "up")).toBe(1.5);
    expect(crispScale(1.5, 2, "up")).toBe(1.5);
    expect(crispScale(1.2, 2, "nearest")).toBe(1);
    expect(crispScale(1.3, 2, "nearest")).toBe(1.5);
    expect(crispScale(1.4, 1, "up")).toBe(2);
  });

  it("encodes at the device pixels the scale stands for", () => {
    expect(devicePixels(1.5, 2)).toBe(3);
    expect(devicePixels(crispScale(1.5, 5 / 3), 5 / 3)).toBe(2);
    expect(devicePixels(0.1, 1)).toBe(1);
  });

  it("snaps a length to the device grid", () => {
    expect(snap(10.3, 2)).toBe(10.5);
    expect(snap(10.3, 1)).toBe(10);
    expect(snap(7.2, 5 / 3) * (5 / 3)).toBeCloseTo(12);
  });
});
