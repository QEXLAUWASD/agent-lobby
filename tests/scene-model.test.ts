import type { PaseoAgent } from "@getpaseo/client";
import { describe, expect, it } from "vitest";
import { buildForest, groupByWorkspace } from "../client/model";
import { layoutOffice } from "../client/office-model";
import {
  BUBBLE_HEIGHT,
  MARKER_TRAVEL_MS,
  MIN_TOUCH,
  bubbleBox,
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
  STROLL_MS_PER_TILE,
  WALK_MS_PER_TILE,
  moveKind,
  strollPath,
  strollPause,
  walkPath,
  wanderCircuit,
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

const officeOf = (agents: PaseoAgent[], width = 30, roomColumns = 1) =>
  layoutOffice(groupByWorkspace(buildForest(agents, null), new Map()), { width, roomColumns });

describe("sceneScale", () => {
  it("draws a phone and an Explorer pane at 2×, a wide surface at 3×, and never below 1×", () => {
    expect(sceneScale(390)).toEqual({ scale: 2, tile: 32, widthTiles: 12 });
    expect(sceneScale(352)).toEqual({ scale: 2, tile: 32, widthTiles: 11 });
    expect(sceneScale(1152)).toEqual({ scale: 3, tile: 48, widthTiles: 24 });
    expect(sceneScale(1151)).toEqual({ scale: 2, tile: 32, widthTiles: 35 });
    expect(sceneScale(290)).toEqual({ scale: 2, tile: 32, widthTiles: 9 });
    expect(sceneScale(255)).toEqual({ scale: 1, tile: 16, widthTiles: 15 });
    expect(sceneScale(0)).toEqual({ scale: 1, tile: 16, widthTiles: 0 });
    // A view of many rooms caps the scale.
    expect(sceneScale(1600, 2)).toEqual({ scale: 2, tile: 32, widthTiles: 50 });
  });

  it("keeps a desk cell at or above the touch minimum at every scale", () => {
    for (const width of [200, 390, 800, 1600]) expect(sceneScale(width).tile * 3).toBeGreaterThanOrEqual(MIN_TOUCH);
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

describe("strollPath", () => {
  it("crosses the lounge across then down, slower than a walk, and pauses between", () => {
    const legs = strollPath({ x: 3, y: 20 }, { x: 7, y: 21 });
    expect(legs.map((leg) => [leg.heading, leg.durationMs])).toEqual([
      ["right", 4 * STROLL_MS_PER_TILE],
      ["down", STROLL_MS_PER_TILE],
    ]);
    expect(STROLL_MS_PER_TILE).toBeGreaterThan(WALK_MS_PER_TILE);
    expect(strollPath({ x: 3, y: 20 }, { x: 3, y: 20 })).toEqual([]);
    expect(strollPause(0)).toBeGreaterThanOrEqual(2_000);
    expect(strollPause(5)).toBe(strollPause(1));
  });
});

describe("moveKind", () => {
  const seated = { spot: "seat" as const, at: { x: 5, y: 4 }, tile: 32 };

  it("walks when the agent changed spot, whatever else moved", () => {
    expect(moveKind(seated, { spot: "stand", at: { x: 6, y: 4 }, tile: 32 }, true)).toBe("walk");
    expect(moveKind(seated, { spot: "lounge", at: { x: 9, y: 17 }, tile: 32 }, true)).toBe("walk");
    expect(moveKind(seated, { spot: "out", at: { x: 1, y: 2 }, tile: 32 }, true)).toBe("walk");
  });

  it("places a character whose room moved under it: same spot, new tile, or a new scale", () => {
    expect(moveKind(seated, { spot: "seat", at: { x: 5, y: 7 }, tile: 32 }, true)).toBe("snap");
    expect(moveKind(seated, { spot: "seat", at: { x: 5, y: 4 }, tile: 48 }, true)).toBe("snap");
    expect(moveKind(seated, { spot: "stand", at: { x: 6, y: 4 }, tile: 16 }, true)).toBe("snap");
    expect(moveKind(seated, { ...seated, at: { x: 5, y: 4 } }, true)).toBe("stay");
  });

  it("walks a newcomer in from the door only when its room was already there", () => {
    expect(moveKind(null, seated, true)).toBe("enter");
    expect(moveKind(null, seated, false)).toBe("snap");
    // Somebody who is out has nowhere to walk in to.
    expect(moveKind(null, { spot: "out", at: { x: 1, y: 2 }, tile: 32 }, true)).toBe("snap");
  });
});

describe("wanderCircuit", () => {
  it("starts at home, stays in range, and is the same every time", () => {
    const range = { x: 3, y: 20, width: 14, height: 2 };
    const stops = wanderCircuit("agent-1", { x: 5, y: 20 }, range);
    expect(stops).toHaveLength(4);
    expect(stops[0]).toEqual({ x: 5, y: 20 });
    for (const stop of stops) {
      expect(stop.x).toBeGreaterThanOrEqual(3);
      expect(stop.x).toBeLessThan(17);
      expect(stop.y).toBeGreaterThanOrEqual(20);
      expect(stop.y).toBeLessThan(22);
    }
    expect(wanderCircuit("agent-1", { x: 5, y: 20 }, range)).toEqual(stops);
    expect(wanderCircuit("agent-2", { x: 5, y: 20 }, range)).not.toEqual(stops);
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
      roomColumns: 1,
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

describe("bubbleBox", () => {
  it("centres over the head and stays inside the office", () => {
    const middle = bubbleBox({ x: 10, y: 10 }, "hello", 32, 640);
    expect(middle.left + middle.width / 2).toBeCloseTo(10.5 * 32);
    expect(middle.top).toBe((10 + 1 - 1.5) * 32 - BUBBLE_HEIGHT - 4);
    const leftEdge = bubbleBox({ x: 0, y: 10 }, "a rather long line of speech here", 32, 640);
    expect(leftEdge.left).toBe(2);
    const rightEdge = bubbleBox({ x: 19, y: 10 }, "a rather long line of speech here", 32, 640);
    expect(rightEdge.left + rightEdge.width).toBeLessThanOrEqual(638);
    expect(bubbleBox({ x: 1, y: 0 }, "top row", 32, 640).top).toBe(0);
    // Narrower than a bubble's natural width: it shrinks to fit.
    const narrow = bubbleBox({ x: 2, y: 5 }, "x".repeat(48), 16, 144);
    expect(narrow.width).toBeLessThanOrEqual(140);
    expect(narrow.left).toBeGreaterThanOrEqual(2);
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
    expect((["wandering", "visiting"] as const).map(spotOf)).toEqual(["lounge", "lounge"]);
    expect(spotOf("away")).toBe("out");
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
    expect(roomsInView(office, 0, first.height)).toEqual(["ws-1"]);
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
