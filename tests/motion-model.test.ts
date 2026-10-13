import { describe, expect, it } from "vitest";
import { actFrame } from "../client/scene-model";
import { frameAt, glideAt, glidePieces, loopOf, nextChange, nextTick, type Cycle, type Glide } from "../client/motion-model";

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

describe("nextChange", () => {
  it("is the start of the next beat for a plain loop", () => {
    const type = loopOf(2, 280);
    expect(nextChange(type, 0)).toBe(280);
    expect(nextChange(type, 279)).toBe(280);
    expect(nextChange(type, 280)).toBe(560);
    expect(nextChange(loopOf(8, 320), 1_000)).toBe(1_280);
  });

  it("skips the beats a frame is held for, round the end of the loop too", () => {
    const sip: Cycle = { frames: [1, 1, 0, 0, 0, 0, 0, 0, 0, 0], beatMs: 280 };
    expect(nextChange(sip, 0)).toBe(560);
    expect(nextChange(sip, 560)).toBe(2_800);
    expect(nextChange(sip, 2_700)).toBe(2_800);
  });

  it("is always a moment at which the frame really changes, and none is skipped before it", () => {
    for (const cycle of [loopOf(4, 140), loopOf(2, 900), { frames: [0, 0, 1, 0, 1, 1, 0], beatMs: 280 }]) {
      let now = 123_457;
      for (let step = 0; step < 40; step += 1) {
        const at = nextChange(cycle, now)!;
        expect(at).toBeGreaterThan(now);
        expect(frameAt(cycle, at)).not.toBe(frameAt(cycle, now));
        for (let t = now; t < at; t += 35) expect(frameAt(cycle, t)).toBe(frameAt(cycle, now));
        now = at;
      }
    }
  });

  it("is null for what never changes: one frame, or the same frame on every beat", () => {
    expect(nextChange(loopOf(1, 280), 5_000)).toBeNull();
    expect(nextChange({ frames: [1, 1, 1], beatMs: 280 }, 5_000)).toBeNull();
    expect(nextChange({ frames: [], beatMs: 280 }, 5_000)).toBeNull();
  });
});

describe("nextTick", () => {
  it("is the earliest change among the loops on screen, so one timer serves them all", () => {
    const loops = [loopOf(2, 280), loopOf(8, 320), loopOf(2, 800)];
    expect(nextTick(loops, 0)).toBe(280);
    expect(nextTick(loops, 280)).toBe(320);
    expect(nextTick(loops, 320)).toBe(560);
    expect(nextTick(loops, 700)).toBe(800);
  });

  it("is null with no loop, or only loops that hold still: then there is no timer", () => {
    expect(nextTick([], 1_000)).toBeNull();
    expect(nextTick([loopOf(1, 280), { frames: [0, 0], beatMs: 900 }], 1_000)).toBeNull();
  });

  it("wakes once for loops that change together, and as rarely as the slowest loop when it is alone", () => {
    const wakes = (loops: Cycle[], from: number, to: number) => {
      let now = from;
      let count = 0;
      for (;;) {
        const at = nextTick(loops, now);
        if (at === null || at > to) return count;
        count += 1;
        now = at;
      }
    };
    // Ten seconds: five typists wake the timer as often as one does.
    expect(wakes([loopOf(2, 280)], 0, 10_000)).toBe(35);
    expect(wakes(Array.from({ length: 5 }, () => loopOf(2, 280)), 0, 10_000)).toBe(35);
    // A room with only finished agents: the bob alone, 1.25 a second.
    expect(wakes([loopOf(2, 800), loopOf(2, 800)], 0, 10_000)).toBe(12);
  });
});
