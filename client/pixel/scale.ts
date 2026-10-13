/**
 * Which sizes are crisp. A sprite is sharp when one art pixel covers a whole number of device
 * pixels, so the usable layout scales are k / pixelRatio for k = 1, 2, 3...: on a 2x screen 0.5, 1,
 * 1.5, 2; on a 1x screen 1, 2, 3; on a 1.67x screen 0.6, 1.2, 1.8, 2.4.
 */

const EPSILON = 1e-6;

/** Device pixels per art pixel for a layout scale: the nearest whole number, at least 1. */
export function devicePixels(scale: number, pixelRatio: number): number {
  return Math.max(1, Math.round(scale * pixelRatio));
}

/**
 * The crisp layout scale nearest to `target` in the direction asked: `down` is the largest at or
 * below it, `up` the smallest at or above it, `nearest` whichever is closer. Never below one device
 * pixel per art pixel.
 */
export function crispScale(target: number, pixelRatio: number, round: "down" | "up" | "nearest" = "down"): number {
  const exact = target * pixelRatio;
  const whole =
    round === "down" ? Math.floor(exact + EPSILON) : round === "up" ? Math.ceil(exact - EPSILON) : Math.round(exact);
  return Math.max(1, whole) / pixelRatio;
}

/** A layout length moved to the nearest device pixel, so a sprite placed there does not blur. */
export function snap(value: number, pixelRatio: number): number {
  return Math.round(value * pixelRatio) / pixelRatio;
}
