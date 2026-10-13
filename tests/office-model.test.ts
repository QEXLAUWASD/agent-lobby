import type { PaseoAgent } from "@getpaseo/client";
import { describe, expect, it } from "vitest";
import { candidatesOf } from "../client/feed-plan";
import { buildForest, crewState, groupByWorkspace, type CrewState } from "../client/model";
import {
  DESK_HEIGHT,
  DESK_WIDTH,
  MAX_POD_COLUMNS,
  MIN_ROOM_WIDTH,
  BREAK_DWELL_MIN_MS,
  LOUNGE_MAX_WIDTH,
  PANTRY_MAX_WIDTH,
  WANDER_MS,
  assignBreaks,
  breakStretch,
  fitZones,
  layoutOffice,
  nextPresenceChange,
  presenceOf,
  presences,
  shareOffice,
  sharePresences,
  type Office,
  type Rect,
  type Room,
} from "../client/office-model";

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

function office(agents: PaseoAgent[], width: number): Office {
  return layoutOffice(groupByWorkspace(buildForest(agents, null), new Map()), { width });
}

const cells = (layout: Office) => new Map([...layout.desks].map(([id, desk]) => [id, `${desk.cell.x},${desk.cell.y}`]));
const inside = (inner: Rect, outer: Rect) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;

/** Overseer → Nexus → three Meows, plus two agents on their own. */
function crew(): PaseoAgent[] {
  return [
    agent({ id: "overseer", labels: { "ghostline/role": "overseer" } }),
    agent({ id: "nexus", labels: { "ghostline/role": "nexus", "paseo.parent-agent-id": "overseer" } }),
    agent({ id: "solo-1" }),
    agent({ id: "meow-a" }, "nexus"),
    agent({ id: "meow-b" }, "nexus"),
    agent({ id: "solo-2" }),
    agent({ id: "meow-c" }, "nexus"),
  ];
}

