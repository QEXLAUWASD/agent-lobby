import { describe, expect, it } from "vitest";
import { actFrame } from "../client/scene-model";
import { cycleRuns, frameAt, glideAt, glidePieces, runElapsed, runShows, type Cycle, type Glide } from "../client/motion-model";

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

describe("cycleRuns", () => {
  it("gives each frame of a plain loop one beat", () => {
    expect(cycleRuns({ frames: [0, 1, 2, 3], beatMs: 140 })).toEqual([
      { frame: 0, start: 0, length: 1 },
      { frame: 1, start: 1, length: 1 },
      { frame: 2, start: 2, length: 1 },
      { frame: 3, start: 3, length: 1 },
    ]);
  });

  it("joins a turn that wraps round the end of the loop", () => {
    expect(cycleRuns({ frames: [0, 1, 1, 0, 0], beatMs: 280 })).toEqual([
      { frame: 1, start: 1, length: 2 },
      { frame: 0, start: 3, length: 3 },
    ]);
  });

  it("is one run for a still, and null when a frame comes round twice", () => {
    expect(cycleRuns({ frames: [0, 0], beatMs: 280 })).toEqual([{ frame: 0, start: 0, length: 2 }]);
    expect(cycleRuns({ frames: [0, 1, 0, 1, 1], beatMs: 280 })).toBeNull();
    expect(cycleRuns({ frames: [], beatMs: 280 })).toBeNull();
  });
});

describe("a cycle as stepped layers", () => {
  const cycles: Cycle[] = [
    { frames: [0, 1], beatMs: 280 },
    { frames: [0, 1, 2, 3], beatMs: 140 },
    ...(["drink", "stretch", "talk", "doze"] as const).flatMap((act) =>
      [0, 1, 6, 7].map((seed) => ({
        frames: Array.from({ length: 280 }, (_, beat) => actFrame(act, beat, seed)).slice(0, { drink: 10, stretch: 14, talk: 4, doze: 8 }[act]),
        beatMs: 280,
      })),
    ),
  ];

  it("shows exactly the frame of the beat, at every moment, for every cycle the scene uses", () => {
    for (const cycle of cycles) {
      const runs = cycleRuns(cycle);
      expect(runs).not.toBeNull();
      for (let now = 1_000_003; now < 1_000_003 + 3 * cycle.frames.length * cycle.beatMs; now += 35) {
        const showing = runs!.filter((run) => runShows(cycle, run, now)).map((run) => run.frame);
        expect(showing).toEqual([frameAt(cycle, now)]);
      }
    }
  });

  it("starts a layer as far into its loop as the clock is", () => {
    const cycle: Cycle = { frames: [0, 1, 1, 0, 0], beatMs: 100 };
    const [ones] = cycleRuns(cycle)!;
    expect(runElapsed(cycle, ones!, 100)).toBe(0);
    expect(runElapsed(cycle, ones!, 250)).toBe(150);
    expect(runElapsed(cycle, ones!, 50)).toBe(450);
  });
});
