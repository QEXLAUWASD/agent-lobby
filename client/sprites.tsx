import type { PluginTheme } from "@getpaseo/plugin";
import { memo, useMemo } from "react";
import { View } from "react-native";
import type { Emote, Room } from "./office-model";
import {
  BUBBLE_HEIGHT,
  BUBBLE_MAX_WIDTH,
  Sprite,
  anchored,
  deviceCrispScale,
  deviceSnap,
  door,
  wallTopAt,
  bubble,
  bubbleWidth,
  character,
  composite,
  emote,
  lookFor,
  officePalette,
  prop,
  tile as tileBitmap,
  PROPS,
  TILE as ART_TILE,
  type CharacterPose as ArtPose,
  type EmoteId,
  type Bitmap,
  type Facing,
  type Layer,
  type TileId,
} from "./pixel";
import { CHARACTER_HEIGHT, type Heading, type SpriteRole } from "./scene-model";

/**
 * The only module of the scene that knows the sprite catalogue in
 * `client/pixel/`. The scene asks for a character, a desk, a room; this maps
 * the ask to a drawing and places its anchor.
 *
 * Sizes are in tiles and every component fills the box the scene gives it,
 * drawing past its top edge where the art is taller: a character 1 × 1.5,
 * a desk 2 × 1 with its monitor rising above, a chair 1 × 1, an emote 1 × 1,
 * a message marker 1 × 1.
 */

export type CharacterPose =
  /** Seated, hands on the keyboard. */
  | "type"
  /** Seated, still. */
  | "sit"
  /** Seated, head down. */
  | "sleep"
  /** On its feet, still. */
  | "stand"
  /** Mid-step. */
  | "walk";

export type ScreenState = "on" | "off" | "error";

export interface SpriteProps {
  theme: PluginTheme;
  /** Pixels per tile; from `crispTile`, so that art pixels land on device pixels. */
  tile: number;
}

/** Layout pixels per art pixel. The scene picks a tile size that keeps this crisp on the device. */
const artScale = (tile: number) => tile / ART_TILE;

/**
 * The tile size, in layout pixels, nearest to `scale` art-pixel sizes that the
 * device can draw without blur: one art pixel is a whole number of device pixels.
 */
export function crispTile(scale: number): number {
  return ART_TILE * deviceCrispScale(scale, "nearest");
}

/** A layout length moved to the nearest device pixel, for offsets that are not whole tiles. */
export function snapToDevice(value: number): number {
  return deviceSnap(value);
}

function pose(wanted: CharacterPose, heading: Heading): { pose: ArtPose; facing: Facing } {
  switch (wanted) {
    case "type":
      return { pose: "sit", facing: "up" };
    case "sit":
      return { pose: "sit", facing: heading === "up" ? "up" : "down" };
    case "sleep":
      return { pose: "sleep", facing: "up" };
    case "stand":
      return { pose: "idle", facing: heading };
    case "walk":
      return { pose: "walk", facing: heading };
  }
}

export const CharacterSprite = memo(function CharacterSprite({
  theme,
  tile,
  agentId,
  role,
  pose: wanted,
  heading,
  frame,
  carry = null,
  lift = 0,
}: SpriteProps & {
  /** Decides the look; the same id is always the same person. */
  agentId: string;
  role: SpriteRole;
  pose: CharacterPose;
  heading: Heading;
  /** A running counter; it wraps at the pose's own frame count. 0 is the still. */
  frame: number;
  carry?: "cup" | null;
  /** Art pixels to raise it, so a sitter rests on a seat. */
  lift?: number;
}) {
  const scale = artScale(tile);
  const bitmap = character({ role, look: lookFor(agentId), ...pose(wanted, heading), frame, carry });
  return (
    <View style={{ width: tile, height: tile * CHARACTER_HEIGHT }}>
      <Sprite
        sprite={bitmap}
        palette={officePalette(theme)}
        scale={scale}
        style={anchored(bitmap, scale, tile / 2, tile * CHARACTER_HEIGHT - lift * scale)}
      />
    </View>
  );
});

const EMOTE: Record<Emote, EmoteId> = { question: "question", alert: "fail", check: "check", zzz: "zzz" };

