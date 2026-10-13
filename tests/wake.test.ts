import { describe, expect, it } from "vitest";
import { AGE_SLACK_MS, WAKE_MAX_MS, nextWake, paneShown, wakeDelay } from "../client/wake";

describe("nextWake", () => {
  const now = 1_000_000;

  it("is null when nothing is coming, so a resting view holds no timer", () => {
    expect(nextWake(null, [], now)).toBeNull();
    expect(nextWake(null, [null, null], now)).toBeNull();
  });

  it("is the office's next change exactly", () => {
    expect(nextWake(now + 700, [], now)).toBe(now + 700);
  });

  it("is the earliest age, but no sooner than the slack: ages that change together cost one wake", () => {
    expect(nextWake(null, [now + 90_000, now + 60_000, null], now)).toBe(now + 60_000);
    expect(nextWake(null, [now + 2_000, now + 9_000], now)).toBe(now + AGE_SLACK_MS);
  });

  it("is whichever of the two comes first", () => {
    expect(nextWake(now + 5_000, [now + 2_000], now)).toBe(now + 5_000);
    expect(nextWake(now + 50_000, [now + 20_000], now)).toBe(now + 20_000);
  });
});

describe("wakeDelay", () => {
  it("sleeps to just past the moment", () => {
    expect(wakeDelay(10_500, 10_000)).toBe(520);
  });

  it("never spins on a moment already past, and never sets a timer longer than the cap", () => {
    expect(wakeDelay(9_000, 10_000)).toBe(20);
    expect(wakeDelay(10_000 + 30 * 24 * 3_600_000, 10_000)).toBe(WAKE_MAX_MS);
  });

  it("is null when there is nothing to wake for", () => {
    expect(wakeDelay(null, 10_000)).toBeNull();
  });
});

describe("paneShown", () => {
  it("is shown only with a width and a height: a pane behind another tab has neither", () => {
    expect(paneShown(320, 600)).toBe(true);
    expect(paneShown(0, 0)).toBe(false);
    expect(paneShown(320, 0)).toBe(false);
    expect(paneShown(0, 600)).toBe(false);
  });
});
