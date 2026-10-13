import type { PaseoAgent } from "@getpaseo/client";
import { describe, expect, it } from "vitest";
import { buildForest, groupByWorkspace } from "../client/model";
import { layoutOffice } from "../client/office-model";
import {
  MARKER_TRAVEL_MS,
  MIN_TOUCH,
  actFrame,
  bubbleTrack,
  characterLabel,
  highlighted,
  indexNodes,
  linkBetween,
  markerPath,
  markerProgress,
  roomsInView,
  sceneScale,
  spotOf,
  spriteRole,
  touchSlop,
  MAX_WALK_MS,
  WALK_MS_PER_TILE,
  moveKind,
  walkPath,
} from "../client/scene-model";

let clock = 0;
function agent(overrides: Partial<PaseoAgent> & { id: string }, parent?: string): PaseoAgent {
  clock += 1;
  const createdAt = new Date(Date.parse("2026-10-13T00:00:00.000Z") + clock * 1_000).toISOString();
  return {
    provider: "claude",
    cwd: "/repo",
    workspaceId: "ws-a",
    model: "claude-opus-5",
    thinkingOptionId: null,
    createdAt,
    updatedAt: createdAt,
    lastUserMessageAt: null,
    status: "idle",
    activeTurn: null,
    capabilities: {} as PaseoAgent["capabilities"],
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    title: null,
    labels: parent ? { "paseo.parent-agent-id": parent } : {},
    ...overrides,
  } as PaseoAgent;
}

const officeOf = (agents: PaseoAgent[], width = 12) =>
  layoutOffice(groupByWorkspace(buildForest(agents, null), new Map()), { width });

describe("sceneScale", () => {
  it("draws small: one and a half to one in a side pane, one to one in a pane too narrow for a room", () => {
    expect(sceneScale(320)).toEqual({ scale: 1.5, tile: 24, widthTiles: 13 });
    expect(sceneScale(390)).toEqual({ scale: 1.5, tile: 24, widthTiles: 16 });
    expect(sceneScale(1400)).toEqual({ scale: 1.5, tile: 24, widthTiles: 58 });
    expect(sceneScale(216)).toEqual({ scale: 1.5, tile: 24, widthTiles: 9 });
    expect(sceneScale(215)).toEqual({ scale: 1, tile: 16, widthTiles: 13 });
    expect(sceneScale(0)).toEqual({ scale: 1, tile: 16, widthTiles: 0 });
  });

  it("keeps one art pixel a whole number of device pixels", () => {
    for (const ratio of [1, 1.25, 1.5, 1.67, 2, 2.625, 3]) {
      for (const width of [200, 320, 900]) {
        const { scale } = sceneScale(width, ratio);
        expect(Math.abs(scale * ratio - Math.round(scale * ratio))).toBeLessThan(1e-9);
        expect(scale).toBeGreaterThanOrEqual(1);
        expect(scale).toBeLessThanOrEqual(1.6 + 1e-9);
      }
    }
    expect(sceneScale(320, 1).scale).toBe(1);
    expect(sceneScale(320, 1.67).scale).toBeCloseTo(2 / 1.67);
    expect(sceneScale(320, 3).scale).toBeCloseTo(4 / 3);
  });
});

describe("touchSlop", () => {
  it("pads a small target up to 44 px and leaves a large one alone", () => {
    expect(16 + 2 * touchSlop(16)).toBeGreaterThanOrEqual(MIN_TOUCH);
    expect(32 + 2 * touchSlop(32)).toBeGreaterThanOrEqual(MIN_TOUCH);
    expect(touchSlop(48)).toBe(0);
  });
});

describe("spriteRole and characterLabel", () => {
  it("reads the ghostline role and falls back to a plain agent", () => {
    expect(spriteRole(agent({ id: "a", labels: { "ghostline/role": "nexus" } }))).toBe("nexus");
    expect(spriteRole(agent({ id: "b", labels: { "ghostline/role": "Overseer" } }))).toBe("overseer");
    expect(spriteRole(agent({ id: "c", labels: { "ghostline/role": "janitor" } }))).toBe("agent");
    expect(spriteRole(agent({ id: "d" }))).toBe("agent");
  });

  it("says title, role and state, and what is being said", () => {
    const meow = agent({ id: "m", title: "Fix login form", labels: { "ghostline/role": "meow" } });
    expect(characterLabel(meow, "working")).toBe("Fix login form, Meow, Working");
    expect(characterLabel(meow, "needs-input", "Run npm test")).toBe("Fix login form, Meow, Needs you, Run npm test");
    expect(characterLabel(agent({ id: "abcdefghij" }), "closed")).toBe("claude · abcdefg, Closed");
    expect(characterLabel(meow, "idle", null, true)).toBe("Visitor, Fix login form, Meow, Idle");
  });
});

