import type { PaseoAgent } from "@getpaseo/client";
import { activityAt, parentAgentId, roleOf, type CrewGroup, type CrewNode, type CrewState } from "./model";

/**
 * The office, in tiles. A room per workspace, a pod per crew tree, a desk per
 * agent, a lounge along the bottom wall of each room.
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

/** One desk cell: the desk on its top row, the chair under it, an aisle tile below. */
export const DESK_WIDTH = 3;
export const DESK_HEIGHT = 3;
/** Most desks in one row of a pod, however wide the room is. */
export const MAX_POD_COLUMNS = 6;
const WALL = 1;
const GAP = 1;
const HEADER_HEIGHT = 2;
const LOUNGE_HEIGHT = 3;
/** The narrowest room that still holds one desk between its walls. */
export const MIN_ROOM_WIDTH = DESK_WIDTH + 2 * WALL;
/** On a wide surface rooms sit side by side, each about this wide. */
export const ROOM_TARGET_WIDTH = 44;

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
  /** Where the character stands when it has stepped away from the keyboard. */
  stand: Point;
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

export type LoungeSpotKind = "coffee" | "sofa" | "plant" | "water";

export interface Lounge extends Rect {
  /** Furniture along the wall, left to right. */
  spots: Array<Point & { kind: LoungeSpotKind }>;
}