describe("layoutOffice", () => {
  it("gives every agent who is in one desk, inside its pod, inside its room, overlapping nobody", () => {
    for (const width of [9, 13, 20, 31, 48, 120]) {
      const agents = [...crew(), agent({ id: "elsewhere", workspaceId: "ws-b" }), agent({ id: "third", workspaceId: "ws-c" })];
      const layout = office(agents, width);
      expect(layout.desks.size).toBe(agents.length);
      expect(new Set(cells(layout).values()).size).toBe(agents.length);
      for (const room of layout.rooms) {
        expect(room.x).toBeGreaterThanOrEqual(0);
        expect(room.x + room.width).toBeLessThanOrEqual(layout.width);
        expect(room.y + room.height).toBeLessThanOrEqual(layout.height);
        expect(inside(room.lounge, room)).toBe(true);
        expect(inside(room.header, room)).toBe(true);
        expect(inside(room.lounge.walkway, room)).toBe(true);
        for (const pod of room.pods) {
          expect(inside(pod, room)).toBe(true);
          expect(pod.x).toBeGreaterThan(room.corridorX);
          for (const team of pod.teams) {
            expect(inside(team.area, pod)).toBe(true);
            for (const desk of team.desks) {
              expect(inside({ ...desk.cell, width: DESK_WIDTH, height: DESK_HEIGHT }, team.area)).toBe(true);
            }
          }
          // Desks and zones never share a tile.
          for (const zone of room.zones) {
            const apart = pod.x + pod.width <= zone.x || zone.x + zone.width <= pod.x || pod.y + pod.height <= zone.y || zone.y + zone.height <= pod.y;
            expect(apart).toBe(true);
          }
        }
        for (const zone of room.zones) {
          expect(inside(zone, room)).toBe(true);
          expect(zone.x).toBeGreaterThan(room.corridorX);
          for (const spot of zone.spots) expect(inside({ ...spot, width: 1, height: 1 }, room)).toBe(true);
        }
      }
      for (const a of layout.rooms) {
        for (const b of layout.rooms) {
          if (a === b) continue;
          // Neighbours share a wall, one tile thick, and nothing more.
          const apart =
            a.x + a.width - 1 <= b.x || b.x + b.width - 1 <= a.x || a.y + a.height - 1 <= b.y || b.y + b.height - 1 <= a.y;
          expect(apart).toBe(true);
        }
      }
    }
  });

  it("seats a crew as teams: the root with its children, then each lead's children", () => {
    const layout = office(crew(), 48);
    const room = layout.rooms[0];
    const pod = room?.pods.find((entry) => entry.rootId === "overseer");
    expect(pod?.teams.map((team) => [team.leadId, team.desks.map((desk) => desk.agentId)])).toEqual([
      ["overseer", ["overseer", "nexus"]],
      ["nexus", ["meow-a", "meow-b", "meow-c"]],
    ]);
    expect(layout.desks.get("meow-b")).toMatchObject({
      seatKey: "overseer/nexus/1",
      rootId: "overseer",
      parentId: "nexus",
      leadId: "nexus",
      depth: 2,
      role: null,
      remote: false,
    });
    expect(layout.desks.get("nexus")).toMatchObject({ leadId: "overseer", role: "Nexus", depth: 1 });
    expect(layout.desks.get("overseer")).toMatchObject({ seatKey: "overseer/overseer/0", parentId: null });
    expect(room?.pods.filter((entry) => entry.width === DESK_WIDTH).map((entry) => entry.rootId)).toEqual(["solo-1", "solo-2"]);
    const desk = layout.desks.get("meow-a");
    expect(desk?.seat).toEqual({ x: (desk?.cell.x ?? 0) + 0.5, y: (desk?.cell.y ?? 0) + 1 });
    // It stands where it sat: in front of its own chair, in nobody's way.
    expect(desk?.stand).toEqual(desk?.seat);
    expect(desk?.aisleY).toBe((desk?.cell.y ?? 0) + 2);
  });

  it("does not move anyone when states change short of closing", () => {
    const agents = crew();
    const before = cells(office(agents, 48));
    const shaken = agents.map((entry, index) => ({
      ...entry,
      status: (["running", "error", "idle", "idle"] as const)[index % 4],
      requiresAttention: index % 2 === 0,
      attentionReason: index % 2 === 0 ? ("finished" as const) : null,
      updatedAt: new Date(Date.parse(entry.updatedAt) + index * 77_000).toISOString(),
    })) as PaseoAgent[];
    expect(cells(office(shaken, 48))).toEqual(before);
    // The forest hands its nodes over in state order; the office must not care.
    expect(cells(office([...shaken].reverse(), 48))).toEqual(before);
  });

  it("keeps everybody's seat key when agents arrive: a new teammate, a new team, a new solo, a new room", () => {
    const agents = crew();
    const keys = (layout: Office) => new Map([...layout.desks].map(([id, desk]) => [id, desk.seatKey]));
    const before = keys(office(agents, 48));
    const grown = office(
      [
        ...agents,
        agent({ id: "meow-d" }, "nexus"),
        agent({ id: "helper" }, "meow-a"),
        agent({ id: "solo-3" }),
        agent({ id: "other-room", workspaceId: "ws-b" }),
      ],
      48,
    );
    const after = keys(grown);
    for (const [id, key] of before) expect(after.get(id)).toBe(key);
    expect(grown.desks.get("helper")).toMatchObject({ leadId: "meow-a", seatKey: "overseer/meow-a/0" });
    // meow-a now leads a team and still has the seat it had.
    expect(grown.desks.get("meow-a")?.seatKey).toBe("overseer/nexus/0");
    expect(grown.desks.get("meow-d")?.seatKey).toBe("overseer/nexus/3");
  });

  it("orders rooms by their oldest crew, not by urgency", () => {
    const calm = agent({ id: "calm", workspaceId: "ws-old" });
    const urgent = agent({ id: "urgent", workspaceId: "ws-new", status: "error" });
    const groups = groupByWorkspace(buildForest([calm, urgent], null), new Map());
    expect(groups[0]?.workspaceId).toBe("ws-new");
    const layout = layoutOffice(groups, { width: 30 });
    expect(layout.rooms.map((room) => [room.workspaceId, room.urgency])).toEqual([
      ["ws-old", 2],
      ["ws-new", 1],
    ]);
    expect(layout.roomOf.get("urgent")).toBe("ws-new");
  });

  it("keeps a child that runs in another workspace in its crew's room and marks it remote", () => {
    const layout = office([agent({ id: "root" }), agent({ id: "away", workspaceId: "ws-b" }, "root")], 30);
    expect(layout.rooms).toHaveLength(1);
    expect(layout.desks.get("away")).toMatchObject({ remote: true, rootId: "root" });
    expect(layout.desks.get("root")?.remote).toBe(false);
  });

  it("never lets two rooms share more than a wall, whatever their sizes and the width", () => {
    const sizes = [1, 9, 3, 14, 2, 6, 1, 11, 4, 1, 7];
    const agents = sizes.flatMap((count, room) =>
      Array.from({ length: count }, (_, seat) => agent({ id: `r${room}-${seat}`, workspaceId: `ws-${String(room).padStart(2, "0")}` })),
    );
    for (let width = 10; width <= 90; width += 7) {
      const layout = office(agents, width);
      expect(layout.rooms).toHaveLength(sizes.length);
      for (const a of layout.rooms) {
        expect(a.x + a.width).toBeLessThanOrEqual(layout.width);
        for (const b of layout.rooms) {
          if (a === b) continue;
          const across = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
          const down = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
          // They overlap, if at all, by one tile in one direction: the wall between them.
          expect(across <= 1 || down <= 1).toBe(true);
        }
      }
      // The building follows the rooms: each column goes down as far as its lowest room and no further.
      const depth = layout.building?.depth ?? [];
      expect(depth).toHaveLength(Math.max(...layout.rooms.map((room) => room.x + room.width)));
      depth.forEach((bottom, column) => {
        const over = layout.rooms.filter((room) => room.x <= column && column < room.x + room.width);
        expect(bottom).toBe(Math.max(...over.map((room) => room.y + room.height)));
      });
      expect(Math.max(...depth)).toBe(layout.height);
    }
    expect(layoutOffice([], { width: 40 }).building).toBeNull();
  });

  it("makes a room as large as what it holds, never wider than it is offered", () => {
    const solo = office([agent({ id: "one" })], 40).rooms[0];
    const five = office(crew().slice(0, 5), 40).rooms[0];
    const many = office(Array.from({ length: 18 }, (_, index) => agent({ id: `s${index}` })), 40).rooms[0];
    if (!solo || !five || !many) throw new Error("fixture");
    const area = (room: Rect) => room.width * room.height;
    expect(area(solo)).toBeLessThan(area(five));
    expect(area(five)).toBeLessThan(area(many));
    expect(solo.width).toBeLessThan(40);
    // A small crew in a wide pane: pantry and lounge beside the desks, against the top wall.
    expect(solo.zonesBeside).toBe(true);
    expect(solo.zones.every((zone) => zone.y === solo.floorTop)).toBe(true);
    // The same crew in a narrow pane: under the desks.
    const narrow = office([agent({ id: "one" })], 9).rooms[0];
    expect(narrow?.zonesBeside).toBe(false);
    expect(narrow?.width).toBeLessThanOrEqual(9);
    expect(narrow?.zones.every((zone) => zone.y > (narrow?.floorTop ?? 0))).toBe(true);
    for (const width of [9, 12, 20, 40]) {
      for (const room of office(Array.from({ length: 18 }, (_, index) => agent({ id: `w${width}-${index}` })), width).rooms) {
        expect(room.width).toBeLessThanOrEqual(width);
      }
    }
  });

  it("builds one floor plan: rooms against the top, beside a neighbour, or under one, sharing its wall", () => {
    const agents = ["ws-a", "ws-b", "ws-c", "ws-d", "ws-e"].flatMap((workspaceId, index) =>
      Array.from({ length: 1 + index * 2 }, (_, seat) => agent({ id: `${workspaceId}-${seat}`, workspaceId })),
    );
    const layout = office(agents, 40);
    expect(layout.rooms).toHaveLength(5);
    for (const room of layout.rooms) {
      // Its top wall is the top of the plan or somebody's bottom wall.
      const resting = room.y === 0 || layout.rooms.some((other) => other !== room && other.y + other.height - 1 === room.y && other.x < room.x + room.width && room.x < other.x + other.width);
      expect(resting).toBe(true);
    }
    // More than one room to a row where they fit.
    expect(new Set(layout.rooms.map((room) => room.y)).size).toBeLessThan(5);
    // Stacked when the plan is only one room wide.
    const stacked = office(agents, 12);
    expect(new Set(stacked.rooms.map((room) => room.y)).size).toBe(5);
    for (let index = 1; index < stacked.rooms.length; index += 1) {
      const above = stacked.rooms[index - 1] as Room;
      expect(stacked.rooms[index]?.y).toBe(above.y + above.height - 1);
    }
  });

  it("fits a narrow pane and reports a width too narrow to hold a desk", () => {
    const phone = office(crew(), 13);
    expect(phone.width).toBe(13);
    expect(phone.cramped).toBe(false);
    expect(phone.rooms).toHaveLength(1);
    expect(phone.rooms[0]?.width).toBeLessThanOrEqual(13);
    const tiny = office(crew(), 3);
    expect(tiny.cramped).toBe(true);
    expect(tiny.width).toBe(MIN_ROOM_WIDTH);
    expect(tiny.desks.size).toBe(7);
    expect(new Set([...tiny.desks.values()].map((desk) => desk.cell.x)).size).toBe(1);
  });

  it("holds one workspace of seventy agents in a deep tree without losing or overlapping any", () => {
    const agents = [agent({ id: "root" })];
    for (let lead = 0; lead < 6; lead += 1) {
      agents.push(agent({ id: `lead-${lead}` }, lead === 0 ? "root" : `lead-${lead - 1}`));
      for (let member = 0; member < 9; member += 1) agents.push(agent({ id: `m-${lead}-${member}` }, `lead-${lead}`));
    }
    for (let solo = 0; solo < 9; solo += 1) agents.push(agent({ id: `solo-${solo}` }));
    expect(agents).toHaveLength(70);
    for (const width of [13, 200]) {
      const layout = office(agents, width);
      expect(layout.desks.size).toBe(70);
      expect(new Set(cells(layout).values()).size).toBe(70);
      expect(layout.rooms[0]?.agentCount).toBe(70);
      expect(layout.desks.get("m-5-8")?.depth).toBe(7);
      const pod = layout.rooms[0]?.pods.find((entry) => entry.rootId === "root");
      expect(pod?.width).toBeLessThanOrEqual(MAX_POD_COLUMNS * DESK_WIDTH);
      expect(pod?.teams).toHaveLength(7);
    }
  });

  it("keeps a free corridor inside the left wall, from the door down to the walkway", () => {
    for (const width of [13, 40]) {
      const layout = office(crew(), width);
      const room = layout.rooms[0];
      if (!room) throw new Error("fixture");
      expect(room.corridorX).toBe(room.x + 1);
      expect(room.door).toEqual({ x: room.corridorX, y: room.floorTop - 1 });
      for (const desk of layout.desks.values()) expect(desk.cell.x).toBeGreaterThan(room.corridorX);
      expect(room.lounge.walkway.x).toBe(room.corridorX);
      expect(room.lounge.walkway.x + room.lounge.walkway.width).toBe(room.x + room.width - 1);
    }
  });

  it("is empty for no agents", () => {
    expect(layoutOffice([], { width: 40 })).toMatchObject({ rooms: [], height: 0, cramped: false });
  });
});