describe("walkPath", () => {
  const seat = { at: { x: 5, y: 4 }, aisleY: 5 };
  const stand = { at: { x: 6, y: 4 }, aisleY: 5 };
  const lounge = { at: { x: 9, y: 14 }, aisleY: 14 };
  const corners = (legs: ReturnType<typeof walkPath>) => [legs[0]?.from, ...legs.map((leg) => leg.to)];

  it("steps out of the chair to stand beside it in one leg, and back", () => {
    expect(walkPath(seat, stand, 1)).toEqual([
      { from: { x: 5, y: 4 }, to: { x: 6, y: 4 }, heading: "right", durationMs: WALK_MS_PER_TILE, row: 4 },
    ]);
    expect(walkPath(stand, seat, 1).map((leg) => leg.heading)).toEqual(["left"]);
  });

  it("goes by the aisle and the corridor to the lounge, never across a desk row", () => {
    const out = walkPath(seat, lounge, 1);
    expect(corners(out)).toEqual([
      { x: 5, y: 4 },
      { x: 5, y: 5 },
      { x: 1, y: 5 },
      { x: 1, y: 14 },
      { x: 9, y: 14 },
    ]);
    expect(out.map((leg) => leg.heading)).toEqual(["down", "left", "down", "right"]);
    // Every vertical stretch between rows is in the corridor column.
    for (const leg of out) if (leg.from.x === leg.to.x && Math.abs(leg.to.y - leg.from.y) > 1) expect(leg.from.x).toBe(1);
    const back = walkPath(lounge, seat, 1);
    expect(back.map((leg) => leg.heading)).toEqual(["left", "up", "right", "up"]);
    expect(back.at(-1)?.to).toEqual(seat.at);
  });

  it("skips the corridor between two desks on the same aisle", () => {
    const neighbour = { at: { x: 11, y: 4 }, aisleY: 5 };
    expect(corners(walkPath(seat, neighbour, 1))).toEqual([
      { x: 5, y: 4 },
      { x: 5, y: 5 },
      { x: 11, y: 5 },
      { x: 11, y: 4 },
    ]);
  });

  it("walks at one pace: time is distance, and a leg is stacked on its lower row", () => {
    const legs = walkPath(seat, lounge, 1);
    for (const leg of legs) {
      const distance = Math.abs(leg.to.x - leg.from.x) + Math.abs(leg.to.y - leg.from.y);
      expect(leg.durationMs).toBe(distance * WALK_MS_PER_TILE);
      expect(leg.row).toBe(Math.max(leg.from.y, leg.to.y));
    }
    expect(legs.reduce((sum, leg) => sum + leg.durationMs, 0)).toBe(22 * WALK_MS_PER_TILE);
  });

  it("is empty when nothing moves, and hurries a walk that would take too long", () => {
    expect(walkPath(seat, seat, 1)).toEqual([]);
    const far = walkPath({ at: { x: 40, y: 2 }, aisleY: 3 }, { at: { x: 40, y: 200 }, aisleY: 200 }, 1);
    const total = far.reduce((sum, leg) => sum + leg.durationMs, 0);
    expect(total).toBeLessThanOrEqual(MAX_WALK_MS + far.length);
    expect(total).toBeGreaterThan(MAX_WALK_MS - far.length);
  });
});

describe("moveKind", () => {
  const seated = { spot: "seat" as const, key: "seat", at: { x: 5, y: 4 }, tile: 32 };
  const atCoffee = { spot: "lounge" as const, key: "2,0", at: { x: 4, y: 17 }, tile: 32 };

  it("walks when the agent changed spot, whatever else moved", () => {
    expect(moveKind(seated, { spot: "stand", key: "stand", at: { x: 6, y: 4 }, tile: 32 }, true)).toBe("walk");
    expect(moveKind(seated, atCoffee, true)).toBe("walk");
    expect(moveKind(seated, { spot: "out", key: "out", at: { x: 1, y: 2 }, tile: 32 }, true)).toBe("walk");
  });

  it("walks from one place of a break to the next", () => {
    expect(moveKind(atCoffee, { ...atCoffee, key: "7,2", at: { x: 9, y: 19 } }, true)).toBe("walk");
  });

  it("places a character whose room moved under it: same place, new tile, or a new scale", () => {
    expect(moveKind(seated, { ...seated, at: { x: 5, y: 7 } }, true)).toBe("snap");
    expect(moveKind(atCoffee, { ...atCoffee, at: { x: 4, y: 20 } }, true)).toBe("snap");
    expect(moveKind(seated, { ...seated, tile: 48 }, true)).toBe("snap");
    expect(moveKind(seated, { spot: "stand", key: "stand", at: { x: 6, y: 4 }, tile: 16 }, true)).toBe("snap");
    expect(moveKind(seated, { ...seated, at: { x: 5, y: 4 } }, true)).toBe("stay");
  });

  it("walks a newcomer in from the door only when its room was already there", () => {
    expect(moveKind(null, seated, true)).toBe("enter");
    expect(moveKind(null, seated, false)).toBe("snap");
    // Somebody who is out has nowhere to walk in to.
    expect(moveKind(null, { spot: "out", key: "out", at: { x: 1, y: 2 }, tile: 32 }, true)).toBe("snap");
  });
});