export interface Room extends Rect {
  workspaceId: string;
  name: string;
  counts: Record<CrewState, number>;
  /** 0 needs you, 1 failed, 2 neither. Rooms are not reordered by it; a view may badge or jump. */
  urgency: 0 | 1 | 2;
  /** The strip under the top wall where a view writes the room name. */
  header: Rect;
  pods: Pod[];
  lounge: Lounge;
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
        stand: { x: cell.x + 1, y: cell.y + 2 },
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

const LOUNGE_FURNITURE: readonly LoungeSpotKind[] = ["coffee", "sofa", "plant", "water"];

function furnish(area: Rect): Lounge {
  // One piece about every eight tiles, against the bottom wall, the same for a given width.
  const count = Math.max(1, Math.min(LOUNGE_FURNITURE.length * 2, Math.floor(area.width / 8)));
  const spots = Array.from({ length: count }, (_, index) => ({
    kind: LOUNGE_FURNITURE[index % LOUNGE_FURNITURE.length] as LoungeSpotKind,
    x: area.x + Math.floor(((index + 0.5) * area.width) / count),
    y: area.y + area.height - 1,
  }));
  return { ...area, spots };
}

function layoutRoom(group: CrewGroup, origin: Point, width: number): Room {
  // Desk cells stand against the side walls: a desk is narrower than its cell, which is margin enough.
  const inner = width - 2 * WALL;
  const podColumns = Math.max(1, Math.min(MAX_POD_COLUMNS, Math.floor(inner / DESK_WIDTH)));
  const plans = [...group.roots]
    .sort((a, b) => bySeniority(a.agent, b.agent))
    .map((root) => planPod(root, podColumns));
  const left = origin.x + WALL;
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
  const lounge = furnish({ x: origin.x + WALL, y: floorBottom + GAP, width: width - 2 * WALL, height: LOUNGE_HEIGHT });
  const agentCount = pods.reduce(
    (sum, pod) => sum + pod.teams.reduce((inPod, team) => inPod + team.desks.length, 0),
    0,
  );
  return {
    workspaceId: group.workspaceId,
    name: group.name,
    counts: group.counts,
    urgency: group.counts["needs-input"] > 0 ? 0 : group.counts.failed > 0 ? 1 : 2,
    x: origin.x,
    y: origin.y,
    width,
    height: lounge.y + lounge.height + WALL - origin.y,
    header: { x: origin.x + WALL, y: origin.y + WALL, width: width - 2 * WALL, height: HEADER_HEIGHT },
    pods,
    lounge,
    agentCount,
  };
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
 * places when one of its agents starts needing you.
 */
export function layoutOffice(groups: readonly CrewGroup[], options: OfficeOptions): Office {
  const cramped = options.width < MIN_ROOM_WIDTH;
  const width = Math.max(MIN_ROOM_WIDTH, Math.floor(options.width));
  const fits = Math.max(1, Math.floor((width + GAP) / (ROOM_TARGET_WIDTH + GAP)));
  const maxColumns = Math.max(1, Math.floor((width + GAP) / (MIN_ROOM_WIDTH + GAP)));
  const columns = Math.min(maxColumns, Math.max(1, Math.floor(options.roomColumns ?? fits)));
  const roomWidth = Math.floor((width - (columns - 1) * GAP) / columns);

  const ordered = [...groups].sort((a, b) => {
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
    const slots = Math.max(1, Math.floor((room.lounge.width - 2) / 2));
    guests.forEach((guest, slot) => {
      visitors.set(guest.agent.id, {
        agentId: guest.agent.id,
        hostId: guest.hostId,
        workspaceId: room.workspaceId,
        // Along the top row of the lounge, from the left, every other tile.
        at: { x: room.lounge.x + 1 + (slot % slots) * 2, y: room.lounge.y },
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
  /** Recently idle, walking the lounge. */
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
  /** Where the character is; for `wandering`, the tile it keeps returning to. */
  at: Point;
  facing: "up" | "down";
  /** Whether a character is drawn at all. */
  visible: boolean;
  seated: boolean;
  /** Whether the monitor on its desk is on. */
  screenOn: boolean;
  emote: Emote | null;
  /** For `wandering`: the tiles it may walk. */
  range: Rect | null;
}

/** An idle agent wanders this long after it last did something, then goes back to its desk to sleep. */
export const WANDER_MS = 15 * 60_000;

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  }
  return result >>> 0;
}

/**
 * Where a character is and what it is doing. The lounge tile depends only on
 * the agent's id and the lounge, never on who else is idle, so nobody is moved
 * by somebody else; two wanderers may share a home tile.
 */
export function presenceOf(
  agent: PaseoAgent,
  state: CrewState,
  desk: Desk,
  lounge: Lounge | null,
  now: number,
): Presence {
  const base = { agentId: agent.id, state, visible: true, range: null };
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
      const quietFor = now - Date.parse(activityAt(agent));
      // An unreadable timestamp counts as long ago.
      if (!lounge || !(quietFor < WANDER_MS)) {
        return { ...base, activity: "asleep", at: desk.seat, facing: "up", seated: true, screenOn: false, emote: "zzz" };
      }
      // The bottom lounge row holds the furniture; characters keep to the rows above it.
      const range = { x: lounge.x + 1, y: lounge.y, width: Math.max(1, lounge.width - 2), height: Math.max(1, lounge.height - 1) };
      const seed = hash(agent.id);
      const at = { x: range.x + (seed % range.width), y: range.y + ((seed >>> 16) % range.height) };
      return { ...base, activity: "wandering", at, facing: "down", seated: false, screenOn: false, emote: null, range };
    }
  }
}

/** Presence for every agent seated in the office. */
export function presences(
  office: Office,
  agents: ReadonlyMap<string, PaseoAgent>,
  stateOf: (agent: PaseoAgent) => CrewState,
  now: number,
): Map<string, Presence> {
  const lounges = new Map(office.rooms.map((room) => [room.workspaceId, room.lounge]));
  const out = new Map<string, Presence>();
  for (const [agentId, desk] of office.desks) {
    const agent = agents.get(agentId);
    if (!agent) continue;
    const lounge = lounges.get(office.roomOf.get(agentId) ?? "") ?? null;
    out.set(agentId, presenceOf(agent, stateOf(agent), desk, lounge, now));
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
      facing: "down",
      visible: true,
      seated: false,
      screenOn: false,
      emote: state === "needs-input" ? "question" : state === "failed" ? "alert" : state === "ready" ? "check" : null,
      range: null,
    });
  }
  return out;
}
