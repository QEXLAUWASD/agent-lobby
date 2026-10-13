import type { PluginTheme } from "@getpaseo/plugin";
import { memo, useMemo } from "react";
import { View } from "react-native";
import type { Emote, Room } from "./office-model";
import {
  Sprite,
  anchored,
  character,
  composite,
  emote,
  lookFor,
  officePalette,
  prop,
  tile as tileBitmap,
  TILE as ART_TILE,
  type CharacterPose as ArtPose,
  type EmoteId,
  type Bitmap,
  type Facing,
  type Layer,
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
  /** Pixels per tile; a whole multiple of the 16 px art tile. */
  tile: number;
}

const artScale = (tile: number) => Math.max(1, Math.round(tile / ART_TILE));

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
}: SpriteProps & {
  /** Decides the look; the same id is always the same person. */
  agentId: string;
  role: SpriteRole;
  pose: CharacterPose;
  heading: Heading;
  /** A running counter; it wraps at the pose's own frame count. 0 is the still. */
  frame: number;
}) {
  const scale = artScale(tile);
  const bitmap = character({ role, look: lookFor(agentId), ...pose(wanted, heading), frame });
  return (
    <View style={{ width: tile, height: tile * CHARACTER_HEIGHT }}>
      <Sprite
        sprite={bitmap}
        palette={officePalette(theme)}
        scale={scale}
        style={anchored(bitmap, scale, tile / 2, tile * CHARACTER_HEIGHT)}
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
 * A room's floor, walls, lounge strip and lounge furniture, flattened into one
 * image. The drawing depends on the room's shape and not on where it stands,
 * so rooms of the same shape share it.
 */
/** What a room's drawing depends on: its shape and furniture, not where it stands. */
function roomKey(room: Room): string {
  const headerBottom = room.header.y + room.header.height - room.y;
  const loungeTop = room.lounge.y - room.y;
  const spots = room.lounge.spots.map((spot) => `${spot.kind}@${spot.x - room.x},${spot.y - room.y}`).join(";");
  return `room:${room.width}x${room.height}:h${headerBottom}:l${loungeTop}:${spots}`;
}

function roomBitmap(room: Room, key: string): Bitmap {
  const headerBottom = room.header.y + room.header.height - room.y;
  const loungeTop = room.lounge.y - room.y;
  const layers: Layer[] = [];
  for (let y = 0; y < room.height; y += 1) {
    for (let x = 0; x < room.width; x += 1) {
      const edge = x === 0 || x === room.width - 1 || y === room.height - 1 || y === 0;
      const id = edge ? "wallCap" : y < headerBottom ? "wall" : y >= loungeTop ? "floorAlt" : "floor";
      layers.push({ bitmap: tileBitmap(id), x: x * ART_TILE, y: y * ART_TILE });
    }
  }
  for (const spot of room.lounge.spots) {
    // Furniture stands on the bottom centre of its tile.
    layers.push({
      bitmap: prop(spot.kind),
      x: (spot.x - room.x) * ART_TILE + ART_TILE / 2,
      y: (spot.y - room.y + 1) * ART_TILE,
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
