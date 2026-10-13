import type { PaseoAgent } from "@getpaseo/client";
import { PROPS, PROP_USES } from "./pixel/props";
import { STATE_ORDER, activityAt, parentAgentId, roleOf, type CrewGroup, type CrewNode, type CrewState } from "./model";

/**
 * The office, in tiles. A room per workspace, a pod per crew tree, a desk per
 * agent, and along the bottom of each room a pantry and a lounge to go to when
 * there is nothing to do.
 *
 * Seats are assigned from facts that never change: who an agent's parent is and
 * when it was created. State is never consulted, so a seat does not move when
 * anyone's state does, and every later arrival is appended after the agents
 * already seated.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point {
  width: number;
  height: number;
}

/** One desk cell: the desk on its top row, the chair under it, an aisle row below. */
export const DESK_WIDTH = 3;
export const DESK_HEIGHT = 3;
/** Most desks in one row of a pod, however wide the room is. */
export const MAX_POD_COLUMNS = 6;
const WALL = 1;
const GAP = 1;
/** A free column inside the left wall, from the door down to the lounge: where characters walk between rows. */
const CORRIDOR = 1;
const HEADER_HEIGHT = 2;
/**
 * The rows of the strip under the desks: a wall the appliances and shelves
 * stand against, the row in front of them, a row of floor furniture, and a
 * walkway that is always clear.
 */
const ZONE_ROWS = 4;
/** A room nobody is in keeps only the walkway. */
const DORMANT_ROWS = 1;
/** A zone is furniture, not floor: however wide the room, it stops here. */
export const PANTRY_MAX_WIDTH = 6;
export const LOUNGE_MAX_WIDTH = 8;
/** The narrowest room that still holds one desk between its walls. */
export const MIN_ROOM_WIDTH = DESK_WIDTH + 2 * WALL + CORRIDOR;
/** On a wide surface rooms sit side by side, each about this wide: five desks between the walls. */
export const ROOM_TARGET_WIDTH = 17;

export interface Desk {
  agentId: string;
  /** `rootId/teamLeadId/index`: stable for as long as the agents seated before this one remain. */
  seatKey: string;
  rootId: string;
  parentId: string | null;
  /** The agent whose team this desk belongs to; the root leads its own desk. */
  leadId: string;
  depth: number;
  role: string | null;
  /** True when the agent runs in another workspace than the room it sits in. */
  remote: boolean;
  /** Top-left tile of the desk cell, in office coordinates. */
  cell: Point;
  /** Where the character sits, facing up at the desk. */
  seat: Point;
  /** Where the character stands when it has stepped away from the keyboard: beside its chair. */
  stand: Point;
  /** The free row under the desk cell, which characters walk along. */
  aisleY: number;
}

export interface Team {
  leadId: string;
  /** Index among the pod's teams, in founding order; a tint a view can key on. */
  index: number;
  /** The tiles this team's rows cover. */
  area: Rect;
  desks: Desk[];
}

export interface Pod extends Rect {
  rootId: string;
  teams: Team[];
}

/** The props a zone can hold; ids, footprints and use points are the sprite catalogue's table. */
export type ZonePropId = "fridge" | "counter" | "coffee" | "water" | "table" | "bookshelf" | "plant" | "sofa" | "lowTable" | "beanbag";

export interface ZoneProp {
  id: ZonePropId;
  /** Its leftmost tile. */
  x: number;
  y: number;
}

/** Somewhere a character goes to be: in front of the coffee machine, on the sofa. One character each. */
export interface UseSpot extends Point {
  /** The clear row it is reached by. */
  aisleY: number;
  pose: "stand" | "sit";
  facing: "up" | "down" | "left" | "right";
  /** Art pixels to raise a sitter so it rests on the seat. */
  lift: number;
  prop: ZonePropId | null;
  zone: "pantry" | "lounge" | "walkway";
}

export interface Zone extends Rect {
  kind: "pantry" | "lounge";
  props: ZoneProp[];
  spots: UseSpot[];
}