describe("closed agents", () => {
  const closed = (list: PaseoAgent[], ...ids: string[]) =>
    list.map((entry) => (ids.includes(entry.id) ? ({ ...entry, status: "closed" } as PaseoAgent) : entry));
  const keys = (layout: Office) => Object.fromEntries([...layout.desks].map(([id, desk]) => [id, desk.seatKey]));

  it("have no desk: the room lists them, oldest first, at a cabinet of its own", () => {
    const layout = office(closed(crew(), "meow-b", "solo-1"), 40);
    const room = layout.rooms[0];
    if (!room) throw new Error("fixture");
    expect(layout.desks.has("meow-b")).toBe(false);
    expect(layout.desks.has("solo-1")).toBe(false);
    expect(layout.desks.size).toBe(5);
    expect(room.agentCount).toBe(5);
    expect(room.closed?.ids).toEqual(["solo-1", "meow-b"]);
    // Their cabinet stands on a tile of its own, against the wall at the end of the zones.
    const at = room.closed?.at ?? { x: -1, y: -1 };
    expect(inside({ ...at, width: 1, height: 1 }, room)).toBe(true);
    expect(room.lounge.wall && inside({ ...at, width: 1, height: 1 }, room.lounge.wall)).toBe(true);
    const occupied = [
      ...room.zones.flatMap((zone) => zone.props.map((item) => `${item.x},${item.y}`)),
      ...room.zones.flatMap((zone) => zone.spots.map((spot) => `${spot.x},${spot.y}`)),
      ...[...layout.desks.values()].map((desk) => `${desk.cell.x},${desk.cell.y}`),
    ];
    expect(occupied).not.toContain(`${at.x},${at.y}`);
    expect(at.x).toBeLessThan(room.x + room.width - 1);
    // They still belong to the room.
    expect(layout.roomOf.get("meow-b")).toBe(room.workspaceId);
    expect(office(crew(), 40).rooms[0]?.closed).toBeNull();
  });

  it("free their desk: teammates seated after them sit one desk up, and nobody else changes seat", () => {
    const before = keys(office(crew(), 40));
    const after = keys(office(closed(crew(), "meow-a"), 40));
    expect(after["meow-b"]).toBe("overseer/nexus/0");
    expect(after["meow-c"]).toBe("overseer/nexus/1");
    for (const id of ["overseer", "nexus", "solo-1", "solo-2"]) expect(after[id]).toBe(before[id]);
    expect(after["meow-a"]).toBeUndefined();
  });

  it("keep their desk while they are still walking out", () => {
    const leaving = layoutOffice(groupByWorkspace(buildForest(closed(crew(), "meow-a"), null), new Map()), {
      width: 40,
      holding: new Set(["meow-a"]),
    });
    expect(keys(leaving)).toEqual(keys(office(crew(), 40)));
    expect(cells(leaving)).toEqual(cells(office(crew(), 40)));
    expect(leaving.rooms[0]?.closed).toBeNull();
  });

  it("never leave two agents at one desk, nor send anyone further from the head of the row, however fast they close", () => {
    const team = [agent({ id: "lead" }), ...Array.from({ length: 8 }, (_, index) => agent({ id: `m${index}` }, "lead"))];
    const index = (layout: Office, id: string) => Number(layout.desks.get(id)?.seatKey.split("/").pop());
    let gone: string[] = [];
    let previous = office(team, 40);
    for (const next of ["m2", "m5", "m0", "m7", "m3"]) {
      gone = [...gone, next];
      const layout = office(closed(team, ...gone), 40);
      expect(new Set(cells(layout).values()).size).toBe(layout.desks.size);
      expect(layout.desks.size).toBe(team.length - gone.length);
      for (const id of layout.desks.keys()) {
        expect(index(layout, id)).toBeLessThanOrEqual(index(previous, id));
        expect(index(previous, id) - index(layout, id)).toBeLessThanOrEqual(1);
      }
      previous = layout;
    }
    expect(previous.rooms[0]?.closed?.ids).toEqual(["m0", "m2", "m3", "m5", "m7"]);
  });

  it("leave their team in place when a lead closes", () => {
    const layout = office(closed(crew(), "nexus"), 40);
    const pod = layout.rooms[0]?.pods.find((entry) => entry.rootId === "overseer");
    expect(pod?.teams.map((team) => [team.leadId, team.desks.map((desk) => desk.agentId)])).toEqual([
      ["overseer", ["overseer"]],
      ["nexus", ["meow-a", "meow-b", "meow-c"]],
    ]);
    expect(layout.rooms[0]?.closed?.ids).toEqual(["nexus"]);
    // A closed root's parent does not come visiting for it, and a closed parent in the office is not a visitor.
    expect(layout.visitors.size).toBe(0);
  });

  it("keep their room in its place while the last of them is still walking out", () => {
    const last = agent({ id: "last", workspaceId: "ws-first" });
    const busy = agent({ id: "busy", workspaceId: "ws-second", status: "running" });
    const before = office([last, busy], 30);
    const shut = { ...last, status: "closed" } as PaseoAgent;
    const groups = groupByWorkspace(buildForest([shut, busy], null), new Map());
    const leaving = layoutOffice(groups, { width: 30, holding: new Set(["last"]) });
    expect(leaving.rooms.map((room) => room.workspaceId)).toEqual(before.rooms.map((room) => room.workspaceId));
    expect(cells(leaving)).toEqual(cells(before));
    // Once it has left, the room is bare and goes to the end.
    expect(layoutOffice(groups, { width: 30 }).rooms.map((room) => room.workspaceId)).toEqual(["ws-second", "ws-first"]);
  });

  it("make a room nobody is in: bare, last, with only the fixture", () => {
    const shut = agent({ id: "shut", workspaceId: "ws-first", status: "closed" });
    const busy = agent({ id: "busy", workspaceId: "ws-second", status: "running" });
    const layout = office([shut, busy], 30);
    expect(layout.rooms.map((room) => [room.workspaceId, room.dormant])).toEqual([
      ["ws-second", false],
      ["ws-first", true],
    ]);
    const bare = layout.rooms[1];
    expect(bare?.zones).toEqual([]);
    expect(bare?.pods).toEqual([]);
    expect(bare?.closed?.ids).toEqual(["shut"]);
    expect((bare?.height ?? 99) < (layout.rooms[0]?.height ?? 0)).toBe(true);
  });
});

