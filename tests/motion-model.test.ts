import { describe, expect, it } from "vitest";
import { actFrame } from "../client/scene-model";
import { frameAt, glideAt, glidePieces, type Cycle, type Glide } from "../client/motion-model";

const glide: Glide = { from: { x: 0, y: 10 }, to: { x: 100, y: 10 }, ms: 1000, at: 5000 };

describe("glideAt", () => {
  it("is on the line between the ends, at an even pace", () => {
    expect(glideAt(glide, 5000)).toEqual({ x: 0, y: 10 });
    expect(glideAt(glide, 5250)).toEqual({ x: 25, y: 10 });
    expect(glideAt(glide, 4000)).toEqual({ x: 0, y: 10 });
  });

  it("is the end itself once it is over, and for a glide of no length", () => {
    expect(glideAt(glide, 6000)).toBe(glide.to);
    expect(glideAt({ ...glide, ms: 0 }, 5000)).toBe(glide.to);
  });
});

describe("glidePieces", () => {
  it("is one piece to the end when no knot is crossed", () => {
    expect(glidePieces(glide, 5000, [-5, 100, 200], [10])).toEqual([{ to: { x: 100, y: 10 }, ms: 1000 }]);
  });

  it("cuts at each knot on the way, in order, and the pieces add up to what is left", () => {
    const pieces = glidePieces(glide, 5200, [80, 40], []);
    expect(pieces.map((piece) => piece.to.x)).toEqual([40, 80, 100]);
    expect(pieces.map((piece) => Math.round(piece.ms))).toEqual([200, 400, 200]);
    expect(pieces.reduce((sum, piece) => sum + piece.ms, 0)).toBeCloseTo(800);
  });

  it("ignores a knot already passed", () => {
    expect(glidePieces(glide, 5500, [40], []).map((piece) => piece.to.x)).toEqual([100]);
  });

  it("cuts a glide down a column at the knots of its own axis", () => {
    const down: Glide = { from: { x: 5, y: 0 }, to: { x: 5, y: 60 }, ms: 600, at: 0 };
    expect(glidePieces(down, 0, [5], [20]).map((piece) => [piece.to.y, Math.round(piece.ms)])).toEqual([
      [20, 200],
      [60, 400],
    ]);
  });

  it("is where it ended, at once, when the glide is over or has no length", () => {
    expect(glidePieces(glide, 7000, [40], [])).toEqual([{ to: glide.to, ms: 0 }]);
    expect(glidePieces({ ...glide, ms: 0 }, 5000, [40], [])).toEqual([{ to: glide.to, ms: 0 }]);
  });
});

describe("frameAt", () => {
  it("shows each frame for one beat, in order, round and round", () => {
    const walk: Cycle = { frames: [0, 1, 2, 3], beatMs: 140 };
    expect([0, 139, 140, 279, 280, 420, 560, 700].map((now) => frameAt(walk, now))).toEqual([0, 0, 1, 1, 2, 3, 0, 1]);
  });

  it("puts every equal cycle in step, whenever it is asked: the clock is the only state", () => {
    const type: Cycle = { frames: [0, 1], beatMs: 280 };
    const now = 1_791_882_000_123;
    expect(frameAt(type, now)).toBe(frameAt({ frames: [0, 1], beatMs: 280 }, now));
    expect(frameAt(type, now + 280)).not.toBe(frameAt(type, now));
    expect(frameAt(type, now + 560)).toBe(frameAt(type, now));
  });

  it("follows actFrame beat for beat, for every activity the scene loops", () => {
    for (const act of ["drink", "stretch", "talk", "doze"] as const) {
      for (const seed of [0, 1, 6, 7]) {
        const beats = { drink: 10, stretch: 14, talk: 4, doze: 8 }[act];
        const cycle: Cycle = { frames: Array.from({ length: beats }, (_, beat) => actFrame(act, beat, seed)), beatMs: 280 };
        for (let beat = 0; beat < 3 * beats; beat += 1) {
          expect(frameAt(cycle, beat * 280 + 17)).toBe(actFrame(act, beat, seed));
        }
      }
    }
  });

  it("is frame 0 for a cycle of nothing", () => {
    expect(frameAt({ frames: [], beatMs: 280 }, 5_000)).toBe(0);
  });
});