/** The strip under the desks. */
export interface Lounge extends Rect {
  /** The bottom row: always clear, where people pass, visitors stand and the overflow waits. */
  walkway: Rect;
  /** The tiles of the half wall the zones' appliances stand against, if the room is furnished. */
  wall: Rect | null;
}

export interface Room extends Rect {
  workspaceId: string;
  name: string;
  counts: Record<CrewState, number>;
  /** 0 needs you, 1 failed, 2 neither. Rooms are not reordered by it; a view may badge or jump. */
  urgency: 0 | 1 | 2;
  /** Every agent in the room is closed. */
  dormant: boolean;
  /** The strip under the top wall where a view writes the room name. */
  header: Rect;
  /** The free column characters use to walk between rows. */
  corridorX: number;
  /** Where characters come in and go out: the top of the corridor, in the wall. */
  door: Point;
  pods: Pod[];
  lounge: Lounge;
  /** The pantry and the lounge, each with its props and use points. Empty in a room nobody is in. */
  zones: Zone[];
  agentCount: number;
}

/** A crew's parent that has no desk in this office: it stands in the lounge of the room it parents into. */
export interface Visitor {
  agentId: string;
  /** The root it is the parent of. */
  hostId: string;
  workspaceId: string;
  at: Point;
}

export interface Office {
  width: number;
  height: number;
  rooms: Room[];
  /** agentId → its desk. Every agent in the forest has exactly one. */
  desks: ReadonlyMap<string, Desk>;
  /** agentId → the room it sits in, or visits. */
  roomOf: ReadonlyMap<string, string>;
  /** agentId → where it stands. Visitors never take a desk, so they move nobody. */
  visitors: ReadonlyMap<string, Visitor>;
  /**
   * The width the caller offered was narrower than `MIN_ROOM_WIDTH`; the office
   * is laid out at the minimum and a view has to scroll or scale.
   */
  cramped: boolean;
}

export interface OfficeOptions {
  /** Available width in tiles. */
  width: number;
  /** Rooms per row. Defaults to as many `ROOM_TARGET_WIDTH` rooms as fit; pass 1 for a single-room panel. */
  roomColumns?: number;
  /**
   * The whole directory. With it, the parent of a root that is not itself in
   * the office (it runs in a workspace the office does not show) is placed as a
   * visitor.
   */
  agents?: ReadonlyMap<string, PaseoAgent>;
}

const bySeniority = (a: PaseoAgent, b: PaseoAgent): number =>
  a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

interface Member {
  agent: PaseoAgent;
  depth: number;
  parentId: string | null;
}

interface TeamPlan {
  leadId: string;
  members: Member[];
}

/**
 * A crew tree as teams. The root's team is the root followed by its children;
 * every other agent with children leads a team made of those children, while
 * keeping its own desk in its parent's team. Teams are ordered by when their
 * first member was created, members by when they were. Both orders only ever
 * grow at the end.
 */
function planTeams(root: CrewNode): TeamPlan[] {
  const teams: Array<TeamPlan & { founded: PaseoAgent }> = [];
  const walk = (node: CrewNode, isRoot: boolean) => {
    const children = [...node.children].sort((a, b) => bySeniority(a.agent, b.agent));
    const members: Member[] = children.map((child) => ({
      agent: child.agent,
      depth: child.depth,
      parentId: node.agent.id,
    }));
    if (isRoot) {
      // A root named in its own parent label still has no desk but its own.
      const parentId = parentAgentId(node.agent);
      members.unshift({ agent: node.agent, depth: node.depth, parentId: parentId === node.agent.id ? null : parentId });
    }
    const first = members[0];
    if (first) teams.push({ leadId: node.agent.id, members, founded: first.agent });
    for (const child of children) walk(child, false);
  };
  walk(root, true);
  return teams.sort((a, b) => bySeniority(a.founded, b.founded));
}

interface PodPlan {
  rootId: string;
  root: PaseoAgent;
  teams: TeamPlan[];
  columns: number;
  rows: number;
}