describe("visitors", () => {
  const overseer = agent({ id: "overseer", workspaceId: "ws-home", labels: { "ghostline/role": "overseer" } });
  const nexus = agent({ id: "nexus", labels: { "paseo.parent-agent-id": "overseer" } });
  const meow = agent({ id: "meow" }, "nexus");
  const all = [overseer, nexus, meow];
  const directory = new Map(all.map((entry) => [entry.id, entry]));
  const panel = (extra: PaseoAgent[] = []) =>
    layoutOffice(groupByWorkspace(buildForest([...all, ...extra], "ws-a"), new Map()), {
      width: 30,
      agents: new Map([...directory, ...extra.map((entry) => [entry.id, entry] as const)]),
    });

  it("stands a root's parent from another workspace in the lounge, without a desk", () => {
    const layout = panel();
    expect(layout.desks.has("overseer")).toBe(false);
    const visitor = layout.visitors.get("overseer");
    const lounge = layout.rooms[0]?.lounge;
    expect(visitor).toMatchObject({ hostId: "nexus", workspaceId: "ws-a" });
    expect(visitor && lounge && inside({ ...visitor.at, width: 1, height: 1 }, lounge)).toBe(true);
    expect(layout.roomOf.get("overseer")).toBe("ws-a");
  });

  it("moves no seat, and is absent once the parent has a room of its own", () => {
    const without = layoutOffice(groupByWorkspace(buildForest(all, "ws-a"), new Map()), { width: 30 });
    expect(without.visitors.size).toBe(0);
    expect(cells(panel())).toEqual(cells(without));
    const everywhere = layoutOffice(groupByWorkspace(buildForest(all, null), new Map()), { width: 30, agents: directory });
    expect(everywhere.visitors.size).toBe(0);
    expect(everywhere.desks.has("overseer")).toBe(true);
  });

  it("gives each visitor its own spot, oldest first, and one spot to a parent of two crews", () => {
    const second = agent({ id: "second-overseer", workspaceId: "ws-home" });
    const layout = panel([
      second,
      agent({ id: "crew-2" }, "second-overseer"),
      agent({ id: "crew-3" }, "overseer"),
    ]);
    expect([...layout.visitors.keys()]).toEqual(["overseer", "second-overseer"]);
    const [first, next] = [...layout.visitors.values()];
    expect(first?.at).not.toEqual(next?.at);
    // From the right wall inwards along the walkway.
    expect((first?.at.x ?? 0) > (next?.at.x ?? 0)).toBe(true);
  });

  it("shows a visitor standing, with the emote of its state", () => {
    const layout = panel();
    const waiting = { ...overseer, pendingPermissions: [{ id: "p" }] } as PaseoAgent;
    const map = presences(layout, new Map([...directory, ["overseer", waiting]]), crewState, 0);
    expect(map.get("overseer")).toMatchObject({
      activity: "visiting",
      at: layout.visitors.get("overseer")?.at,
      visible: true,
      seated: false,
      emote: "question",
    });
  });
});