export const EmoteSprite = memo(function EmoteSprite({
  theme,
  tile,
  kind,
  frame,
}: SpriteProps & { kind: Emote; frame: number }) {
  const scale = artScale(tile);
  const bitmap = emote(EMOTE[kind], frame);
  return (
    <View style={{ width: tile, height: tile }}>
      <Sprite sprite={bitmap} palette={officePalette(theme)} scale={scale} style={anchored(bitmap, scale, tile / 2, tile)} />
    </View>
  );
});

const SCREEN = { on: "lit", off: "off", error: "error" } as const;

/** A desk two tiles wide; its monitor rises above the box. */
export const DeskSprite = memo(function DeskSprite({
  theme,
  tile,
  screen,
  frame = 0,
}: SpriteProps & { screen: ScreenState; frame?: number }) {
  const scale = artScale(tile);
  const bitmap = prop("desk", { screen: SCREEN[screen], frame });
  return (
    <View style={{ width: tile * 2, height: tile }}>
      <Sprite sprite={bitmap} palette={officePalette(theme)} scale={scale} style={anchored(bitmap, scale, tile, tile)} />
    </View>
  );
});

export const ChairSprite = memo(function ChairSprite({ theme, tile }: SpriteProps) {
  const scale = artScale(tile);
  const bitmap = prop("chair");
  return (
    <View style={{ width: tile, height: tile }}>
      <Sprite sprite={bitmap} palette={officePalette(theme)} scale={scale} style={anchored(bitmap, scale, tile / 2, tile)} />
    </View>
  );
});

/** The envelope that travels between two desks. */
export const MarkerSprite = memo(function MarkerSprite({ theme, tile }: SpriteProps) {
  const scale = artScale(tile);
  const bitmap = prop("envelope");
  return (
    <View style={{ width: tile, height: tile }}>
      <Sprite
        sprite={bitmap}
        palette={officePalette(theme)}
        scale={scale}
        style={anchored(bitmap, scale, tile / 2, tile / 2 + (bitmap.height * scale) / 2)}
      />
    </View>
  );
});

/**
 * A room's floor, walls, pantry and lounge with their furniture, flattened into one
 * image. The drawing depends on the room's shape and not on where it stands,
 * so rooms of the same shape share it.
 */
export interface BubbleArt {
  text: string;
  tone: "say" | "tool" | "tell" | "ask" | "alert";
  status?: "running" | "completed" | "failed" | "canceled";
}

/** The most a bubble may take of a width of `availablePx`, in art pixels. */
function bubbleMaxWidth(tile: number, availablePx: number): number {
  return Math.max(24, Math.min(BUBBLE_MAX_WIDTH, Math.floor(availablePx / artScale(tile))));
}

/** A bubble's size in layout pixels, without drawing it. The catalogue folds and cuts the text. */
export function bubbleSize(art: BubbleArt, tile: number, availablePx: number): { width: number; height: number } {
  const scale = artScale(tile);
  return {
    width: bubbleWidth({ ...art, maxWidth: bubbleMaxWidth(tile, availablePx) }) * scale,
    height: BUBBLE_HEIGHT * scale,
  };
}

/**
 * A speech bubble with its words drawn in: one image. `tail` is where the tail
 * points, in layout pixels from the bubble's left edge, so it still points at
 * the speaker when the bubble has been pushed in from an edge of the office.
 */
export const BubbleSprite = memo(function BubbleSprite({
  theme,
  tile,
  art,
  availablePx,
  tail,
}: SpriteProps & { art: BubbleArt; availablePx: number; tail: number }) {
  const scale = artScale(tile);
  const bitmap = bubble({ ...art, maxWidth: bubbleMaxWidth(tile, availablePx), tailX: Math.round(tail / scale) });
  return <Sprite sprite={bitmap} palette={officePalette(theme)} scale={scale} />;
});