function planPod(root: CrewNode, podColumns: number): PodPlan {
  const teams = planTeams(root);
  const solo = teams.length === 1 && (teams[0] as TeamPlan).members.length === 1;
  // A crew's pod is as wide as the room allows, whatever its size, so that
  // growing only ever adds rows below; an agent on its own takes one desk.
  const columns = solo ? 1 : podColumns;
  const rows = teams.reduce((sum, team) => sum + Math.ceil(team.members.length / columns), 0);
  return { rootId: root.agent.id, root: root.agent, teams, columns, rows };
}

function placePod(plan: PodPlan, origin: Point, workspaceId: string): Pod {
  const teams: Team[] = [];
  let row = 0;
  plan.teams.forEach((team, index) => {
    const rows = Math.ceil(team.members.length / plan.columns);
    const desks = team.members.map((member, seatIndex): Desk => {
      const cell = {
        x: origin.x + (seatIndex % plan.columns) * DESK_WIDTH,
        y: origin.y + (row + Math.floor(seatIndex / plan.columns)) * DESK_HEIGHT,
      };
      return {
        agentId: member.agent.id,
        seatKey: `${plan.rootId}/${team.leadId}/${seatIndex}`,
        rootId: plan.rootId,
        parentId: member.parentId,
        leadId: team.leadId,
        depth: member.depth,
        role: roleOf(member.agent),
        remote: (member.agent.workspaceId ?? "") !== workspaceId,
        cell,
        seat: { x: cell.x + 1, y: cell.y + 1 },
        stand: { x: cell.x + 2, y: cell.y + 1 },
        aisleY: cell.y + DESK_HEIGHT - 1,
      };
    });
    teams.push({
      leadId: team.leadId,
      index,
      area: {
        x: origin.x,
        y: origin.y + row * DESK_HEIGHT,
        width: Math.min(team.members.length, plan.columns) * DESK_WIDTH,
        height: rows * DESK_HEIGHT,
      },
      desks,
    });
    row += rows;
  });
  return {
    rootId: plan.rootId,
    x: origin.x,
    y: origin.y,
    width: plan.columns * DESK_WIDTH,
    height: plan.rows * DESK_HEIGHT,
    teams,
  };
}

export interface ZoneFit {
  pantry: { width: number; wall: ZonePropId[]; table: boolean } | null;
  lounge: { width: number; wall: ZonePropId[]; floor: ZonePropId[] } | null;
}

const tilesWide = (id: ZonePropId): number => PROPS[id].tilesWide;

/** The props that fit `room` tiles in a row, taken in order of `priority`, laid out in `order`. */
function pack(room: number, priority: readonly ZonePropId[], order: readonly ZonePropId[]): ZonePropId[] {
  const chosen = new Set<ZonePropId>();
  let left = room;
  for (const id of priority) {
    if (tilesWide(id) > left) continue;
    chosen.add(id);
    left -= tilesWide(id);
  }
  return order.filter((id) => chosen.has(id));
}

/**
 * What a room `contentWidth` tiles wide between corridor and right wall is
 * furnished with. The pantry takes a little under half, the lounge the rest,
 * with a tile between them, each up to its cap. As the room narrows the pantry
 * gives up its water cooler, then the counter, then the standing table, then
 * the fridge, and keeps the coffee machine; the lounge gives up the low table,
 * then the beanbag, then the bookshelf, and keeps the sofa and a plant.
 */
