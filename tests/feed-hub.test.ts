import { describe, expect, it } from "vitest";
import { createFeedHub, hubFor, type TimelineSource } from "../client/feed-hub";
import { FEED_CAP } from "../client/feed-plan";

interface Update {
  agentId: string;
  event: { type: string };
}

function fakeDaemon(failFor: readonly string[] = []) {
  const live = new Map<string, (update: Update) => void>();
  const opened: string[] = [];
  const stopped: string[] = [];
  const source: TimelineSource<Update> = {
    subscribe(agentId, handler) {
      if (failFor.includes(agentId)) throw new Error("disposed");
      opened.push(agentId);
      live.set(agentId, handler);
      return {
        ready: Promise.resolve(),
        stop() {
          stopped.push(agentId);
          live.delete(agentId);
        },
      };
    },
  };
  const emit = (agentId: string, type = "timeline") => live.get(agentId)?.({ agentId, event: { type } });
  return { source, emit, opened, stopped, live };
}

describe("createFeedHub", () => {
  it("opens one subscription for two views watching the same agent, and closes it when both leave", () => {
    const daemon = fakeDaemon();
    const hub = createFeedHub(daemon.source);
    const seen: string[] = [];
    const panel = hub.acquire("a", () => seen.push("panel"));
    const surface = hub.acquire("a", () => seen.push("surface"));
    expect(daemon.opened).toEqual(["a"]);
    expect(hub.size()).toBe(1);
    daemon.emit("a");
    expect(seen).toEqual(["panel", "surface"]);
    panel?.release();
    panel?.release();
    expect(daemon.stopped).toEqual([]);
    daemon.emit("a");
    expect(seen).toEqual(["panel", "surface", "surface"]);
    surface?.release();
    expect(daemon.stopped).toEqual(["a"]);
    expect(hub.size()).toBe(0);
  });

  it("holds every view together to the cap", () => {
    const daemon = fakeDaemon();
    const hub = createFeedHub(daemon.source);
    const leases = Array.from({ length: 30 }, (_, index) => hub.acquire(`agent-${index}`, () => {}));
    expect(leases.filter(Boolean)).toHaveLength(FEED_CAP);
    expect(daemon.opened).toHaveLength(FEED_CAP);
    // A share of something already open is free; a new agent has to wait for a slot.
    expect(hub.acquire("agent-0", () => {})).not.toBeNull();
    expect(hub.acquire("late", () => {})).toBeNull();
    leases[0]?.release();
    expect(hub.acquire("late", () => {})).toBeNull();
    expect(createFeedHub(daemon.source, 2).acquire("x", () => {})).not.toBeNull();
  });

  it("frees the slot when the last holder leaves", () => {
    const daemon = fakeDaemon();
    const hub = createFeedHub(daemon.source, 1);
    const first = hub.acquire("a", () => {});
    expect(hub.acquire("b", () => {})).toBeNull();
    first?.release();
    expect(hub.acquire("b", () => {})).not.toBeNull();
    expect(daemon.stopped).toEqual(["a"]);
  });

  it("tells every holder about an error, forgets the subscription, and does not stop it twice", () => {
    const daemon = fakeDaemon();
    const hub = createFeedHub(daemon.source);
    const seen: string[] = [];
    const one = hub.acquire("a", (update) => seen.push(`one:${update.event.type}`));
    const two = hub.acquire("a", (update) => seen.push(`two:${update.event.type}`));
    daemon.emit("a", "error");
    expect(seen).toEqual(["one:error", "two:error"]);
    expect(hub.size()).toBe(0);
    one?.release();
    two?.release();
    expect(daemon.stopped).toEqual([]);
    // It can be opened afresh afterwards.
    expect(hub.acquire("a", () => {})).not.toBeNull();
    expect(daemon.opened).toEqual(["a", "a"]);
  });

  it("gives nothing when the subscription cannot be opened, and spends no slot on it", () => {
    const daemon = fakeDaemon(["broken"]);
    const hub = createFeedHub(daemon.source, 1);
    expect(hub.acquire("broken", () => {})).toBeNull();
    expect(hub.size()).toBe(0);
    expect(hub.acquire("fine", () => {})).not.toBeNull();
  });

  it("lets a holder release from inside its own handler", () => {
    const daemon = fakeDaemon();
    const hub = createFeedHub(daemon.source);
    const seen: string[] = [];
    const first = hub.acquire("a", () => {
      seen.push("first");
      first?.release();
    });
    hub.acquire("a", () => seen.push("second"));
    daemon.emit("a");
    daemon.emit("a");
    expect(seen).toEqual(["first", "second", "second"]);
  });
});

describe("hubFor", () => {
  it("gives one hub per connection", () => {
    const daemon = fakeDaemon();
    const connection = {};
    const hub = hubFor(connection, () => daemon.source);
    expect(hubFor(connection, () => fakeDaemon().source)).toBe(hub);
    expect(hubFor({}, () => daemon.source)).not.toBe(hub);
  });
});