describe("markerPath", () => {
  const agents = [
    agent({ id: "nexus" }),
    agent({ id: "meow" }, "nexus"),
    agent({ id: "other", workspaceId: "ws-b" }),
  ];
  const office = officeOf(agents);
  const seat = (id: string) => office.desks.get(id)?.seat;
  const door = (workspaceId: string) => {
    const room = office.rooms.find((entry) => entry.workspaceId === workspaceId);
    return room ? room.door : null;
  };

  it("goes desk to desk, also across rooms", () => {
    expect(markerPath({ from: "nexus", to: "meow" }, office)).toEqual({
      from: seat("nexus"),
      to: seat("meow"),
      fromSeated: true,
      toSeated: true,
    });
    expect(markerPath({ from: "other", to: "meow" }, office)).toMatchObject({ from: seat("other"), to: seat("meow") });
  });

  it("comes in through the recipient's door when the sender is unknown or not in this office", () => {
    for (const from of [null, "somebody-archived"]) {
      expect(markerPath({ from, to: "other" }, office)).toEqual({
        from: door("ws-b"),
        to: seat("other"),
        fromSeated: false,
        toSeated: true,
      });
    }
  });

  it("leaves through the sender's door when the recipient is not in this office", () => {
    expect(markerPath({ from: "meow", to: "gone" }, office)).toEqual({
      from: seat("meow"),
      to: door("ws-a"),
      fromSeated: true,
      toSeated: false,
    });
  });

  it("uses a visitor's spot as an end", () => {
    const boss = agent({ id: "boss", workspaceId: "ws-home" });
    const lead = agent({ id: "lead", workspaceId: "ws-a", labels: { "paseo.parent-agent-id": "boss" } });
    const visited = layoutOffice(groupByWorkspace(buildForest([boss, lead], "ws-a"), new Map()), {
      width: 30,
      agents: new Map([boss, lead].map((entry) => [entry.id, entry])),
    });
    const spot = visited.visitors.get("boss")?.at;
    expect(markerPath({ from: "boss", to: "lead" }, visited)).toMatchObject({ from: spot, fromSeated: true });
    expect(markerPath({ from: "lead", to: "boss" }, visited)).toMatchObject({ to: spot, toSeated: true });
  });

  it("draws nothing when neither end is here", () => {
    expect(markerPath({ from: "x", to: "y" }, office)).toBeNull();
    expect(markerPath({ from: null, to: "y" }, office)).toBeNull();
  });
});

describe("markerProgress and linkBetween", () => {
  it("runs from 0 to 1 over the travel time and rests there", () => {
    expect(markerProgress(1_000, 900)).toBe(0);
    expect(markerProgress(1_000, 1_000 + MARKER_TRAVEL_MS / 2)).toBe(0.5);
    expect(markerProgress(1_000, 99_000)).toBe(1);
  });

  it("gives the bar that joins two tile centres", () => {
    expect(linkBetween({ x: 0, y: 0 }, { x: 4, y: 0 }, 16)).toEqual({ cx: 40, cy: 8, length: 64, angle: 0 });
    const down = linkBetween({ x: 2, y: 1 }, { x: 2, y: 4 }, 32);
    expect(down).toMatchObject({ cx: 80, cy: 96, length: 96 });
    expect(down.angle).toBeCloseTo(90);
    expect(linkBetween({ x: 3, y: 3 }, { x: 0, y: 0 }, 16).angle).toBeCloseTo(-135);
  });
});