export function fitZones(contentWidth: number): ZoneFit {
  if (contentWidth < 1) return { pantry: null, lounge: null };
  const pantryWidth = Math.max(1, Math.min(PANTRY_MAX_WIDTH, Math.floor(contentWidth * 0.45)));
  const loungeWidth = Math.min(LOUNGE_MAX_WIDTH, contentWidth - pantryWidth - 1);
  const pantry = {
    width: pantryWidth,
    wall: pack(pantryWidth, ["coffee", "fridge", "counter", "water"], ["fridge", "counter", "coffee", "water"]),
    // A standing table needs a tile either side for whoever stands at it.
    table: pantryWidth >= 3,
  };
  if (loungeWidth < 2) return { pantry, lounge: null };
  const floor: ZonePropId[] = ["sofa"];
  if (loungeWidth >= 4) floor.push("beanbag");
  if (loungeWidth >= 6) floor.splice(1, 0, "lowTable");
  return {
    pantry,
    lounge: { width: loungeWidth, wall: pack(loungeWidth, ["plant", "bookshelf"], ["bookshelf", "plant"]), floor },
  };
}

function useSpots(props: readonly ZoneProp[], zone: "pantry" | "lounge", walkY: number): UseSpot[] {
  const spots: UseSpot[] = [];
  for (const item of props) {
    for (const use of PROP_USES[item.id]) {
      const y = item.y + use.dy;
      spots.push({
        x: item.x + use.dx,
        y,
        // The row in front of the wall is clear and is its own way in; floor furniture is reached from the walkway.
        aisleY: use.dy === 1 ? y : walkY,
        pose: use.pose === "sit" ? "sit" : "stand",
        facing: use.facing,
        lift: use.lift,
        prop: item.id,
        zone,
      });
    }
  }
  return spots;
}

function furnish(left: number, top: number, contentWidth: number): Zone[] {
  const fit = fitZones(contentWidth);
  const wallY = top;
  const floorY = top + 2;
  const walkY = top + ZONE_ROWS - 1;
  const zones: Zone[] = [];
  const row = (ids: readonly ZonePropId[], x: number, y: number, gap = 0): ZoneProp[] => {
    const out: ZoneProp[] = [];
    let at = x;
    for (const id of ids) {
      out.push({ id, x: at, y });
      at += tilesWide(id) + gap;
    }
    return out;
  };
  if (fit.pantry) {
    const props = row(fit.pantry.wall, left, wallY);
    if (fit.pantry.table) props.push({ id: "table", x: left + 1, y: floorY });
    zones.push({ kind: "pantry", x: left, y: top, width: fit.pantry.width, height: ZONE_ROWS, props, spots: useSpots(props, "pantry", walkY) });
  }
  if (fit.lounge && fit.pantry) {
    const x = left + fit.pantry.width + 1;
    // Seats stand a tile apart so nobody sits in anybody's lap.
    const props = [...row(fit.lounge.wall, x, wallY), ...row(fit.lounge.floor, x, floorY, 1)];
    zones.push({ kind: "lounge", x, y: top, width: fit.lounge.width, height: ZONE_ROWS, props, spots: useSpots(props, "lounge", walkY) });
  }
  return zones;
}

