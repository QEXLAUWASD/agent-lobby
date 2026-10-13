import type { PaseoAgent } from "@getpaseo/client";
import type { Exchange } from "./exchanges";
import { STATE_LABEL, displayTitle, matches, roleOf, type CrewNode, type CrewState } from "./model";
import type { Office, Point } from "./office-model";

/**
 * Everything the scene decides that is not drawing: how big a tile is, how a
 * character walks, where a message travels, who is dimmed. Pure and tested, so
 * the view only places what it is told.
 */

/** A tile is 16 art pixels; the scene draws it at a whole multiple. */
export const TILE = 16;
/** A character is one tile wide and one and a half tall, standing on the bottom of its tile. */
export const CHARACTER_HEIGHT = 1.5;
export const MIN_TOUCH = 44;

export interface SceneScale {
  scale: number;
  /** Pixels per tile. */
  tile: number;
  /** How many tiles fit across. */
  widthTiles: number;
}

/**
 * The largest whole scale that still leaves a sensible room: 3× needs 24 tiles
 * across, 2× needs 8 (two desk columns between the walls), otherwise 1×. A
 * phone or an Explorer pane lands on 2×, where a character is 32 by 48. A view
 * of many rooms caps the scale, to show more rooms rather than bigger pixels.
 */
export function sceneScale(widthPx: number, maxScale = 3): SceneScale {
  const width = Math.max(0, Math.floor(widthPx));
  for (const [scale, minTiles] of [
    [3, 24],
    [2, 8],
  ] as const) {
    const widthTiles = Math.floor(width / (TILE * scale));
    if (scale <= maxScale && widthTiles >= minTiles) return { scale, tile: TILE * scale, widthTiles };
  }
  return { scale: 1, tile: TILE, widthTiles: Math.floor(width / TILE) };
}

/** Padding that brings a `size` px target up to the 44 px minimum. */
export function touchSlop(size: number): number {
  return Math.max(0, Math.ceil((MIN_TOUCH - size) / 2));
}

export type SpriteRole = "overseer" | "nexus" | "meow" | "agent";

export function spriteRole(agent: PaseoAgent): SpriteRole {
  const role = roleOf(agent)?.toLowerCase();
  return role === "overseer" || role === "nexus" || role === "meow" ? role : "agent";
}

/** What a screen reader hears for a character: what the pixels say. */
export function characterLabel(
  agent: PaseoAgent,
  state: CrewState,
  saying?: string | null,
  visiting = false,
): string {
  const parts = [visiting ? "Visitor" : null, displayTitle(agent), roleOf(agent), STATE_LABEL[state]];
  if (saying) parts.push(saying);
  return parts.filter(Boolean).join(", ");
}

export type Heading = "up" | "down" | "left" | "right";

export interface Leg {
  from: Point;
  to: Point;
  heading: Heading;
  durationMs: number;
}

const MS_PER_TILE = 140;
const MAX_WALK_MS = 3_000;

/**
 * A walk as straight legs: down to the aisle row, along it, then to the
 * destination. `aisleY` is the row under the character's own desk, which no
 * furniture stands on. Legs of no length are dropped; a long walk is sped up to
 * finish within three seconds.
 */
export function walkLegs(from: Point, to: Point, aisleY: number): Leg[] {
  // One step sideways (out of the chair, to stand beside it) needs no detour.
  const beside = from.y === to.y && Math.abs(from.x - to.x) <= 1;
  const corners: Point[] = beside ? [from, to] : [from, { x: from.x, y: aisleY }, { x: to.x, y: aisleY }, to];
  const legs: Leg[] = [];
  for (let index = 1; index < corners.length; index += 1) {
    const start = corners[index - 1] as Point;
    const end = corners[index] as Point;
    const distance = Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
    if (distance === 0) continue;
    const heading: Heading = end.x > start.x ? "right" : end.x < start.x ? "left" : end.y > start.y ? "down" : "up";
    legs.push({ from: start, to: end, heading, durationMs: distance * MS_PER_TILE });
  }
  const total = legs.reduce((sum, leg) => sum + leg.durationMs, 0);
  if (total > MAX_WALK_MS) {
    for (const leg of legs) leg.durationMs = Math.round((leg.durationMs * MAX_WALK_MS) / total);
  }
  return legs;
}

/** The loop a wanderer walks: its home tile, then three others in its range, the same every time. */
export function wanderCircuit(agentId: string, home: Point, range: { x: number; y: number; width: number; height: number }): Point[] {
  let seed = 0;
  for (let index = 0; index < agentId.length; index += 1) seed = (Math.imul(seed, 31) + agentId.charCodeAt(index)) >>> 0;
  const stops: Point[] = [home];
  for (let step = 1; step <= 3; step += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const x = range.x + (seed % range.width);
    const y = range.y + ((seed >>> 16) % range.height);
    stops.push({ x, y });
  }
  return stops;
}

