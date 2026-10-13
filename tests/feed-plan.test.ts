import { describe, expect, it } from "vitest";
import { FEED_CAP, FEED_HOLD_MS, FEED_RETRY_MS, planFeed, type FeedCandidate } from "../client/feed-plan";
import type { CrewState } from "../client/model";

const candidate = (id: string, state: CrewState, activityAt = 0): FeedCandidate => ({ id, state, activityAt });
const NONE = new Map<string, number>();

describe("planFeed", () => {
  it("subscribes working agents first, then those waiting on you, and nobody else", () => {
    const plan = planFeed({
      candidates: [
        candidate("idle", "idle"),
        candidate("ask", "needs-input"),
        candidate("failed", "failed"),
        candidate("work", "working"),
        candidate("ready", "ready"),
        candidate("closed", "closed"),
      ],
      current: NONE,
      lastWanted: NONE,
      now: 0,
    });
    expect(plan.selected).toEqual(["work", "ask"]);
    expect(plan.subscribe).toEqual(["work", "ask"]);
    expect(plan.unsubscribe).toEqual([]);
    expect(plan.recheckAt).toBeNull();
  });

  it("never exceeds the cap, preferring the most recently active", () => {
    const fleet = Array.from({ length: 120 }, (_, index) => candidate(`w${String(index).padStart(3, "0")}`, "working", index));
    const plan = planFeed({ candidates: fleet, current: NONE, lastWanted: NONE, now: 0 });
    expect(plan.selected).toHaveLength(FEED_CAP);
    expect(plan.selected[0]).toBe("w119");
    expect(planFeed({ candidates: fleet, current: NONE, lastWanted: NONE, now: 0, cap: 3 }).selected).toHaveLength(3);
    expect(planFeed({ candidates: fleet, current: NONE, lastWanted: NONE, now: 0, cap: 0 }).selected).toEqual([]);
  });

  it("does not evict a working incumbent for a newer working agent", () => {
    const current = new Map([
      ["a", 0],
      ["b", 0],
    ]);
    const plan = planFeed({
      candidates: [candidate("a", "working", 1), candidate("b", "working", 2), candidate("c", "working", 999)],
      current,
      lastWanted: current,
      now: FEED_HOLD_MS * 10,
      cap: 2,
    });
    expect(plan.selected).toEqual(["b", "a"]);
    expect(plan.subscribe).toEqual([]);
    expect(plan.unsubscribe).toEqual([]);
  });

  it("gives a waiting incumbent's slot to a working newcomer only after the hold", () => {
    const input = {
      candidates: [candidate("ask", "needs-input"), candidate("work", "working")],
      current: new Map([["ask", 1_000]]),
      lastWanted: new Map([["ask", 1_000]]),
      cap: 1,
    };
    const early = planFeed({ ...input, now: 1_000 + FEED_HOLD_MS - 1 });
    expect(early.selected).toEqual(["ask"]);
    expect(early.recheckAt).toBe(1_000 + FEED_HOLD_MS);
    const late = planFeed({ ...input, now: 1_000 + FEED_HOLD_MS });
    expect(late.subscribe).toEqual(["work"]);
    expect(late.unsubscribe).toEqual(["ask"]);
  });

  it("keeps a subscription through a flicker and releases it once the hold has passed", () => {
    const current = new Map([["a", 0]]);
    const lastWanted = new Map([["a", 50_000]]);
    const quiet = [candidate("a", "idle")];
    const during = planFeed({ candidates: quiet, current, lastWanted, now: 50_000 + FEED_HOLD_MS - 1 });
    expect(during.selected).toEqual(["a"]);
    expect(during.unsubscribe).toEqual([]);
    expect(during.recheckAt).toBe(50_000 + FEED_HOLD_MS);
    const after = planFeed({ candidates: quiet, current, lastWanted, now: 50_000 + FEED_HOLD_MS });
    expect(after.unsubscribe).toEqual(["a"]);
    expect(after.recheckAt).toBeNull();
    // Back to work inside the hold: nothing was torn down, nothing is re-made.
    const back = planFeed({ candidates: [candidate("a", "working")], current, lastWanted, now: 50_000 + 5 });
    expect(back.subscribe).toEqual([]);
    expect(back.unsubscribe).toEqual([]);
  });

  it("lets a lingering subscription go at once when a wanted agent needs the slot", () => {
    const plan = planFeed({
      candidates: [candidate("gone-quiet", "idle"), candidate("work", "working")],
      current: new Map([["gone-quiet", 0]]),
      lastWanted: new Map([["gone-quiet", 9_000]]),
      now: 10_000,
      cap: 1,
    });
    expect(plan.subscribe).toEqual(["work"]);
    expect(plan.unsubscribe).toEqual(["gone-quiet"]);
  });

  it("lingers on agents that left the view, then drops them", () => {
    const current = new Map([["other-room", 0]]);
    const lastWanted = new Map([["other-room", 30_000]]);
    expect(planFeed({ candidates: [], current, lastWanted, now: 30_001 }).unsubscribe).toEqual([]);
    expect(planFeed({ candidates: [], current, lastWanted, now: 30_000 + FEED_HOLD_MS }).unsubscribe).toEqual(["other-room"]);
  });

  it("leaves a failed subscription alone until the retry delay has passed", () => {
    const failed = new Map([["a", 1_000]]);
    const candidates = [candidate("a", "working")];
    const blocked = planFeed({ candidates, current: NONE, lastWanted: NONE, failed, now: 2_000 });
    expect(blocked.subscribe).toEqual([]);
    expect(blocked.recheckAt).toBe(1_000 + FEED_RETRY_MS);
    expect(planFeed({ candidates, current: NONE, lastWanted: NONE, failed, now: 1_000 + FEED_RETRY_MS }).subscribe).toEqual(["a"]);
  });

  it("counts a duplicated candidate once", () => {
    const plan = planFeed({
      candidates: [candidate("a", "working"), candidate("a", "working")],
      current: NONE,
      lastWanted: NONE,
      now: 0,
    });
    expect(plan.selected).toEqual(["a"]);
  });
});