function layoutRoom(group: CrewGroup, origin: Point, width: number): Room {
  // Desk cells stand against the right wall and the corridor: a desk is narrower than its cell, which is margin enough.
  const inner = width - 2 * WALL - CORRIDOR;
  const podColumns = Math.max(1, Math.min(MAX_POD_COLUMNS, Math.floor(inner / DESK_WIDTH)));
  const plans = [...group.roots]
    .sort((a, b) => bySeniority(a.agent, b.agent))
    .map((root) => planPod(root, podColumns));
  const left = origin.x + WALL + CORRIDOR;
  const top = origin.y + WALL + HEADER_HEIGHT;
  const pods: Pod[] = [];
  // Shelves: pods fill a row left to right in seniority order, then wrap.
  let cursor = { x: left, y: top };
  let shelfHeight = 0;
  for (const plan of plans) {
    const podWidth = plan.columns * DESK_WIDTH;
    if (cursor.x > left && cursor.x + podWidth > left + inner) {
      cursor = { x: left, y: cursor.y + shelfHeight + GAP };
      shelfHeight = 0;
    }
    pods.push(placePod(plan, cursor, group.workspaceId));
    cursor = { x: cursor.x + podWidth + GAP, y: cursor.y };
    shelfHeight = Math.max(shelfHeight, plan.rows * DESK_HEIGHT);
  }
  const floorBottom = cursor.y + shelfHeight;
  const dormant = isDormant(group);
  const stripTop = floorBottom + GAP;
  const rows = dormant ? DORMANT_ROWS : ZONE_ROWS;
  const zones = dormant ? [] : furnish(left, stripTop, inner);
  const lounge: Lounge = {
    x: origin.x + WALL,
    y: stripTop,
    width: width - 2 * WALL,
    height: rows,
    walkway: { x: origin.x + WALL, y: stripTop + rows - 1, width: width - 2 * WALL, height: 1 },
    wall: zones.length > 0 ? { x: left, y: stripTop, width: inner, height: 1 } : null,
  };
  const agentCount = pods.reduce(
    (sum, pod) => sum + pod.teams.reduce((inPod, team) => inPod + team.desks.length, 0),
    0,
  );
  return {
    workspaceId: group.workspaceId,
    name: group.name,
    counts: group.counts,
    urgency: group.counts["needs-input"] > 0 ? 0 : group.counts.failed > 0 ? 1 : 2,
    dormant,
    x: origin.x,
    y: origin.y,
    width,
    height: lounge.y + lounge.height + WALL - origin.y,
    header: { x: origin.x + WALL, y: origin.y + WALL, width: width - 2 * WALL, height: HEADER_HEIGHT },
    corridorX: origin.x + WALL,
    door: { x: origin.x + WALL, y: top - 1 },
    pods,
    lounge,
    zones,
    agentCount,
  };
}

/** A workspace whose agents are all closed: nobody is in. */
export function isDormant(group: CrewGroup): boolean {
  return STATE_ORDER.every((state) => state === "closed" || group.counts[state] === 0);
}

function oldestRoot(group: CrewGroup): PaseoAgent | null {
  let oldest: PaseoAgent | null = null;
  for (const root of group.roots) {
    if (!oldest || bySeniority(root.agent, oldest) < 0) oldest = root.agent;
  }
  return oldest;
}

/**
 * Lays out the office for the groups `groupByWorkspace` returned. Rooms are
 * ordered by their oldest crew, not by urgency, so a room does not change
 * places when one of its agents starts needing you. The one state that moves a
 * room is its last agent closing: it joins the dormant rooms at the end.
 */
export function layoutOffice(groups: readonly CrewGroup[], options: OfficeOptions): Office {
  const cramped = options.width < MIN_ROOM_WIDTH;
  const width = Math.max(MIN_ROOM_WIDTH, Math.floor(options.width));
  const fits = Math.max(1, Math.floor((width + GAP) / (ROOM_TARGET_WIDTH + GAP)));
  const maxColumns = Math.max(1, Math.floor((width + GAP) / (MIN_ROOM_WIDTH + GAP)));
  const columns = Math.min(maxColumns, Math.max(1, Math.floor(options.roomColumns ?? fits)));
  const roomWidth = Math.floor((width - (columns - 1) * GAP) / columns);

  const ordered = [...groups].sort((a, b) => {
    // Rooms nobody is in go last, so that the rooms in use keep their places among themselves.
    const asleep = Number(isDormant(a)) - Number(isDormant(b));
    if (asleep !== 0) return asleep;
    const left = oldestRoot(a);
    const right = oldestRoot(b);
    if (left && right) return bySeniority(left, right) || a.workspaceId.localeCompare(b.workspaceId);
    return a.workspaceId.localeCompare(b.workspaceId);
  });

  const rooms: Room[] = [];
  const desks = new Map<string, Desk>();
  const roomOf = new Map<string, string>();
  let y = 0;
  let rowHeight = 0;
  ordered.forEach((group, index) => {
    const column = index % columns;
    if (column === 0 && index > 0) {
      y += rowHeight + GAP;
      rowHeight = 0;
    }
    const room = layoutRoom(group, { x: column * (roomWidth + GAP), y }, roomWidth);
    rowHeight = Math.max(rowHeight, room.height);
    rooms.push(room);
    for (const pod of room.pods) {
      for (const team of pod.teams) {
        for (const desk of team.desks) {
          desks.set(desk.agentId, desk);
          roomOf.set(desk.agentId, room.workspaceId);
        }
      }
    }
  });
  const visitors = new Map<string, Visitor>();
  ordered.forEach((group, index) => {
    const room = rooms[index] as Room;
    const guests: Array<{ agent: PaseoAgent; hostId: string }> = [];
    for (const root of group.roots) {
      const parentId = parentAgentId(root.agent);
      const parent = parentId ? options.agents?.get(parentId) : undefined;
      if (!parent || parent.archivedAt || desks.has(parent.id) || visitors.has(parent.id)) continue;
      if (guests.some((guest) => guest.agent.id === parent.id)) continue;
      guests.push({ agent: parent, hostId: root.agent.id });
    }
    guests.sort((a, b) => bySeniority(a.agent, b.agent));
    const walkway = room.lounge.walkway;
    const slots = Math.max(1, Math.floor((walkway.width - 1) / 2));
    guests.forEach((guest, slot) => {
      visitors.set(guest.agent.id, {
        agentId: guest.agent.id,
        hostId: guest.hostId,
        workspaceId: room.workspaceId,
        // On the walkway by the lounge, from the right wall inwards, every other tile.
        at: { x: walkway.x + walkway.width - 1 - (slot % slots) * 2, y: walkway.y },
      });
      roomOf.set(guest.agent.id, room.workspaceId);
    });
  });
  return { width, height: rooms.length > 0 ? y + rowHeight : 0, rooms, desks, roomOf, visitors, cramped };
}