describe("bubbleTrack and spotOf", () => {
  const follow = (track: { inputRange: [number, number]; outputRange: [number, number] }, value: number, clampRight = true) => {
    const [a, b] = track.inputRange;
    const [c, d] = track.outputRange;
    const t = (value - a) / (b - a);
    return c + Math.min(clampRight ? 1 : Infinity, Math.max(0, t)) * (d - c);
  };

  it("keeps a bubble centred over a walking character and inside the office", () => {
    const track = bubbleTrack(100, 20, 32, 640);
    // Mid-room: left edge = x + half a tile - half the bubble.
    expect(follow(track.x, 300)).toBeCloseTo(300 + 16 - 50);
    expect(follow(track.x, 0)).toBe(2);
    expect(follow(track.x, 630)).toBe(640 - 100 - 2);
    expect(track.x.fixed).toBeNull();
    // Above the head: top = y - (half a tile of head + bubble + gap), never negative.
    expect(follow(track.y, 320, false)).toBeCloseTo(320 - (16 + 20 + 4));
    expect(follow(track.y, 10, false)).toBe(0);
  });

  it("pins a bubble wider than the office to its left edge", () => {
    expect(bubbleTrack(300, 20, 16, 144).x.fixed).toBe(2);
  });

  it("puts each activity at its spot", () => {
    expect((["typing", "stuck", "asleep"] as const).map(spotOf)).toEqual(["seat", "seat", "seat"]);
    expect((["asking", "done"] as const).map(spotOf)).toEqual(["stand", "stand"]);
    expect((["wandering", "gathering", "visiting"] as const).map(spotOf)).toEqual(["lounge", "lounge", "lounge"]);
    expect(spotOf("away")).toBe("out");
  });
});

describe("actFrame", () => {
  const beats = (act: Parameters<typeof actFrame>[0], seed: number) => Array.from({ length: 40 }, (_, beat) => actFrame(act, beat, seed));

  it("holds the rest pose most of the time and moves now and then", () => {
    for (const act of ["drink", "stretch"] as const) {
      const frames = beats(act, 3);
      const moving = frames.filter((frame) => frame === 1).length;
      expect(moving).toBeGreaterThan(0);
      expect(moving).toBeLessThan(frames.length / 2);
    }
    expect(new Set(beats("read", 1))).toEqual(new Set([0]));
    // People do not all sip on the same beat.
    expect(beats("drink", 1)).not.toEqual(beats("drink", 2));
  });

  it("gives two people at a table their turns", () => {
    const one = beats("talk", 10);
    const other = beats("talk", 11);
    for (let beat = 0; beat < one.length; beat += 1) expect(one[beat]).not.toBe(other[beat]);
  });
});

describe("highlighted", () => {
  const roots = buildForest(
    [
      agent({ id: "root", title: "Nexus room", status: "running" }),
      agent({ id: "kid", title: "Meow painter" }, "root"),
      agent({ id: "solo", title: "Painter two", status: "error" }),
    ],
    null,
  );
  const none = () => null;

  it("is null when nothing is asked for, so nobody is dimmed", () => {
    expect(highlighted(roots, "all", "  ", none)).toBeNull();
  });

  it("picks by state, by text, and by both, without pulling in ancestors", () => {
    expect([...(highlighted(roots, "working", "", none) ?? [])]).toEqual(["root"]);
    expect([...(highlighted(roots, "all", "painter", none) ?? [])].sort()).toEqual(["kid", "solo"]);
    expect([...(highlighted(roots, "failed", "painter", none) ?? [])]).toEqual(["solo"]);
    expect(highlighted(roots, "ready", "", none)?.size).toBe(0);
    expect([...(highlighted(roots, "all", "docs", () => "docs site") ?? [])]).toHaveLength(3);
  });
});

describe("roomsInView and indexNodes", () => {
  it("lists the rooms a vertical window touches", () => {
    const office = officeOf([agent({ id: "a", workspaceId: "ws-1" }), agent({ id: "b", workspaceId: "ws-2" })]);
    const [first, second] = office.rooms;
    if (!first || !second) throw new Error("fixture");
    // The second room begins on the first one's bottom wall, which they share.
    expect(roomsInView(office, 0, first.height - 1)).toEqual(["ws-1"]);
    expect(roomsInView(office, first.height - 1, second.y + 1)).toEqual(["ws-1", "ws-2"]);
    expect(roomsInView(office, second.y + 1, second.y + 2)).toEqual(["ws-2"]);
    expect(roomsInView(office, office.height + 5, office.height + 9)).toEqual([]);
  });

  it("indexes every node of a forest", () => {
    const roots = buildForest([agent({ id: "r" }), agent({ id: "c" }, "r"), agent({ id: "g" }, "c")], null);
    expect([...indexNodes(roots).keys()].sort()).toEqual(["c", "g", "r"]);
    expect(indexNodes(roots).get("g")?.depth).toBe(2);
  });
});