describe("zones", () => {
  const ids = (list: readonly string[] | undefined) => (list ?? []).join(",");

  it("furnishes less as the room narrows, each zone as wide as what it holds", () => {
    // Content width (between corridor and right wall) for rooms 9, 12 and 30 tiles wide.
    expect(fitZones(6)).toEqual({
      pantry: { width: 2, wall: ["fridge", "coffee"] },
      lounge: { width: 3, wall: ["plant", "sofa"] },
      table: true,
    });
    const twelve = fitZones(9);
    expect(ids(twelve.pantry?.wall)).toBe("fridge,counter,coffee");
    expect(ids(twelve.lounge?.wall)).toBe("plant,sofa,beanbag");
    const wide = fitZones(27);
    expect(ids(wide.pantry?.wall)).toBe("fridge,counter,coffee,water");
    expect(wide.pantry?.width).toBe(PANTRY_MAX_WIDTH);
    expect(ids(wide.lounge?.wall)).toBe("bookshelf,plant,sofa,beanbag");
    expect(wide.lounge?.width).toBe(LOUNGE_MAX_WIDTH);
    // Only a sofa fits beside the pantry: the table would stand on its rug, so there is none.
    expect(fitZones(4)).toEqual({ pantry: { width: 1, wall: ["coffee"] }, lounge: { width: 2, wall: ["sofa"] }, table: false });
    // Too narrow for a sofa: a coffee machine and nothing else.
    expect(fitZones(2)).toEqual({ pantry: { width: 1, wall: ["coffee"] }, lounge: null, table: false });
    expect(fitZones(0)).toEqual({ pantry: null, lounge: null, table: false });
  });

  it("puts props and use points on free tiles, one character to a point", () => {
    const span = (id: string) => (id === "counter" || id === "bookshelf" || id === "sofa" || id === "rug" ? 2 : 1);
    for (const width of [7, 9, 12, 17, 40]) {
      const room = office([agent({ id: "one", status: "running" })], width).rooms[0];
      if (!room) throw new Error("fixture");
      expect(room.zones.map((zone) => zone.kind)).toEqual(["pantry", "lounge"]);
      const spots = room.zones.flatMap((zone) => zone.spots);
      expect(new Set(spots.map((spot) => `${spot.x},${spot.y}`)).size).toBe(spots.length);
      const covered = new Set<string>();
      const solid = new Set<string>();
      for (const zone of room.zones) {
        for (const item of zone.props) {
          for (let dx = 0; dx < span(item.id); dx += 1) {
            expect(covered.has(`${item.x + dx},${item.y}`)).toBe(false);
            covered.add(`${item.x + dx},${item.y}`);
            if (item.id !== "rug") solid.add(`${item.x + dx},${item.y}`);
            expect(item.x + dx).toBeLessThan(room.x + room.width - 1);
          }
        }
        // A zone is exactly as wide as what stands against its wall.
        const wallProps = zone.props.filter((item) => item.y === zone.y);
        expect(zone.width).toBe(wallProps.reduce((sum, item) => sum + span(item.id), 0));
      }
      for (const spot of spots) {
        // Nobody stands on furniture or on the rug; sitting is on the seat itself.
        if (spot.pose === "stand") expect(covered.has(`${spot.x},${spot.y}`)).toBe(false);
        else expect(solid.has(`${spot.x},${spot.y}`)).toBe(true);
        expect(spot.y).toBeLessThan(room.lounge.walkway.y);
        expect(spot.aisleY).toBe(room.lounge.walkway.y);
        expect(spot.x).toBeGreaterThan(room.corridorX);
      }
      // The walkway and the corridor stay clear of furniture.
      for (const key of covered) {
        expect(Number(key.split(",")[1])).toBeLessThan(room.lounge.walkway.y);
        expect(Number(key.split(",")[0])).toBeGreaterThan(room.corridorX);
      }
      expect(spots.some((spot) => spot.pose === "sit")).toBe(true);
      // Whole tiles only: nobody is put lying across a sofa that seats two.
      expect(spots.every((spot) => Number.isInteger(spot.x))).toBe(true);
      expect(room.zones.flatMap((zone) => zone.props).some((item) => item.id === "rug")).toBe(true);
    }
  });

  it("grow with the crew: a few people need a small pantry", () => {
    const spots = (count: number) => {
      const room = office(Array.from({ length: count }, (_, index) => agent({ id: `z${count}-${index}`, status: "running" })), 60).rooms[0];
      return room?.zones.reduce((sum, zone) => sum + zone.spots.length, 0) ?? 0;
    };
    expect(spots(1)).toBeLessThan(spots(4));
    expect(spots(4)).toBeLessThan(spots(10));
    // And stop growing: a zone is furniture, not floor.
    expect(spots(10)).toBe(spots(30));
  });
});

