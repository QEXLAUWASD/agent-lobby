/**
 * When a view next has something new to draw though nothing has been told to
 * it, and whether it is on screen at all. A view at rest holds one timeout for
 * that moment, or none; a view that is not shown holds nothing.
 */

/** Ages are read to the minute at best; one may be this late, and many changing together cost one wake. */
export const AGE_SLACK_MS = 15_000;
/** A timeout further off than this is set again when it fires: timers do not take arbitrary lengths. */
export const WAKE_MAX_MS = 6 * 60 * 60_000;
/** Past the moment itself, so that the wake finds the change already due. */
const WAKE_PAST_MS = 20;

/**
 * The earlier of the next change in the office (exact) and the next age that
 * reads differently (no sooner than the slack from now). Null when neither is coming.
 */
export function nextWake(presenceAt: number | null, ageAts: Iterable<number | null>, now: number): number | null {
  let age: number | null = null;
  for (const at of ageAts) if (at !== null && (age === null || at < age)) age = at;
  if (age !== null) age = Math.max(age, now + AGE_SLACK_MS);
  if (presenceAt === null) return age;
  return age === null ? presenceAt : Math.min(presenceAt, age);
}

/** How long to sleep until `at`; null when there is nothing to wake for. */
export function wakeDelay(at: number | null, now: number): number | null {
  if (at === null) return null;
  return Math.min(WAKE_MAX_MS, Math.max(WAKE_PAST_MS, at - now + WAKE_PAST_MS));
}

/**
 * A pane the host keeps mounted while it shows another tab is laid out with no
 * size. So is one that has not been laid out yet: neither has anything to keep up to date.
 */
export function paneShown(width: number, height: number): boolean {
  return width > 0 && height > 0;
}

/**
 * How long a pane has to have had no size before it counts as hidden. A layout
 * can pass through nothing on its way somewhere (a splitter dragged, a tab
 * changing); letting go of every subscription for that would cost a reload.
 * Showing is not delayed.
 */
export const HIDE_AFTER_MS = 300;
