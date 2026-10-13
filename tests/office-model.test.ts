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
  presenceOf,
  presences,
  type Office,
  type Rect,
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

function office(agents: PaseoAgent[], width: number, roomColumns?: number): Office {
  const groups = groupByWorkspace(buildForest(agents, null), new Map());
  return layoutOffice(groups, { width, ...(roomColumns ? { roomColumns } : {}) });
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
  it("gives every agent one desk, inside its pod, inside its room, overlapping nobody", () => {
    for (const width of [20, 31, 48, 120]) {
      const agents = [...crew(), agent({ id: "elsewhere", workspaceId: "ws-b" })];
      const layout = office(agents, width);
      expect(layout.desks.size).toBe(agents.length);
      expect(new Set(cells(layout).values()).size).toBe(agents.length);
      for (const room of layout.rooms) {
        expect(room.x + room.width).toBeLessThanOrEqual(layout.width);
        expect(room.y + room.height).toBeLessThanOrEqual(layout.height);
        expect(inside(room.lounge, room)).toBe(true);
        expect(inside(room.header, room)).toBe(true);
        for (const pod of room.pods) {
          expect(inside(pod, room)).toBe(true);
          expect(pod.y + pod.height).toBeLessThanOrEqual(room.lounge.y);
          for (const team of pod.teams) {
            expect(inside(team.area, pod)).toBe(true);
            for (const desk of team.desks) {
              expect(inside({ ...desk.cell, width: DESK_WIDTH, height: DESK_HEIGHT }, team.area)).toBe(true);
            }
          }
        }
        expect(inside(room.lounge.walkway, room.lounge)).toBe(true);
        for (const zone of room.zones) {
          expect(inside(zone, room.lounge)).toBe(true);
          expect(zone.x).toBeGreaterThan(room.corridorX);
          for (const spot of zone.spots) expect(inside({ ...spot, width: 1, height: 1 }, zone)).toBe(true);
        }
      }
      const rooms = layout.rooms;
      for (const a of rooms) {
        for (const b of rooms) {
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
    // Agents on their own take a single desk each.
    expect(room?.pods.filter((entry) => entry.width === DESK_WIDTH).map((entry) => entry.rootId)).toEqual(["solo-1", "solo-2"]);
    const desk = layout.desks.get("meow-a");
    expect(desk?.seat).toEqual({ x: (desk?.cell.x ?? 0) + 0.5, y: (desk?.cell.y ?? 0) + 1 });
    // It stands where it sat: in front of its own chair, in nobody's way.
    expect(desk?.stand).toEqual(desk?.seat);
    expect(desk?.aisleY).toBe((desk?.cell.y ?? 0) + 2);
  });

  it("does not move anyone when states change", () => {
    const agents = crew();
    const before = cells(office(agents, 48));
    const shaken = agents.map((entry, index) => ({
      ...entry,
      status: (["running", "error", "closed", "idle"] as const)[index % 4],
      requiresAttention: index % 2 === 0,
      attentionReason: index % 2 === 0 ? ("finished" as const) : null,
      updatedAt: new Date(Date.parse(entry.updatedAt) + index * 77_000).toISOString(),
    })) as PaseoAgent[];
    expect(cells(office(shaken, 48))).toEqual(before);
    // The forest hands its nodes over in state order; the office must not care.
    expect(cells(office([...shaken].reverse(), 48))).toEqual(before);
  });

  it("does not move anyone when agents arrive: a new teammate, a new team, a new solo, a new room", () => {
    const agents = crew();
    const before = cells(office(agents, 48, 1));
    const grown = [
      ...agents,
      agent({ id: "meow-d" }, "nexus"),
      agent({ id: "helper" }, "meow-a"),
      agent({ id: "solo-3" }),
      agent({ id: "other-room", workspaceId: "ws-b" }),
    ];
    const after = cells(office(grown, 48, 1));
    for (const [id, cell] of before) expect(after.get(id)).toBe(cell);
    const layout = office(grown, 48, 1);
    expect(layout.desks.get("helper")).toMatchObject({ leadId: "meow-a", seatKey: "overseer/meow-a/0" });
    // meow-a now leads a team and still sits where it sat.
    expect(layout.desks.get("meow-a")?.seatKey).toBe("overseer/nexus/0");
  });

  it("keeps the column and the order of later teams when an earlier team wraps to a new row", () => {
    const base = [agent({ id: "root" }), agent({ id: "lead" }, "root"), agent({ id: "under-lead" }, "lead")];
    // 20 tiles wide: five desks to a pod row.
    const before = office(base, 20);
    const more = [...base, ...["c2", "c3", "c4", "c5", "c6"].map((id) => agent({ id }, "root"))];
    const after = office(more, 20);
    expect(after.desks.get("under-lead")?.cell.x).toBe(before.desks.get("under-lead")?.cell.x);
    expect(after.desks.get("under-lead")?.cell.y).toBe((before.desks.get("under-lead")?.cell.y ?? 0) + DESK_HEIGHT);
    expect(after.desks.get("under-lead")?.seatKey).toBe(before.desks.get("under-lead")?.seatKey);
    for (const id of ["root", "lead"]) expect(after.desks.get(id)?.cell).toEqual(before.desks.get(id)?.cell);
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

  it("puts rooms nobody is in after the rooms in use", () => {
    const shut = agent({ id: "shut", workspaceId: "ws-first", status: "closed" });
    const busy = agent({ id: "busy", workspaceId: "ws-second", status: "running" });
    const layout = office([shut, busy], 30, 1);
    expect(layout.rooms.map((room) => [room.workspaceId, room.dormant])).toEqual([
      ["ws-second", false],
      ["ws-first", true],
    ]);
  });

  it("keeps a child that runs in another workspace in its crew's room and marks it remote", () => {
    const layout = office([agent({ id: "root" }), agent({ id: "away", workspaceId: "ws-b" }, "root")], 30);
    expect(layout.rooms).toHaveLength(1);
    expect(layout.desks.get("away")).toMatchObject({ remote: true, rootId: "root" });
    expect(layout.desks.get("root")?.remote).toBe(false);
  });

  it("fits a phone-width panel and reports a width too narrow to hold a desk", () => {
    const phone = office(crew(), 20);
    expect(phone.width).toBe(20);
    expect(phone.cramped).toBe(false);
    expect(phone.rooms).toHaveLength(1);
    expect(phone.rooms[0]?.width).toBe(20);
    const tiny = office(crew(), 3);
    expect(tiny.cramped).toBe(true);
    expect(tiny.width).toBe(MIN_ROOM_WIDTH);
    expect(tiny.desks.size).toBe(7);
    expect(new Set([...tiny.desks.values()].map((desk) => desk.cell.x)).size).toBe(1);
  });

  it("puts rooms side by side on a wide surface, or stacks them when told to", () => {
    const agents = ["ws-a", "ws-b", "ws-c"].map((workspaceId) => agent({ id: `in-${workspaceId}`, workspaceId }));
    const wide = office(agents, 140);
    // Twelve rooms of the target width fit, each sharing a wall with the next.
    expect(wide.rooms.map((room) => room.width)).toEqual([12, 12, 12]);
    expect(wide.rooms.map((room) => room.x)).toEqual([0, 11, 22]);
    expect(new Set(wide.rooms.map((room) => room.y)).size).toBe(1);
    expect(new Set(wide.rooms.map((room) => room.width)).size).toBe(1);
    const stacked = office(agents, 140, 1);
    expect(stacked.rooms.every((room) => room.x === 0 && room.width === 140)).toBe(true);
    expect(new Set(stacked.rooms.map((room) => room.y)).size).toBe(3);
    // More columns than can hold a desk each are not honoured.
    expect(office(agents, 20, 9).rooms.every((room) => room.width >= MIN_ROOM_WIDTH)).toBe(true);
  });

  it("holds one workspace of seventy agents in a deep tree without losing or overlapping any", () => {
    const agents = [agent({ id: "root" })];
    for (let lead = 0; lead < 6; lead += 1) {
      agents.push(agent({ id: `lead-${lead}` }, lead === 0 ? "root" : `lead-${lead - 1}`));
      for (let member = 0; member < 9; member += 1) agents.push(agent({ id: `m-${lead}-${member}` }, `lead-${lead}`));
    }
    for (let solo = 0; solo < 9; solo += 1) agents.push(agent({ id: `solo-${solo}` }));
    expect(agents).toHaveLength(70);
    for (const width of [20, 200]) {
      const layout = office(agents, width, 1);
      expect(layout.desks.size).toBe(70);
      expect(new Set(cells(layout).values()).size).toBe(70);
      expect(layout.rooms[0]?.agentCount).toBe(70);
      expect(layout.desks.get("m-5-8")?.depth).toBe(7);
      const pod = layout.rooms[0]?.pods.find((entry) => entry.rootId === "root");
      expect(pod?.width).toBeLessThanOrEqual(MAX_POD_COLUMNS * DESK_WIDTH);
      expect(pod?.teams).toHaveLength(7);
    }
  });

  it("keeps a free corridor inside the left wall, from the door down to the lounge", () => {
    const layout = office(crew(), 20);
    const room = layout.rooms[0];
    if (!room) throw new Error("fixture");
    expect(room.corridorX).toBe(room.x + 1);
    expect(room.door.x).toBe(room.corridorX);
    expect(room.door.y).toBeLessThan(Math.min(...[...layout.desks.values()].map((desk) => desk.cell.y)));
    for (const desk of layout.desks.values()) expect(desk.cell.x).toBeGreaterThan(room.corridorX);
    expect(room.lounge.x).toBeLessThanOrEqual(room.corridorX);
  });

  it("is empty for no agents", () => {
    expect(layoutOffice([], { width: 40 })).toMatchObject({ rooms: [], height: 0, cramped: false });
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
      roomColumns: 1,
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
    const without = layoutOffice(groupByWorkspace(buildForest(all, "ws-a"), new Map()), { width: 30, roomColumns: 1 });
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
      const room = office([agent({ id: "one", status: "running" })], width, 1).rooms[0];
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
      expect(room.zones.flatMap((zone) => zone.props).some((item) => item.id === "rug")).toBe(true);
    }
  });

  it("never moves a desk: the same forest sits the same with zones and without", () => {
    const agents = crew();
    for (const width of [9, 12, 20, 48]) {
      const furnished = office(agents, width, 1);
      const bare = office(agents.map((entry) => ({ ...entry, status: "closed" }) as PaseoAgent), width, 1);
      expect(furnished.rooms[0]?.zones.length).toBe(2);
      expect(bare.rooms[0]?.zones).toEqual([]);
      expect(bare.rooms[0]?.dormant).toBe(true);
      expect(cells(bare)).toEqual(cells(furnished));
      expect((bare.rooms[0]?.height ?? 0) < (furnished.rooms[0]?.height ?? 0)).toBe(true);
    }
  });
});

describe("assignBreaks", () => {
  const now = Date.parse("2026-10-13T06:00:00.000Z");
  const room = office([agent({ id: "host", status: "running" })], 17, 1).rooms[0];
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
    const people = idlers(5);
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
  const layout = office([subject, agent({ id: "other", status: "running" })], 30, 1);
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
    expect(at("ready")).toMatchObject({ activity: "done", at: desk.stand, seated: false, emote: "check" });
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
    expect(at("idle", subject, table)).toMatchObject({ lounging: false, carry: "cup", facing: table.facing, lift: 0 });
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
    const layout = office(agents, 30, 1);
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