describe("assignBreaks", () => {
  const now = Date.parse("2026-10-13T06:00:00.000Z");
  const room = office(Array.from({ length: 9 }, (_, index) => agent({ id: `host-${index}`, status: "running" })), 40).rooms[0];
  if (!room) throw new Error("fixture");
  const spotCount = room.zones.reduce((sum, zone) => sum + zone.spots.length, 0);
  const idlers = (count: number) => Array.from({ length: count }, (_, index) => ({ agentId: `idle-${index}`, since: now - 60_000 - index }));
  const where = (map: Map<string, { x: number; y: number }>) => [...map].map(([id, spot]) => `${id}@${spot.x},${spot.y}`).sort();

  it("gives everybody a point of their own, across both zones", () => {
    const out = assignBreaks(room, idlers(6), [], now);
    expect(out.size).toBe(6);
    expect(new Set([...out.values()].map((spot) => `${spot.x},${spot.y}`)).size).toBe(6);
    expect(new Set([...out.values()].map((spot) => spot.zone)).size).toBeGreaterThan(1);
  });

  it("is the same for the same room, people and stretch, whatever order they are given in", () => {
    const people = idlers(7);
    const once = where(assignBreaks(room, people, [], now));
    expect(where(assignBreaks(room, [...people].reverse(), [], now))).toEqual(once);
    // Five seconds later nobody has moved.
    expect(where(assignBreaks(room, people, [], now + 5_000))).toEqual(once);
  });

  it("moves people on between stretches, not all at the same moment", () => {
    const people = idlers(3);
    const places = (at: number) => assignBreaks(room, people, [], at);
    const moves = new Map<string, number[]>();
    let previous = places(now);
    for (let minute = 1; minute <= 30; minute += 1) {
      const current = places(now + minute * 60_000);
      for (const { agentId } of people) {
        const a = previous.get(agentId);
        const b = current.get(agentId);
        if (a && b && (a.x !== b.x || a.y !== b.y)) moves.set(agentId, [...(moves.get(agentId) ?? []), minute]);
      }
      previous = current;
    }
    // Everybody moved at least once in half an hour, and nobody every minute.
    for (const { agentId } of people) {
      expect((moves.get(agentId) ?? []).length).toBeGreaterThan(0);
      expect((moves.get(agentId) ?? []).length).toBeLessThanOrEqual(30 / (BREAK_DWELL_MIN_MS / 60_000) + 1);
    }
    expect(new Set([...moves.values()].map((minutes) => minutes[0])).size).toBeGreaterThan(1);
    expect(breakStretch("idle-0", now)).toEqual(breakStretch("idle-0", now + 1_000));
    const stretch = breakStretch("idle-0", now);
    expect(stretch.startedAt).toBeLessThanOrEqual(now);
    expect(breakStretch("idle-0", stretch.startedAt - 1).index).toBe(stretch.index - 1);
  });

  it("sends the overflow to the walkway, and leaves out whoever does not fit even there", () => {
    const walkwayTiles = room.lounge.walkway.width - 1;
    const crowd = idlers(spotCount + walkwayTiles + 5);
    const out = assignBreaks(room, crowd, [], now);
    expect(out.size).toBe(spotCount + walkwayTiles);
    const zones = [...out.values()].map((spot) => spot.zone);
    expect(zones.filter((zone) => zone === "walkway")).toHaveLength(walkwayTiles);
    expect(new Set([...out.values()].map((spot) => `${spot.x},${spot.y}`)).size).toBe(out.size);
    // Whoever is left out sleeps at the desk; it is never somebody who already had a place.
    // The foot of the corridor is nobody's place.
    expect([...out.values()].some((spot) => spot.x === room.corridorX)).toBe(false);
  });

  it("keeps off a tile a visitor stands on", () => {
    const tile = { x: room.lounge.walkway.x + room.lounge.walkway.width - 1, y: room.lounge.walkway.y };
    const out = assignBreaks(room, idlers(spotCount + 40), [tile], now);
    expect([...out.values()].some((spot) => spot.x === tile.x && spot.y === tile.y)).toBe(false);
  });

  it("gathers the finished at the table and outwards from it, and rests the idle in the lounge", () => {
    const table = room.zones.flatMap((zone) => zone.props).find((item) => item.id === "table");
    if (!table) throw new Error("fixture");
    const finished = Array.from({ length: 4 }, (_, index) => ({ agentId: `done-${index}`, since: now - 60_000 - index, purpose: "gather" as const }));
    const out = assignBreaks(room, [...finished, ...idlers(3)], [], now);
    const places = finished.map((entry) => out.get(entry.agentId));
    // Both places at the table are taken, and everybody is within three tiles of it.
    expect(places.filter((spot) => spot?.prop === "table")).toHaveLength(2);
    for (const spot of places) expect(Math.abs((spot?.x ?? 99) - table.x)).toBeLessThanOrEqual(3);
    for (const spot of places) expect(spot?.zone === "pantry" || spot?.prop === "table").toBe(true);
    for (const idler of idlers(3)) {
      expect(out.get(idler.agentId)?.zone).toBe("lounge");
      expect(out.get(idler.agentId)?.prop).not.toBe("table");
    }
    expect(new Set([...out.values()].map((spot) => `${spot.x},${spot.y}`)).size).toBe(7);
    // The same again a minute later: nobody at the pantry has moved.
    const later = assignBreaks(room, [...finished, ...idlers(3)], [], now + 60_000);
    for (const entry of finished) expect(later.get(entry.agentId)).toEqual(out.get(entry.agentId));
  });

  it("does not unseat anyone when somebody else goes idle later", () => {
    const first = assignBreaks(room, idlers(4), [], now);
    const later = assignBreaks(room, [...idlers(4), { agentId: "latecomer", since: now - 1_000 }], [], now);
    for (const [id, spot] of first) expect(later.get(id)).toEqual(spot);
    expect(later.has("latecomer")).toBe(true);
  });
});