/** What a room's drawing depends on: its shape and furniture, not where it stands. */
function roomKey(room: Room): string {
  const zones = room.zones
    .map((zone) => `${zone.kind}@${zone.x - room.x},${zone.y - room.y},${zone.width}x${zone.height}:${zone.props.map((item) => `${item.id}@${item.x - room.x},${item.y - room.y}`).join(",")}`)
    .join(";");
  const wall = room.lounge.wall ? `${room.lounge.wall.x - room.x},${room.lounge.wall.y - room.y}+${room.lounge.wall.width}` : "";
  const pods = room.pods
    .filter(isCrew)
    .map((pod) => pod.teams.map((team) => `${team.area.x - room.x},${team.area.y - room.y},${team.area.width}x${team.area.height}`).join("+"))
    .join("/");
  return `room2:${room.width}x${room.height}:f${room.floorTop - room.y}:d${room.door.x - room.x}:w${wall}:${zones}:p${pods}`;
}

const inRect = (x: number, y: number, rect: { x: number; y: number; width: number; height: number }) =>
  x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;

/** A crew, as against an agent on its own: more than one desk. */
const isCrew = (pod: Room["pods"][number]) => pod.teams.reduce((sum, team) => sum + team.desks.length, 0) > 1;

const POD_FLOORS: readonly TileId[] = ["pod0", "pod1", "pod2", "pod3"];

function roomBitmap(room: Room, key: string): Bitmap {
  const layers: Layer[] = [];
  const isWall = (x: number, y: number) =>
    inRect(x, y, room) && (x === room.x || x === room.x + room.width - 1 || y === room.y || y === room.y + room.height - 1);
  // Each team of a crew (a lead's people) has a floor of its own; an agent on its own sits on the plain floor.
  const teams = room.pods.filter(isCrew).flatMap((pod) => pod.teams);
  const floorAt = (x: number, y: number): TileId => {
    if (y < room.floorTop) return "wall";
    // The half wall the appliances, the shelves and the sofa stand against.
    if (room.lounge.wall && inRect(x, y, room.lounge.wall)) return "wall";
    const zone = room.zones.find((entry) => inRect(x, y, entry));
    if (zone) return zone.kind === "pantry" ? "kitchen" : "carpet";
    const team = teams.findIndex((entry) => inRect(x, y, entry.area));
    if (team >= 0) return POD_FLOORS[team % POD_FLOORS.length] as TileId;
    if (x === room.door.x && y === room.floorTop) return "doormat";
    return "floor";
  };
  for (let y = room.y; y < room.y + room.height; y += 1) {
    for (let x = room.x; x < room.x + room.width; x += 1) {
      const bitmap = isWall(x, y) ? wallTopAt(isWall, x, y) : tileBitmap(floorAt(x, y));
      layers.push({ bitmap, x: (x - room.x) * ART_TILE, y: (y - room.y) * ART_TILE });
    }
  }
  // The door stands in the wall's face, at the head of the corridor.
  layers.push({ bitmap: door(room.floorTop - room.y - 1), x: (room.door.x - room.x) * ART_TILE, y: ART_TILE });
  const furniture = room.zones.flatMap((zone) => zone.props);
  // A rug lies flat: straight after the floor, under everything else.
  for (const item of [...furniture.filter((entry) => entry.id === "rug"), ...furniture.filter((entry) => entry.id !== "rug")]) {
    // Furniture stands on the bottom centre of the tiles it covers.
    layers.push({
      bitmap: prop(item.id),
      x: (item.x - room.x) * ART_TILE + (PROPS[item.id].tilesWide * ART_TILE) / 2,
      y: (item.y - room.y + 1) * ART_TILE,
    });
  }
  // `composite` is the one cache of room drawings, bounded by the renderer.
  return composite(key, room.width * ART_TILE, room.height * ART_TILE, layers);
}

export const RoomBackdrop = memo(function RoomBackdrop({ theme, tile, room }: SpriteProps & { room: Room }) {
  // The layout is rebuilt on every directory update; the layers only when the room changes shape.
  const key = roomKey(room);
  const bitmap = useMemo(() => roomBitmap(room, key), [key]);
  return (
    <Sprite
      sprite={bitmap}
      palette={officePalette(theme)}
      scale={artScale(tile)}
      style={{ position: "absolute", left: room.x * tile, top: room.y * tile }}
    />
  );
});