export type Activity =
  /** At the desk, working. */
  | "typing"
  /** Standing by the desk, turned to the viewer, waiting on a permission. */
  | "asking"
  /** At the desk, stopped on an error. */
  | "stuck"
  /** Standing by the desk with finished work to show. */
  | "done"
  /** Recently idle, on a break: at the pantry, on the sofa, or waiting on the walkway. */
  | "wandering"
  /** Idle for a long while, asleep at the desk. */
  | "asleep"
  /** Closed: the desk is kept, nobody is at it. */
  | "away"
  /** A parent from a workspace the office does not show, standing in the lounge. */
  | "visiting";

export type Emote = "question" | "alert" | "check" | "zzz";

export interface Presence {
  agentId: string;
  state: CrewState;
  activity: Activity;
  /** Where the character belongs. */
  at: Point;
  /** The clear row `at` is reached by, when it is not at its desk. */
  aisleY: number;
  facing: "up" | "down" | "left" | "right";
  /** Whether a character is drawn at all. */
  visible: boolean;
  /** In its chair at the desk. */
  seated: boolean;
  /** Sitting somewhere else: a sofa, a beanbag. */
  lounging: boolean;
  /** Art pixels to raise the sprite so a sitter rests on the seat. */
  lift: number;
  carry: "cup" | null;
  /** Whether the monitor on its desk is on. */
  screenOn: boolean;
  emote: Emote | null;
  /** For someone waiting on the walkway: the tiles it may stroll. */
  range: Rect | null;
}

/** An idle agent takes a break this long after it last did something, then goes back to its desk to sleep. */
export const WANDER_MS = 15 * 60_000;
/** How long somebody on a break stays at one spot before choosing another: between this ... */
export const BREAK_DWELL_MIN_MS = 3 * 60_000;
/** ... and this much longer, a length that is each agent's own. */
export const BREAK_DWELL_SPREAD_MS = 3 * 60_000;

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  }
  // Mixed once more, so ids that differ in a letter do not make the same choices.
  result ^= result >>> 15;
  result = Math.imul(result, 0x2c1b3c6d);
  result ^= result >>> 12;
  return result >>> 0;
}

/**
 * Which stretch of its break an agent is in, and when that stretch began. Each
 * agent has its own dwell length and its own phase, so they neither all move
 * at once nor ever stand still for a whole break; within a stretch the answer
 * does not change.
 */
