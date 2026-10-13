import type { PluginTheme } from "@getpaseo/plugin";
import { memo } from "react";
import { View } from "react-native";
import type { Emote, LoungeSpotKind, Room } from "./office-model";
import { lookFor, officePalette, paletteColor, type Slot } from "./pixel/palette";
import { CHARACTER_HEIGHT, type Heading, type SpriteRole } from "./scene-model";

/**
 * The only module of the scene that draws. Everything here is a stand-in made
 * of plain Views until the sprite catalogue in `client/pixel/` lands; the scene
 * calls these components and nothing else, so binding the art means rewriting
 * the bodies below and not one line of `office.tsx`.
 *
 * Sizes are in tiles and every component fills the box the scene gives it:
 * a character 1 × 1.5, a desk 2 × 1, a chair 1 × 1, an emote 1 × 1,
 * lounge furniture 1 × 1, a message marker 1 × 1.
 */

export type CharacterPose =
  /** Seated, hands on the keyboard; two frames. */
  | "type"
  /** Seated, still. */
  | "sit"
  /** Seated, head down. */
  | "sleep"
  /** On its feet, still. */
  | "stand"
  /** Mid-step; two frames. */
  | "walk";

export type ScreenState = "on" | "off" | "error";

export interface SpriteProps {
  theme: PluginTheme;
  /** Pixels per tile. */
  tile: number;
}

function slot(theme: PluginTheme, name: Slot): string {
  const [red, green, blue, alpha] = paletteColor(officePalette(theme), name);
  return `rgba(${red},${green},${blue},${alpha / 255})`;
}

const ROLE_MARK: Record<SpriteRole, Slot | null> = {
  overseer: "hat",
  nexus: "headsetLight",
  meow: "earInner",
  agent: null,
};

export const CharacterSprite = memo(function CharacterSprite({
  theme,
  tile,
  agentId,
  role,
  pose,
  heading,
  frame,
}: SpriteProps & {
  /** Decides the look; the same id is always the same person. */
  agentId: string;
  role: SpriteRole;
  pose: CharacterPose;
  heading: Heading;
  /** 0 or 1; only `type` and `walk` have a second frame. */
  frame: number;
}) {
  const look = lookFor(agentId);
  const unit = tile / 16;
  const height = tile * CHARACTER_HEIGHT;
  const seated = pose === "type" || pose === "sit" || pose === "sleep";
  const bob = (pose === "type" || pose === "walk") && frame % 2 === 1 ? unit : 0;
  const mark = ROLE_MARK[role];
  const outline = slot(theme, "outline");
  return (
    <View style={{ width: tile, height }}>
      {/* head */}
      <View
        style={{
          position: "absolute",
          left: unit * 3,
          top: (pose === "sleep" ? unit * 5 : unit * 1) + bob,
          width: unit * 10,
          height: unit * 9,
          borderRadius: unit * 3,
          borderWidth: unit,
          borderColor: outline,
          backgroundColor: slot(theme, `skin${look.skin}` as Slot),
          overflow: "hidden",
        }}
      >
        <View
          style={{
            height: heading === "up" ? unit * 7 : unit * 3,
            backgroundColor: slot(theme, `hair${look.hair}` as Slot),
          }}
        />
      </View>
      {mark ? (
        <View
          style={{
            position: "absolute",
            left: unit * 4,
            top: (pose === "sleep" ? unit * 4 : 0) + bob,
            width: unit * 8,
            height: unit * 2,
            backgroundColor: slot(theme, mark),
            borderWidth: unit / 2,
            borderColor: outline,
          }}
        />
      ) : null}
      {/* body */}
      <View
        style={{
          position: "absolute",
          left: unit * 2,
          top: unit * 10 + bob,
          width: unit * 12,
          height: seated ? unit * 9 : unit * 8,
          borderRadius: unit * 2,
          borderWidth: unit,
          borderColor: outline,
          backgroundColor: slot(theme, `shirt${look.shirt}` as Slot),
        }}
      />
      {seated ? null : (
        <View
          style={{
            position: "absolute",
            left: unit * 4,
            top: unit * 18,
            width: unit * 8,
            height: unit * 6 - bob,
            borderWidth: unit,
            borderColor: outline,
            backgroundColor: slot(theme, `pants${look.pants}` as Slot),
          }}
        />
      )}
    </View>
  );
});

const EMOTE_SLOT: Record<Emote, Slot> = {
  question: "emoteAlert",
  alert: "emoteFail",
  check: "emoteReady",
  zzz: "emoteIdle",
};