describe("presenceOf", () => {
  const now = Date.parse("2026-10-13T06:00:00.000Z");
  const recent = new Date(now - 60_000).toISOString();
  const subject = agent({ id: "subject", updatedAt: recent });
  const layout = office([subject, agent({ id: "other", status: "running" })], 30);
  const desk = layout.desks.get("subject");
  const room = layout.rooms[0];
  if (!desk || !room) throw new Error("fixture");
  const sofa = room.zones.flatMap((zone) => zone.spots).find((spot) => spot.prop === "sofa");
  const table = room.zones.flatMap((zone) => zone.spots).find((spot) => spot.prop === "table");
  if (!sofa || !table) throw new Error("fixture");
  const at = (state: CrewState, who: PaseoAgent = subject, spot = sofa) => presenceOf(who, state, desk, spot, now);

  it("maps each state to a place and an activity", () => {
    expect(at("working")).toMatchObject({ activity: "typing", at: desk.seat, facing: "up", seated: true, screenOn: true, emote: null, visible: true });
    expect(at("needs-input")).toMatchObject({ activity: "asking", at: desk.stand, facing: "down", seated: false, emote: "question" });
    expect(at("failed")).toMatchObject({ activity: "stuck", at: desk.seat, seated: true, emote: "alert" });
    expect(presenceOf(subject, "ready", desk, null, now)).toMatchObject({ activity: "done", at: desk.stand, seated: false, emote: "check" });
    expect(at("closed")).toMatchObject({ activity: "away", visible: false, screenOn: false, emote: null });
  });

  it("takes a recently idle agent to its break place, as that place is used", () => {
    expect(at("idle")).toMatchObject({
      activity: "wandering",
      at: { x: sofa.x, y: sofa.y },
      aisleY: room.lounge.walkway.y,
      lounging: true,
      lift: sofa.lift,
      facing: "down",
      seated: false,
      screenOn: false,
      carry: null,
    });
    expect(at("idle", subject, table)).toMatchObject({ lounging: false, act: "drink", facing: table.facing, lift: 0, placeId: table.id });
    // A place keeps its name when the room is laid out afresh, so the scene can tell a reshape from a move.
    expect(table.id).toBe("table:0");
    expect(sofa.id).toMatch(/^sofa:[01]$/);
    expect(at("working").placeId).toBeNull();
    expect(presenceOf(subject, "idle", desk, table, now, true).act).toBe("talk");
    const walkway = { id: "walkway:3", x: room.lounge.walkway.x + 3, y: room.lounge.walkway.y, aisleY: room.lounge.walkway.y, pose: "stand" as const, facing: "down" as const, lift: 0, prop: null, zone: "walkway" as const };
    expect(at("idle", subject, walkway).act).toBe("stretch");
    // What somebody does on the sofa is theirs for the stretch: sitting, dozing or reading a book.
    const onSofa = new Set(Array.from({ length: 40 }, (_, index) => at("idle", { ...subject, id: `sitter-${index}` } as PaseoAgent).act));
    expect([...onSofa].sort()).toEqual([null, "doze", "read"].sort());
    expect(at("idle", { ...subject, id: "sitter-0" } as PaseoAgent)).toEqual(at("idle", { ...subject, id: "sitter-0" } as PaseoAgent));
  });

  it("takes a finished agent to the pantry with its check, its screen left on, until the break is over", () => {
    const counter = room.zones.flatMap((zone) => zone.spots).find((spot) => spot.zone === "pantry" && spot.prop !== "table");
    if (!counter) throw new Error("fixture");
    expect(at("ready", subject, table)).toMatchObject({
      activity: "gathering",
      at: { x: table.x, y: table.y },
      emote: "check",
      screenOn: true,
      act: "drink",
      facing: table.facing,
    });
    expect(presenceOf(subject, "ready", desk, table, now, true).act).toBe("talk");
    // In front of an appliance it turns to the room, cup in hand.
    expect(at("ready", subject, counter)).toMatchObject({ activity: "gathering", facing: "down", act: "drink" });
    expect(at("ready", subject, sofa)).toMatchObject({ activity: "gathering", lounging: true, act: null, emote: "check" });
    const stale = { ...subject, updatedAt: new Date(now - WANDER_MS).toISOString() } as PaseoAgent;
    expect(at("ready", stale, table)).toMatchObject({ activity: "done", at: desk.stand, emote: "check" });
    for (const state of ["needs-input", "failed", "working"] as const) expect(at(state, subject, table).at).not.toEqual({ x: table.x, y: table.y });
  });

  it("sends a long-idle agent, or one with nowhere to go, to sleep at its desk", () => {
    const stale = { ...subject, updatedAt: new Date(now - WANDER_MS).toISOString() } as PaseoAgent;
    expect(at("idle", stale)).toMatchObject({ activity: "asleep", at: desk.seat, seated: true, emote: "zzz", lounging: false });
    const unreadable = { ...subject, updatedAt: "never" } as PaseoAgent;
    expect(at("idle", unreadable).activity).toBe("asleep");
    expect(presenceOf(subject, "idle", desk, null, now).activity).toBe("asleep");
  });

  it("measures idleness from the attention timestamp when there is one", () => {
    const attended = { ...subject, updatedAt: "2026-10-01T00:00:00.000Z", attentionTimestamp: recent } as PaseoAgent;
    expect(at("idle", attended).activity).toBe("wandering");
  });
});