export function breakStretch(agentId: string, now: number): { index: number; startedAt: number } {
  const dwell = BREAK_DWELL_MIN_MS + (hash(`${agentId}/dwell`) % BREAK_DWELL_SPREAD_MS);
  const phase = hash(`${agentId}/phase`) % dwell;
  const index = Math.floor((now + phase) / dwell);
  return { index, startedAt: index * dwell - phase };
}

export interface Idler {
  agentId: string;
  /** When it went idle, epoch ms. */
  since: number;
}

/**
 * Where everybody on a break in one room is. For each stretch of its break an
 * agent has its own order of preference over the room's use points, and takes
 * the first that was free when the stretch began: whoever was already
 * somewhere keeps it. So no two share a tile, nobody is unseated by a
 * newcomer, and nobody moves except when their own stretch ends. When the use
 * points are all taken the rest wait on the walkway, one tile each, and when
 * that is full too they are left out: they stay at their desks.
 */
export function assignBreaks(room: Room, idlers: readonly Idler[], reserved: readonly Point[], now: number): Map<string, UseSpot> {
  const spots = room.zones.flatMap((zone) => zone.spots);
  const walkway: UseSpot[] = [];
  // The corridor's foot is kept clear: everybody comes in through it.
  for (let x = room.lounge.walkway.x + 1; x < room.lounge.walkway.x + room.lounge.walkway.width; x += 1) {
    walkway.push({ x, y: room.lounge.walkway.y, aisleY: room.lounge.walkway.y, pose: "stand", facing: "down", lift: 0, prop: null, zone: "walkway" });
  }
  const key = (spot: Point) => `${spot.x},${spot.y}`;
  const blocked = new Set(reserved.map(key));
  const people = [...idlers].sort((a, b) => a.agentId.localeCompare(b.agentId));

  /** When the stretch an agent was in at `time` began for it: not before it went idle. */
  const begun = (idler: Idler, time: number) => {
    const stretch = breakStretch(idler.agentId, time);
    return { index: stretch.index, at: Math.max(stretch.startedAt, idler.since) };
  };
  const known = new Map<string, UseSpot | null>();
  /** Where an agent was at `time`: the choice it made when that stretch began. */
  const placeAt = (idler: Idler, time: number): UseSpot | null => {
    const mine = begun(idler, time);
    const memo = `${idler.agentId}/${mine.index}`;
    const cached = known.get(memo);
    if (cached !== undefined) return cached;
    const taken = new Set(blocked);
    for (const other of people) {
      if (other === idler || other.since > mine.at) continue;
      const theirs = begun(other, mine.at);
      // Whoever began earlier was there first; a tie goes to the lower id.
      if (theirs.at > mine.at || (theirs.at === mine.at && other.agentId > idler.agentId)) continue;
      const place = placeAt(other, theirs.at === mine.at ? mine.at : mine.at - 1);
      if (place) taken.add(key(place));
    }
    const preference = (choices: readonly UseSpot[]) =>
      choices
        .map((spot, index) => ({ spot, rank: hash(`${idler.agentId}/${mine.index}/${index}`) }))
        .sort((a, b) => a.rank - b.rank)
        .map((entry) => entry.spot);
    const choice = [...preference(spots), ...preference(walkway)].find((spot) => !taken.has(key(spot))) ?? null;
    known.set(memo, choice);
    return choice;
  };

  const out = new Map<string, UseSpot>();
  for (const idler of people) {
    const place = placeAt(idler, now);
    if (place) out.set(idler.agentId, place);
  }
  return out;
}

/**
 * Where a character is and what it is doing. `breakSpot` is where an idle
 * agent's break takes it, from `assignBreaks`; without one it sleeps at its desk.
 */
