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
import { ANIMATION_MAX_CACHED, animation, characterAnimation, deskAnimation, emoteAnimation, stateIcon } from "../client/pixel/anim";
import { EMOTE_FRAMES, EMOTE_SIZE, emote, type EmoteId } from "../client/pixel/emotes";
import { ICON_FRAMES, ICON_SIZE, icon, type IconState } from "../client/pixel/icons";
import { ELLIPSIS, FACES, FALLBACK, FONT_HEIGHT, GLYPH_CHARS, ICON, glyph } from "../client/pixel/font";
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
const EMOTES: EmoteId[] = ["alert", "question", "fail", "check", "zzz", "thinking", "readyCup"];
const READY_EMOTES: EmoteId[] = ["readyBob", "readySpark", "readyCup"];
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
    expect(lookFor("1a2b3c4d")).toEqual(lookFor("1a2b3c4d"));
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
    // A working screen is an eight-frame loop in which every frame differs from the one before.
    const lit = Array.from({ length: 8 }, (_, frame) => prop("desk", { screen: "lit", frame }));
    lit.forEach((frame, index) => expect(frame.pixels, `frame ${index}`).not.toEqual(lit[(index + 7) % 8]!.pixels));
    expect(prop("desk", { screen: "lit", frame: 8 })).toBe(lit[0]);
    expect(new Set(lit.map((frame) => frame.pixels.join())).size).toBe(8);
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
  it("draws every glyph of both faces as a clean grid inside the line", () => {
    for (const face of ["regular", "small"] as const) {
      const { ascent, height, glyphs } = FACES[face];
      expect(Object.keys(glyphs).sort()).toEqual([...GLYPH_CHARS].sort());
      const shapes = new Map<string, string>();
      for (const char of GLYPH_CHARS) {
        const { width, rows } = glyph(char, face);
        expect(width, `${face} ${char}`).toBeGreaterThan(0);
        expect(rows.length, `${face} ${char}`).toBeGreaterThanOrEqual(ascent);
        expect(rows.length, `${face} ${char}`).toBeLessThanOrEqual(height);
        for (const line of rows) expect(line, `${face} ${char}`).toMatch(new RegExp(`^[#.]{${width}}$`));
        if (char !== " ") expect(rows.join("").includes("#"), `${face} ${char}`).toBe(true);
        const shape = rows.join("/").replace(/(\/\.+)+$/, "");
        expect(shapes.get(shape), `${face}: ${char} looks like ${shapes.get(shape)}`).toBeUndefined();
        shapes.set(shape, char);
      }
    }
    expect([FONT_HEIGHT, FACES.small.height]).toEqual([9, 6]);
    for (const char of "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,:;!?-_+=/()[]<>'\"#@&%*") {
      expect(GLYPH_CHARS, char).toContain(char);
    }
  });

  it("measures and wraps in the face asked for", () => {
    expect(textWidth("Bash", "small")).toBe(15);
    expect(textWidth("Bash", "small")).toBeLessThan(textWidth("Bash"));
    const text = "Đang kiểm tra hiện trạng của hệ thống";
    for (const line of wrapText(text, 56, 3, "small")) expect(textWidth(line, "small")).toBeLessThanOrEqual(56);
    expect(wrapText(text, 56, 9, "small").length).toBeLessThan(wrapText(text, 56, 9).length);
    expect(textWidth(fitText(text, 40, "small"), "small")).toBeLessThanOrEqual(40);
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
  const FACE_NAMES = ["small", "regular"] as const;
  const row = (bitmap: Bitmap, y: number) => [...bitmap.pixels.slice(y * bitmap.width, (y + 1) * bitmap.width)];
  const LONG = "Xong rồi, đã sửa lỗi ở cổng thanh toán và chạy lại toàn bộ kiểm thử";

  it("is the size bubbleSize says, anchored at the tail, in either face", () => {
    for (const face of FACE_NAMES) {
      for (const tone of TONES) {
        for (const text of ["", "ok", "Bash", LONG]) {
          for (const maxWidth of [undefined, 30, 60, 146]) {
            for (const maxLines of [undefined, 1, 2]) {
              const spec = { text, tone, maxWidth, maxLines, face };
              const drawn = bubble(spec);
              expect({ width: drawn.width, height: drawn.height }).toEqual(bubbleSize(spec));
              expect(drawn.width).toBe(bubbleWidth(spec));
              expect(drawn.width).toBeLessThanOrEqual(maxWidth ?? (face === "small" ? 64 : 88));
              expect(drawn.anchor).toEqual({ x: Math.floor(drawn.width / 2), y: drawn.height });
              // The tip of the tail is the only pixel on the last row.
              expect(row(drawn, drawn.height - 1).filter(Boolean)).toHaveLength(1);
              expect(row(drawn, drawn.height - 1)[drawn.anchor.x]).toBe(slotIndex("outline"));
            }
          }
        }
      }
    }
  });

  it("keeps the default bubble in proportion to a character", () => {
    expect(BUBBLE_MAX_WIDTH).toBe(64);
    expect(BUBBLE_HEIGHT).toBe(10);
    // A one-word tool bubble: about a character wide, well under half its height.
    expect(bubbleSize({ text: "Bash", tone: "tool" })).toEqual({ width: 19, height: 9 });
    expect(bubbleSize({ text: "Read", tone: "tool", status: "completed" }).width).toBeLessThanOrEqual(26);
    for (const name of ["Bash", "Read", "Edit", "Grep", "Write", "Task"]) {
      expect(bubbleSize({ text: name, tone: "tool" }).width, name).toBeLessThanOrEqual(1.5 * CHARACTER_WIDTH);
    }
    expect([1, 2, 3].map((maxLines) => bubbleSize({ text: LONG, tone: "say", maxLines }).height)).toEqual([10, 17, 24]);
    expect(bubbleSize({ text: LONG, tone: "say" }).height).toBeLessThanOrEqual(CHARACTER_HEIGHT);
    // The regular face is still there for a caller that wants it.
    expect([1, 2, 3].map((maxLines) => bubbleSize({ text: LONG, tone: "say", maxLines, face: "regular" }).height)).toEqual([14, 23, 32]);
    expect(bubbleSize({ text: "Bash", tone: "tool", face: "regular" }).width).toBeGreaterThan(19);
  });

  it("grows only as far as the lines allowed, and a tool stays on one", () => {
    expect(bubbleSize({ text: "ok", tone: "say" }).height).toBe(10);
    expect(bubbleSize({ text: LONG, tone: "say", maxLines: 9, maxWidth: 300 }).height).toBeLessThan(24);
    expect(bubbleSize({ text: LONG, tone: "tool", maxLines: 3 }).height).toBe(9);
    const inked = (maxLines: number) => {
      const drawn = bubble({ text: LONG, tone: "say", maxLines });
      return [...drawn.pixels].filter((value) => value === slotIndex("outline")).length;
    };
    expect(inked(2)).toBeGreaterThan(inked(1));
    expect(inked(3)).toBeGreaterThan(inked(2));
  });

  it("is drawn at the room's scale", () => {
    expect(bubbleScale(2)).toBe(1);
    expect(bubbleScale(1)).toBe(1);
    expect(bubbleScale(5 / 3)).toBeCloseTo(1.2);
    expect(bubbleScale(3)).toBe(1);
  });

  it("moves the tail where asked and keeps it off the corners", () => {
    const spec = { text: "hello there", tone: "say" } as const;
    const width = bubbleWidth(spec);
    expect(bubble({ ...spec, tailX: 10 }).anchor.x).toBe(10);
    expect(bubble({ ...spec, tailX: 10.4 }).anchor.x).toBe(10);
    expect(bubble({ ...spec, tailX: -50 }).anchor.x).toBe(2);
    expect(bubble({ ...spec, tailX: 999 }).anchor.x).toBe(width - 3);
    expect(bubble({ ...spec, tailX: 10 }).width).toBe(width);
    expect(bubble({ ...spec, face: "regular", tailX: -50 }).anchor.x).toBe(4);
  });

  it("tells tones and tool states apart without colour", () => {
    // The fill is whatever colour covers most of the bubble; the marks are everything else inside.
    const fillOf = (bitmap: Bitmap) => {
      const counts = new Map<number, number>();
      for (const value of bitmap.pixels) if (value !== 0) counts.set(value, (counts.get(value) ?? 0) + 1);
      return [...counts].sort((one, other) => other[1] - one[1])[0]![0];
    };
    const ink = (bitmap: Bitmap) => {
      const fill = fillOf(bitmap);
      const edge = (index: number) => {
        const [x, y] = [index % bitmap.width, Math.floor(index / bitmap.width)];
        return x < 2 || y < 1 || x > bitmap.width - 3 || y > bitmap.height - 4;
      };
      return Array.from(bitmap.pixels, (value, index) => (value !== 0 && value !== fill && !edge(index) ? 1 : 0)).join("");
    };
    for (const face of FACE_NAMES) {
      const drawn = [
        ...TONES.map((tone) => bubble({ text: "go", tone, maxWidth: 60, face })),
        bubble({ text: "go", tone: "tool", status: "completed", maxWidth: 60, face }),
        bubble({ text: "go", tone: "tool", status: "failed", maxWidth: 60, face }),
        bubble({ text: "go", tone: "tool", status: "canceled", maxWidth: 60, face }),
      ];
      // Shape (corners, height), width and the marks inside, never the fill colour.
      const shapes = drawn.map((one) => `${one.width}x${one.height}:${one.pixels[0] === 0}:${ink(one)}`);
      expect(new Set(shapes).size, face).toBe(shapes.length);
      // Speech has its corners taken off, the tool box has them.
      expect(bubble({ text: "go", tone: "say", face }).pixels[0]).toBe(0);
      expect(bubble({ text: "go", tone: "tool", face }).pixels[0]).toBe(slotIndex("outline"));
    }
  });

  it("draws the words it was given", () => {
    const plain = bubble({ text: "Lỗi", tone: "say" });
    expect(plain).toBe(bubble({ text: "Loi", tone: "say" }));
    expect(plain.pixels).not.toEqual(bubble({ text: "Lol", tone: "say" }).pixels);
    expect(plain).not.toBe(bubble({ text: "Loi", tone: "say", face: "regular" }));
    expect(bubble({ text: "", tone: "say" }).width).toBe(5);
    expect(bubble({ text: "", tone: "say", face: "regular" }).width).toBe(9);
  });

  it("makes a count plate with the digits on it", () => {
    const plate = tag("159");
    expect([plate.width, plate.height]).toEqual([2 + 2 + textWidth("159", "small"), 9]);
    expect(plate.anchor).toEqual({ x: Math.floor(plate.width / 2), y: 9 });
    expect(opaque(plate).every(Boolean)).toBe(true);
    expect(plate.pixels).not.toEqual(tag("158").pixels);
    expect(tag("159")).toBe(plate);
    expect(tag("159", "regular").height).toBe(12);
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

describe("ready emotes", () => {
  it("keeps the check, or the ready colour, and moves", () => {
    const ink = (bitmap: Bitmap) => Array.from(bitmap.pixels, (value) => (value === slotIndex("emoteReadyInk") ? 1 : 0));
    const check = ink(emote("check"));
    // Bob and spark open on the plain check; the glint only ever covers one pixel of it.
    expect(emote("readyBob").pixels).toEqual(emote("check").pixels);
    expect(emote("readySpark").pixels).toEqual(emote("check").pixels);
    for (let frame = 0; frame < EMOTE_FRAMES.readySpark; frame++) {
      expect(difference(check, ink(emote("readySpark", frame)))).toBeLessThanOrEqual(1);
    }
    for (const id of READY_EMOTES) {
      expect(EMOTE_FRAMES[id]).toBeGreaterThan(1);
      const frames = Array.from({ length: EMOTE_FRAMES[id] }, (_, frame) => emote(id, frame));
      expect(new Set(frames.map((frame) => frame.pixels.join())).size).toBeGreaterThan(1);
      for (const frame of frames) {
        expect([frame.width, frame.height]).toEqual([EMOTE_SIZE, EMOTE_SIZE]);
        expect([...frame.pixels]).toContain(slotIndex("emoteReady"));
      }
    }
    // Settled, the bubble still ends in a tail at the anchor.
    const settled = emote("readyBob", 1);
    expect(settled.pixels[11 * 12 + 5]).toBe(slotIndex("outline"));
    expect(opaque(settled).slice(0, 12).some(Boolean)).toBe(false);
  });
});

describe("state icons", () => {
  const STATES: IconState[] = ["needs-input", "failed", "working", "ready", "idle", "closed"];

  it("draws one 8 x 8 icon per state, each its own shape", () => {
    const shapes = STATES.map((state) => {
      const still = icon(state);
      expect([still.width, still.height]).toEqual([ICON_SIZE, ICON_SIZE]);
      expect(opaque(still).filter(Boolean).length, state).toBeGreaterThanOrEqual(8);
      return opaque(still);
    });
    for (let a = 0; a < shapes.length; a++) {
      for (let b = a + 1; b < shapes.length; b++) {
        expect(difference(shapes[a]!, shapes[b]!), `${STATES[a]} vs ${STATES[b]}`).toBeGreaterThanOrEqual(12);
      }
    }
  });

  it("moves the icons that should move and keeps the rest still", () => {
    expect(ICON_FRAMES).toMatchObject({ failed: 1, closed: 1 });
    for (const state of ["needs-input", "working", "ready", "idle"] as const) {
      const frames = Array.from({ length: ICON_FRAMES[state] }, (_, frame) => icon(state, frame));
      expect(new Set(frames.map((frame) => frame.pixels.join())).size, state).toBeGreaterThan(1);
    }
    // Needs input hops rather than blinks: the badge is whole in every frame.
    const drawn = Array.from({ length: ICON_FRAMES["needs-input"] }, (_, frame) => opaque(icon("needs-input", frame)).filter(Boolean).length);
    expect(new Set(drawn).size).toBe(1);
    // Ready never loses its check, and working never loses its monitor frame.
    const check = opaque(icon("ready"));
    for (let frame = 0; frame < ICON_FRAMES.ready; frame++) {
      expect(opaque(icon("ready", frame)).every((value, index) => value >= check[index]!)).toBe(true);
    }
    expect(icon("working", 1).pixels.slice(0, 8)).toEqual(icon("working", 0).pixels.slice(0, 8));
  });

  it("takes its colours from the theme's status colours", () => {
    for (const [state, slot] of [
      ["needs-input", "emoteAlert"],
      ["failed", "emoteFail"],
      ["working", "emoteThinking"],
      ["ready", "emoteReady"],
      ["idle", "emoteIdle"],
    ] as const) {
      expect([...icon(state).pixels], state).toContain(slotIndex(slot));
    }
  });
});

describe("animation strips", () => {
  it("lays the frames side by side, the still first", () => {
    const desk = deskAnimation("lit");
    expect([desk.frames, desk.frameWidth, desk.frameHeight]).toEqual([8, 32, 28]);
    expect([desk.strip.width, desk.strip.height]).toEqual([8 * 32, 28]);
    expect(desk.still).toBe(prop("desk", { screen: "lit", frame: 0 }));
    expect(desk.anchor).toEqual(desk.still.anchor);
    for (let frame = 0; frame < desk.frames; frame++) {
      const expected = prop("desk", { screen: "lit", frame });
      for (let y = 0; y < 28; y++) {
        const from = y * desk.strip.width + frame * 32;
        expect([...desk.strip.pixels.slice(from, from + 32)]).toEqual([...expected.pixels.slice(y * 32, (y + 1) * 32)]);
      }
    }
  });

  it("gives a still thing one frame and no strip of its own", () => {
    for (const still of [deskAnimation("off"), deskAnimation("error"), stateIcon("failed"), emoteAnimation("check")]) {
      expect(still.frames).toBe(1);
      expect(still.strip).toBe(still.still);
    }
  });

  it("covers icons, emotes and poses with sensible timings", () => {
    expect(stateIcon("working")).toMatchObject({ frames: 4, frameWidth: 8, frameHeight: 8 });
    expect(stateIcon("working").strip.width).toBe(32);
    expect(emoteAnimation("readySpark")).toMatchObject({ frames: 8, frameWidth: 12 });
    const walk = characterAnimation({ role: "meow", look: LOOK, pose: "walk", facing: "left" });
    expect([walk.frames, walk.strip.width, walk.strip.height]).toEqual([4, 64, 24]);
    expect(walk.still).toBe(character({ role: "meow", look: LOOK, pose: "walk", facing: "left", frame: 0 }));
    const lying = characterAnimation({ role: "meow", look: LOOK, pose: "lie" });
    expect([lying.frameWidth, lying.frameHeight, lying.anchor]).toEqual([24, 16, { x: 12, y: 16 }]);
    for (const one of [stateIcon("needs-input"), stateIcon("idle"), deskAnimation("lit"), emoteAnimation("readyBob"), walk]) {
      expect(one.frameMs).toBeGreaterThanOrEqual(100);
      expect(one.frames * one.frameMs).toBeLessThanOrEqual(4000);
    }
  });

  it("returns the same animation for the same thing, within a bound", () => {
    expect(stateIcon("ready")).toBe(stateIcon("ready"));
    expect(characterAnimation({ role: "agent", look: LOOK })).toBe(characterAnimation({ role: "agent", look: { ...LOOK }, pose: "idle" }));
    const first = animation("bound-0", [tile("floor")], 100);
    for (let index = 1; index <= ANIMATION_MAX_CACHED; index++) animation(`bound-${index}`, [tile("floor")], 100);
    expect(animation("bound-0", [tile("floor")], 100)).not.toBe(first);
    expect(() => animation("empty", [], 100)).toThrow();
    expect(() => animation("ragged", [tile("floor"), prop("plant")], 100)).toThrow(/different size/);
  });
});
