/**
 * Motion as data. A glide is one straight move with a start time and a length,
 * and a cycle is a loop of frames on a beat: whoever draws them hands both to
 * the platform's own animation, so that nothing here needs a frame callback.
 */

export interface Px {
  x: number;
  y: number;
}

/** One straight move in pixels: from `from` at `at` (epoch ms) to `to`, `ms` later, at an even pace. */
export interface Glide {
  from: Px;
  to: Px;
  ms: number;
  at: number;
}

export function restingAt(at: Px, now: number): Glide {
  return { from: at, to: at, ms: 0, at: now };
}

/** Where a glide has got to. */
export function glideAt(glide: Glide, now: number): Px {
  if (glide.ms <= 0 || now >= glide.at + glide.ms) return glide.to;
  const done = Math.max(0, (now - glide.at) / glide.ms);
  return {
    x: glide.from.x + (glide.to.x - glide.from.x) * done,
    y: glide.from.y + (glide.to.y - glide.from.y) * done,
  };
}

export interface Piece {
  to: Px;
  ms: number;
}

/**
 * What is left of a glide at `now`, cut where it crosses one of the `knots`.
 * A follower whose own position is a line of the leader's with bends at those
 * knots (a bubble held inside the office) moves in a straight line within each
 * piece, so it can be handed to the platform piece by piece.
 */
export function glidePieces(
  glide: Glide,
  now: number,
  knotsX: readonly number[],
  knotsY: readonly number[],
): Piece[] {
  const left = glide.at + glide.ms - now;
  if (glide.ms <= 0 || left <= 0) return [{ to: glide.to, ms: 0 }];
  const start = glideAt(glide, now);
  // Fractions of the remaining way at which a knot is crossed.
  const cuts: number[] = [];
  const cross = (from: number, to: number, knots: readonly number[]) => {
    if (from === to) return;
    for (const knot of knots) {
      const at = (knot - from) / (to - from);
      if (at > 1e-6 && at < 1 - 1e-6) cuts.push(at);
    }
  };
  cross(start.x, glide.to.x, knotsX);
  cross(start.y, glide.to.y, knotsY);
  cuts.sort((a, b) => a - b);
  const pieces: Piece[] = [];
  let before = 0;
  for (const cut of [...cuts, 1]) {
    if (cut - before < 1e-6) continue;
    pieces.push({
      to: {
        x: start.x + (glide.to.x - start.x) * cut,
        y: start.y + (glide.to.y - start.y) * cut,
      },
      ms: (cut - before) * left,
    });
    before = cut;
  }
  return pieces;
}

/** A loop of frames: `frames[beat % frames.length]` shows on each beat of `beatMs`. */
export interface Cycle {
  frames: readonly number[];
  beatMs: number;
}

/** The frame a cycle shows at `now`. Every cycle runs on the one clock, so equal cycles are in step. */
export function frameAt(cycle: Cycle, now: number): number {
  const length = cycle.frames.length;
  if (length === 0) return 0;
  return cycle.frames[Math.floor(now / cycle.beatMs) % length] ?? 0;
}

/** One frame's turn in a cycle: from beat `start`, for `length` beats, wrapping round the end. */
export interface Run {
  frame: number;
  start: number;
  length: number;
}

/**
 * Each frame's turn, when every frame has exactly one turn per loop: then a
 * frame is a layer that shows for one stretch of the loop and a stepped
 * animation can do it. Null when a frame comes round twice; a cycle of one
 * frame has one run, the whole loop.
 */
export function cycleRuns(cycle: Cycle): Run[] | null {
  const { frames } = cycle;
  const length = frames.length;
  if (length === 0) return null;
  // Start where a turn begins, so that no turn is split by the end of the array.
  let first = 0;
  for (let beat = 0; beat < length; beat += 1) {
    if (frames[beat] !== frames[(beat + length - 1) % length]) {
      first = beat;
      break;
    }
  }
  const runs: Run[] = [];
  for (let offset = 0; offset < length; ) {
    const start = (first + offset) % length;
    const frame = frames[start] ?? 0;
    let run = 1;
    while (offset + run < length && frames[(first + offset + run) % length] === frame) run += 1;
    if (runs.some((entry) => entry.frame === frame)) return null;
    runs.push({ frame, start, length: run });
    offset += run;
  }
  return runs;
}

/**
 * How far into its own loop a run's animation is at `now`, in ms: an animation
 * that begins with the run's turn and is started `now` with this much already
 * behind it (a negative delay) shows the frame exactly on the cycle's beats.
 */
export function runElapsed(cycle: Cycle, run: Run, now: number): number {
  const period = cycle.frames.length * cycle.beatMs;
  const since = (now - run.start * cycle.beatMs) % period;
  return since < 0 ? since + period : since;
}

/** Whether a run's layer shows at `now`; what the stepped animation does, for tests and for platforms without it. */
export function runShows(cycle: Cycle, run: Run, now: number): boolean {
  return runElapsed(cycle, run, now) < run.length * cycle.beatMs;
}