export interface MarkerPath {
  /** Tile coordinates of tile centres are `point + 0.5`; these are tile origins. */
  from: Point;
  to: Point;
  /** False when that end is not an agent seated in this office: the marker uses the room's door instead. */
  fromSeated: boolean;
  toSeated: boolean;
}

/**
 * Where a message travels. Between two agents in the office (seated, or
 * visiting) it goes from one to the other, also across rooms. When the sender is unknown or sits in a room this office does
 * not show, it comes in through the door of the recipient's room (the middle of
 * its top wall); when only the sender is here, it leaves through the sender's
 * door. With neither end here there is nothing to draw.
 */
export function markerPath(exchange: Pick<Exchange, "from" | "to">, office: Office): MarkerPath | null {
  const door = (agentId: string): Point | null => {
    const room = office.rooms.find((entry) => entry.workspaceId === office.roomOf.get(agentId));
    return room ? { x: room.x + Math.floor(room.width / 2), y: room.y } : null;
  };
  const spot = (agentId: string) => office.desks.get(agentId)?.seat ?? office.visitors.get(agentId)?.at ?? null;
  const to = spot(exchange.to);
  const from = exchange.from ? spot(exchange.from) : null;
  if (from && to) return { from, to, fromSeated: true, toSeated: true };
  if (to) {
    const entry = door(exchange.to);
    return entry ? { from: entry, to, fromSeated: false, toSeated: true } : null;
  }
  if (from && exchange.from) {
    const exit = door(exchange.from);
    return exit ? { from, to: exit, fromSeated: true, toSeated: false } : null;
  }
  return null;
}

export const MARKER_TRAVEL_MS = 1_200;

/** 0 at the sender, 1 at the recipient, where the marker rests until the exchange expires. */
export function markerProgress(sentAt: number, now: number): number {
  return Math.min(1, Math.max(0, (now - sentAt) / MARKER_TRAVEL_MS));
}

export interface Link {
  /** Centre of the line, in pixels. */
  cx: number;
  cy: number;
  length: number;
  /** Rotation of a horizontal bar of `length`, in degrees. */
  angle: number;
}

/** A straight line between two tile centres, as a rotated bar a View can draw. */
export function linkBetween(from: Point, to: Point, tile: number): Link {
  const ax = (from.x + 0.5) * tile;
  const ay = (from.y + 0.5) * tile;
  const bx = (to.x + 0.5) * tile;
  const by = (to.y + 0.5) * tile;
  return {
    cx: (ax + bx) / 2,
    cy: (ay + by) / 2,
    length: Math.hypot(bx - ax, by - ay),
    angle: (Math.atan2(by - ay, bx - ax) * 180) / Math.PI,
  };
}

export const BUBBLE_HEIGHT = 20;

/** A bubble's box in pixels: centred over the character's head, kept inside the office. */
export function bubbleBox(at: Point, text: string, tile: number, officeWidthPx: number): { left: number; top: number; width: number } {
  const width = Math.min(Math.max(40, Array.from(text).length * 6.5 + 16), Math.min(240, Math.max(40, officeWidthPx - 4)));
  const centre = (at.x + 0.5) * tile;
  const left = Math.min(Math.max(2, centre - width / 2), Math.max(2, officeWidthPx - width - 2));
  const top = Math.max(0, (at.y + 1 - CHARACTER_HEIGHT) * tile - BUBBLE_HEIGHT - 4);
  return { left, top, width };
}

/**
 * The agents a search and a state filter single out, or null when neither is
 * set. The office dims everyone else in place: filtering never moves a seat.
 */
export function highlighted(
  roots: readonly CrewNode[],
  filter: CrewState | "all",
  query: string,
  workspaceName: (agent: PaseoAgent) => string | null,
): ReadonlySet<string> | null {
  if (filter === "all" && !query.trim()) return null;
  const out = new Set<string>();
  const walk = (node: CrewNode) => {
    if ((filter === "all" || node.state === filter) && matches(node.agent, query, workspaceName(node.agent))) {
      out.add(node.agent.id);
    }
    for (const child of node.children) walk(child);
  };
  for (const root of roots) walk(root);
  return out;
}

/** Workspace ids of the rooms that intersect a vertical window, both in tiles. */
export function roomsInView(office: Office, top: number, bottom: number): string[] {
  return office.rooms
    .filter((room) => room.y < bottom && room.y + room.height > top)
    .map((room) => room.workspaceId);
}

/** Every node of a forest by agent id. */
export function indexNodes(roots: readonly CrewNode[]): Map<string, CrewNode> {
  const out = new Map<string, CrewNode>();
  const walk = (node: CrewNode) => {
    out.set(node.agent.id, node);
    for (const child of node.children) walk(child);
  };
  for (const root of roots) walk(root);
  return out;
}