export const EmoteSprite = memo(function EmoteSprite({
  theme,
  tile,
  kind,
  frame,
}: SpriteProps & { kind: Emote; frame: number }) {
  const unit = tile / 16;
  return (
    <View style={{ width: tile, height: tile, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          width: unit * 10,
          height: unit * 10,
          borderRadius: kind === "zzz" ? unit * 2 : unit * 5,
          marginTop: frame % 2 === 1 ? -unit * 2 : 0,
          borderWidth: unit,
          borderColor: slot(theme, "outline"),
          backgroundColor: slot(theme, EMOTE_SLOT[kind]),
        }}
      />
    </View>
  );
});

const SCREEN_SLOT: Record<ScreenState, Slot> = { on: "screenLit", off: "screenOff", error: "screenError" };

/** A desk two tiles wide with its monitor; the scene centres it on the desk cell's top row. */
export const DeskSprite = memo(function DeskSprite({ theme, tile, screen }: SpriteProps & { screen: ScreenState }) {
  const unit = tile / 16;
  return (
    <View style={{ width: tile * 2, height: tile }}>
      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: unit * 6,
          bottom: 0,
          borderRadius: unit * 2,
          borderWidth: unit,
          borderColor: slot(theme, "outline"),
          backgroundColor: slot(theme, "wood"),
        }}
      />
      <View
        style={{
          position: "absolute",
          left: unit * 9,
          top: 0,
          width: unit * 14,
          height: unit * 10,
          borderRadius: unit,
          borderWidth: unit,
          borderColor: slot(theme, "outline"),
          backgroundColor: slot(theme, SCREEN_SLOT[screen]),
        }}
      />
    </View>
  );
});

export const ChairSprite = memo(function ChairSprite({ theme, tile }: SpriteProps) {
  const unit = tile / 16;
  return (
    <View style={{ width: tile, height: tile }}>
      <View
        style={{
          position: "absolute",
          left: unit * 2,
          top: unit * 4,
          width: unit * 12,
          height: unit * 11,
          borderRadius: unit * 3,
          borderWidth: unit,
          borderColor: slot(theme, "outline"),
          backgroundColor: slot(theme, "fabric"),
        }}
      />
    </View>
  );
});

const LOUNGE_SLOT: Record<LoungeSpotKind, Slot> = { coffee: "coffee", sofa: "fabric", plant: "leaf", water: "glass" };

export const LoungeSprite = memo(function LoungeSprite({ theme, tile, kind }: SpriteProps & { kind: LoungeSpotKind }) {
  const unit = tile / 16;
  return (
    <View style={{ width: tile, height: tile }}>
      <View
        style={{
          position: "absolute",
          left: unit * 2,
          top: unit * 2,
          right: unit * 2,
          bottom: unit,
          borderRadius: kind === "plant" ? unit * 6 : unit * 2,
          borderWidth: unit,
          borderColor: slot(theme, "outline"),
          backgroundColor: slot(theme, LOUNGE_SLOT[kind]),
        }}
      />
    </View>
  );
});

/** The envelope that travels between two desks. */
export const MarkerSprite = memo(function MarkerSprite({ theme, tile }: SpriteProps) {
  const unit = tile / 16;
  return (
    <View style={{ width: tile, height: tile, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          width: unit * 12,
          height: unit * 8,
          borderRadius: unit,
          borderWidth: unit,
          borderColor: slot(theme, "outline"),
          backgroundColor: slot(theme, "white"),
        }}
      />
    </View>
  );
});

/**
 * A room's floor, walls and lounge strip, as one static layer. It must not cost
 * a node per tile: the stand-in is four Views, and the bound version is one
 * image per room (or a small repeating set) from the encoder.
 */
export const RoomBackdrop = memo(function RoomBackdrop({ theme, tile, room }: SpriteProps & { room: Room }) {
  const wall = Math.max(2, tile / 4);
  return (
    <View
      style={{
        position: "absolute",
        left: room.x * tile,
        top: room.y * tile,
        width: room.width * tile,
        height: room.height * tile,
        backgroundColor: slot(theme, "floor"),
        borderWidth: wall,
        borderColor: slot(theme, "wallShade"),
        borderRadius: wall,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          height: (room.header.y + room.header.height - room.y) * tile - wall,
          backgroundColor: slot(theme, "wall"),
          borderBottomWidth: Math.max(1, tile / 8),
          borderBottomColor: slot(theme, "wallTrim"),
        }}
      />
      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: (room.lounge.y - room.y) * tile - wall,
          bottom: 0,
          backgroundColor: slot(theme, "floorAlt"),
          borderTopWidth: Math.max(1, tile / 16),
          borderTopColor: slot(theme, "floorSeam"),
        }}
      />
    </View>
  );
});