export function presenceOf(
  agent: PaseoAgent,
  state: CrewState,
  desk: Desk,
  breakSpot: UseSpot | null,
  now: number,
): Presence {
  const base = {
    agentId: agent.id,
    state,
    visible: true,
    range: null,
    aisleY: desk.aisleY,
    lounging: false,
    lift: 0,
    carry: null,
  };
  switch (state) {
    case "working":
      return { ...base, activity: "typing", at: desk.seat, facing: "up", seated: true, screenOn: true, emote: null };
    case "needs-input":
      return { ...base, activity: "asking", at: desk.stand, facing: "down", seated: false, screenOn: true, emote: "question" };
    case "failed":
      return { ...base, activity: "stuck", at: desk.seat, facing: "down", seated: true, screenOn: true, emote: "alert" };
    case "ready":
      return { ...base, activity: "done", at: desk.stand, facing: "down", seated: false, screenOn: true, emote: "check" };
    case "closed":
      return { ...base, activity: "away", at: desk.seat, facing: "up", visible: false, seated: false, screenOn: false, emote: null };
    case "idle": {
      if (!breakSpot || !onBreak(agent, now)) {
        return { ...base, activity: "asleep", at: desk.seat, facing: "up", seated: true, screenOn: false, emote: "zzz" };
      }
      return {
        ...base,
        activity: "wandering",
        at: { x: breakSpot.x, y: breakSpot.y },
        aisleY: breakSpot.aisleY,
        facing: breakSpot.facing,
        seated: false,
        lounging: breakSpot.pose === "sit",
        lift: breakSpot.lift,
        // A cup for whoever stands about with nothing in front of them: at the table, or waiting on the walkway.
        carry: breakSpot.prop === "table" || breakSpot.zone === "walkway" ? "cup" : null,
        screenOn: false,
        emote: null,
      };
    }
  }
}

/** Whether an idle agent is still within its break; an unreadable timestamp counts as long ago. */
export function onBreak(agent: PaseoAgent, now: number): boolean {
  return now - Date.parse(activityAt(agent)) < WANDER_MS;
}

/** Presence for every agent seated in the office, and for its visitors. */
export function presences(
  office: Office,
  agents: ReadonlyMap<string, PaseoAgent>,
  stateOf: (agent: PaseoAgent) => CrewState,
  now: number,
): Map<string, Presence> {
  const states = new Map<string, CrewState>();
  const idlers = new Map<string, Idler[]>();
  for (const agentId of office.desks.keys()) {
    const agent = agents.get(agentId);
    if (!agent) continue;
    const state = stateOf(agent);
    states.set(agentId, state);
    if (state !== "idle" || !onBreak(agent, now)) continue;
    const roomId = office.roomOf.get(agentId) ?? "";
    idlers.set(roomId, [...(idlers.get(roomId) ?? []), { agentId, since: Date.parse(activityAt(agent)) }]);
  }
  const breaks = new Map<string, UseSpot>();
  for (const room of office.rooms) {
    const guests = [...office.visitors.values()].filter((visitor) => visitor.workspaceId === room.workspaceId);
    const assigned = assignBreaks(room, idlers.get(room.workspaceId) ?? [], guests.map((guest) => guest.at), now);
    for (const [agentId, spot] of assigned) breaks.set(agentId, spot);
  }
  const out = new Map<string, Presence>();
  for (const [agentId, desk] of office.desks) {
    const agent = agents.get(agentId);
    const state = states.get(agentId);
    if (!agent || !state) continue;
    out.set(agentId, presenceOf(agent, state, desk, breaks.get(agentId) ?? null, now));
  }
  for (const [agentId, visitor] of office.visitors) {
    const agent = agents.get(agentId);
    if (!agent) continue;
    const state = stateOf(agent);
    out.set(agentId, {
      agentId,
      state,
      activity: "visiting",
      at: visitor.at,
      aisleY: visitor.at.y,
      facing: "down",
      visible: true,
      seated: false,
      lounging: false,
      lift: 0,
      carry: null,
      screenOn: false,
      emote: state === "needs-input" ? "question" : state === "failed" ? "alert" : state === "ready" ? "check" : null,
      range: null,
    });
  }
  return out;
}