describe("presences", () => {
  it("gives every idle agent on a break a place of its own in its own room", () => {
    const now = Date.parse("2026-10-13T06:00:00.000Z");
    const fresh = new Date(now - 1_000).toISOString();
    const agents = [
      ...Array.from({ length: 5 }, (_, index) => agent({ id: `a${index}`, workspaceId: "ws-a", updatedAt: fresh })),
      agent({ id: "b", workspaceId: "ws-b", updatedAt: fresh }),
      agent({ id: "busy", workspaceId: "ws-b", status: "running" }),
    ];
    const layout = office(agents, 30);
    const map = presences(layout, new Map(agents.map((entry) => [entry.id, entry])), crewState, now);
    expect(map.size).toBe(7);
    expect(map.get("busy")?.activity).toBe("typing");
    const tiles = new Set<string>();
    for (const id of ["a0", "a1", "a2", "a3", "a4", "b"]) {
      const presence = map.get(id);
      const room = layout.rooms.find((entry) => entry.workspaceId === layout.roomOf.get(id));
      expect(presence?.activity).toBe("wandering");
      expect(room && presence && inside({ ...presence.at, width: 1, height: 1 }, room.lounge)).toBe(true);
      tiles.add(`${presence?.at.x},${presence?.at.y}`);
    }
    expect(tiles.size).toBe(6);
  });
});

describe("candidatesOf", () => {
  it("lists every agent of a forest with its state", () => {
    const roots = buildForest([agent({ id: "root", status: "running" }), agent({ id: "kid" }, "root")], null);
    expect(candidatesOf(roots).map((entry) => [entry.id, entry.state])).toEqual([
      ["root", "working"],
      ["kid", "idle"],
    ]);
  });
});

describe("nextPresenceChange", () => {
  const start = Date.parse("2026-10-13T08:00:00.000Z");
  const at = (ms: number) => new Date(start + ms).toISOString();
  const directory = (agents: PaseoAgent[]) => new Map(agents.map((entry) => [entry.id, entry]));

  it("is null when nobody is on a break: working, asking, failed, closed, or idle for longer than a break", () => {
    const agents = [
      agent({ id: "busy", status: "running", updatedAt: at(0) }),
      agent({ id: "old", status: "idle", updatedAt: at(-WANDER_MS - 1) }),
      agent({ id: "shut", status: "closed", updatedAt: at(0) }),
    ];
    expect(nextPresenceChange(office(agents, 20), directory(agents), crewState, start + 1_000)).toBeNull();
  });

  it("is a moment after now, no later than the end of the break, and nothing changes before it", () => {
    const agents = [
      agent({ id: "busy", status: "running", updatedAt: at(0) }),
      agent({ id: "resting", status: "idle", updatedAt: at(0) }),
      agent({ id: "resting-too", status: "idle", updatedAt: at(40_000) }),
    ];
    const layout = office(agents, 20);
    const all = directory(agents);
    const spots = (now: number) =>
      JSON.stringify([...presences(layout, all, crewState, now)].map(([id, presence]) => [id, presence.activity, presence.at, presence.act]));
    let now = start + 60_000;
    let wakes = 0;
    // Wake by wake through the whole break and past it.
    for (;;) {
      const next = nextPresenceChange(layout, all, crewState, now);
      if (next === null) break;
      expect(next).toBeGreaterThan(now);
      expect(next).toBeLessThanOrEqual(start + 40_000 + WANDER_MS);
      // Checked a few times on the way: the office is as it was at the last wake.
      for (const share of [0.25, 0.5, 0.999]) expect(spots(now + (next - 1 - now) * share)).toBe(spots(now));
      now = next;
      wakes += 1;
      expect(wakes).toBeLessThan(40);
    }
    expect(now).toBe(start + 40_000 + WANDER_MS);
    expect(wakes).toBeGreaterThan(2);
    // After the last wake everybody is back at a desk.
    expect([...presences(layout, all, crewState, now).values()].map((presence) => presence.activity).sort()).toEqual(["asleep", "asleep", "typing"]);
  });
});

describe("shareOffice and sharePresences", () => {
  const directory = (agents: PaseoAgent[]) => new Map(agents.map((entry) => [entry.id, entry]));

  it("is the earlier office itself when the layout came out the same", () => {
    const agents = crew();
    const before = office(agents, 31);
    expect(shareOffice(before, office(agents, 31))).toBe(before);
    expect(shareOffice(null, before)).toBe(before);
  });

  it("keeps the objects of everything a change did not touch", () => {
    const agents = [...crew(), agent({ id: "elsewhere", workspaceId: "ws-b" }), agent({ id: "other-1", workspaceId: "ws-c" })];
    const before = office(agents, 48);
    // One more agent in ws-c: that room changes, and whatever has to move for it.
    const after = shareOffice(before, office([...agents, agent({ id: "other-2", workspaceId: "ws-c" })], 48));
    expect(after).not.toBe(before);
    const fresh = office([...agents, agent({ id: "other-2", workspaceId: "ws-c" })], 48);
    expect(after).toEqual(fresh);
    const room = (layout: Office, id: string) => layout.rooms.find((entry) => entry.workspaceId === id);
    expect(room(after, "ws-c")).not.toBe(room(before, "ws-c"));
    const untouched = after.rooms.filter((entry) => before.rooms.includes(entry));
    expect(untouched.length).toBeGreaterThan(0);
    for (const entry of untouched) expect(entry).toEqual(room(fresh, entry.workspaceId));
    expect(after.desks.get("meow-a")).toBe(before.desks.get("meow-a"));
    expect(after.desks.has("other-2")).toBe(true);
  });

  it("keeps the presence of whoever goes on as before, and replaces the one that changed", () => {
    const agents = crew();
    const layout = office(agents, 31);
    const before = presences(layout, directory(agents), crewState, 0);
    const changed = agents.map((entry) => (entry.id === "meow-b" ? { ...entry, status: "running" as const } : entry));
    const after = sharePresences(before, presences(layout, directory(changed), crewState, 0));
    expect(after.get("meow-a")).toBe(before.get("meow-a"));
    expect(after.get("meow-b")).not.toBe(before.get("meow-b"));
    expect(after.get("meow-b")?.activity).toBe("typing");
    expect(sharePresences(before, presences(layout, directory(agents), crewState, 0))).toBe(before);
  });
});
