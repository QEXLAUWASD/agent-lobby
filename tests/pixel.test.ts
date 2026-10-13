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
import { BUBBLE_HEIGHT, BUBBLE_MAX_CACHED, bubble, bubbleWidth, type BubbleTone } from "../client/pixel/bubble";
import { contrast, luminance, mix, parseColor } from "../client/pixel/color";
import { EMOTE_FRAMES, EMOTE_SIZE, emote, type EmoteId } from "../client/pixel/emotes";
import { ELLIPSIS, FALLBACK, FONT_HEIGHT, GLYPH_CHARS, ICON, glyph } from "../client/pixel/font";
import { COMPOSITE_MAX_ENTRIES, composite, mirror, paint, type Bitmap } from "../client/pixel/grid";
import { Lru } from "../client/pixel/lru";
import { SLOTS, lookFor, officePalette, paletteColor, slotIndex } from "../client/pixel/palette";
import { adler32, crc32, deflate, encodeIndexedPng, pngDataUri, toBase64, upscale, type Rgba } from "../client/pixel/png";
import { PROPS, TILE, prop, tile, type PropId, type ScreenState } from "../client/pixel/props";
import { fitText, foldText, textWidth } from "../client/pixel/text";

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
const POSES: CharacterPose[] = ["idle", "walk", "sit", "sleep"];
const FACINGS: Facing[] = ["down", "up", "left", "right"];
const EMOTES: EmoteId[] = ["alert", "question", "fail", "check", "zzz", "thinking"];
const PROP_IDS: PropId[] = ["desk", "chair", "plant", "coffee", "sofa", "water", "envelope"];
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
            expect(sprite.width).toBe(CHARACTER_WIDTH);
            expect(sprite.height).toBe(CHARACTER_HEIGHT);
            expect(sprite.anchor).toEqual({ x: 8, y: 24 });
            // Feet, or the chair they sit on, reach the bottom row.
            expect(opaque(sprite).slice(-CHARACTER_WIDTH).some(Boolean)).toBe(true);
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

  it("draws square tiles with no holes", () => {
    for (const id of ["floor", "floorAlt", "wall", "wallCap"] as const) {
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

describe("bubbles", () => {
  const TONES: BubbleTone[] = ["say", "tool", "tell", "ask", "alert"];
  const row = (bitmap: Bitmap, y: number) => [...bitmap.pixels.slice(y * bitmap.width, (y + 1) * bitmap.width)];

  it("is as wide as bubbleWidth says, one height, anchored at the tail", () => {
    for (const tone of TONES) {
      for (const text of ["", "ok", "Bash", "Đang kiểm tra hiện trạng của toàn bộ hệ thống thanh toán"]) {
        for (const maxWidth of [undefined, 30, 60, 146]) {
          const spec = { text, tone, maxWidth };
          const drawn = bubble(spec);
          expect(drawn.width).toBe(bubbleWidth(spec));
          expect(drawn.width).toBeLessThanOrEqual(maxWidth ?? 120);
          expect(drawn.height).toBe(BUBBLE_HEIGHT);
          expect(drawn.anchor).toEqual({ x: Math.floor(drawn.width / 2), y: BUBBLE_HEIGHT });
          // The tip of the tail is the only pixel on the last row.
          expect(row(drawn, BUBBLE_HEIGHT - 1).filter(Boolean)).toHaveLength(1);
          expect(row(drawn, BUBBLE_HEIGHT - 1)[drawn.anchor.x]).toBe(slotIndex("outline"));
        }
      }
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
  });

  it("keeps a bounded number of drawings", () => {
    const first = bubble({ text: "bound 0", tone: "say" });
    for (let index = 1; index <= BUBBLE_MAX_CACHED; index++) bubble({ text: `bound ${index}`, tone: "say" });
    const again = bubble({ text: "bound 0", tone: "say" });
    expect(again).not.toBe(first);
    expect(again.pixels).toEqual(first.pixels);
  });
});
