import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, ScrollView } from "@getpaseo/plugin/client/react-native";
import type { PaseoAgent } from "@getpaseo/client";
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  Animated,
  Easing,
  Pressable,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import type { Bubble, Exchange } from "./exchanges";
import { STATE_LABEL, summary, type CrewNode } from "./model";
import { DESK_WIDTH, type Desk, type Office, type Point, type Presence, type Room } from "./office-model";
import {
  CHARACTER_HEIGHT,
  MARKER_TRAVEL_MS,
  MIN_TOUCH,
  actFrame,
  bubbleTrack,
  characterLabel,
  linkBetween,
  markerPath,
  markerProgress,
  moveKind,
  roomsInView,
  spotOf,
  spriteRole,
  touchSlop,
  walkPath,
  type Heading,
  type Leg,
  type Place,
  type Spot,
  type Standing,
} from "./scene-model";
import {
  ArchiveSprite,
  BubbleSprite,
  BuildingBackdrop,
  ChairSprite,
  CharacterSprite,
  DeskSprite,
  EmoteSprite,
  MarkerSprite,
  RoomBackdrop,
  bubbleSize,
  snapToDevice,
  type CharacterPose,
} from "./sprites";
import { font, stateColor } from "./ui";

/** One tick is a walking step; typing and emotes change every other tick. */
const TICK_MS = 140;
const DIMMED = 0.28;
/**
 * Characters are stacked by the row they stand on. Messages and speech are not
 * part of the room: they sit above every character, emote and desk in it.
 */
const ABOVE_ROOM = 100_000;

/** One interval for every animated sprite in the scene; it runs only while somebody is listening. */
const ticker = (() => {
  let tick = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  const fast = new Set<() => void>();
  const slow = new Set<() => void>();
  const listen = (listeners: Set<() => void>) => (listener: () => void) => {
    listeners.add(listener);
    timer ??= setInterval(() => {
      tick = (tick + 1) % 4096;
      for (const notify of fast) notify();
      if (tick % 2 === 0) for (const notify of slow) notify();
    }, TICK_MS);
    return () => {
      listeners.delete(listener);
      if (fast.size + slow.size === 0 && timer) {
        clearInterval(timer);
        timer = null;
      }
    };
  };
  return { fast: listen(fast), slow: listen(slow), step: () => tick, beat: () => tick >> 1 };
})();
const still = () => () => {};
const zero = () => 0;

/** A frame counter from the shared timer: every tick for a walk, every other tick otherwise, 0 when off. */
function useFrame(pace: "walk" | "slow" | "off"): number {
  return useSyncExternalStore(
    pace === "walk" ? ticker.fast : pace === "slow" ? ticker.slow : still,
    pace === "walk" ? ticker.step : pace === "slow" ? ticker.beat : zero,
  );
}

const POSE: Record<Presence["activity"], CharacterPose> = {
  typing: "type",
  asking: "stand",
  stuck: "sit",
  done: "stand",
  wandering: "stand",
  gathering: "stand",
  asleep: "sleep",
  away: "sit",
  visiting: "stand",
};

type Places = Record<Spot, Place>;

/** A number that is the agent's own, even or odd by which way it faces, so that two at a table alternate. */
function seedOf(agentId: string, facing: Presence["facing"]): number {
  let sum = 0;
  for (let index = 0; index < agentId.length; index += 1) sum += agentId.charCodeAt(index);
  return (sum & ~1) + (facing === "right" ? 0 : 1);
}

interface CharacterProps {
  theme: PluginTheme;
  tile: number;
  agent: PaseoAgent;
  presence: Presence;
  /** Where each spot is for this character in the current layout. */
  places: Places;
  /** Changes when any of `places` does. */
  placesKey: string;
  /** Which break place the lounge spot is, in the room's own terms. */
  breakKey: string;
  /** Which desk is its own. It changes when a teammate ahead of it closes: then it walks one desk up. */
  seatKey: string;
  /** The free column it takes between rows. */
  corridorX: number;
  /** Its room was already drawn when it appeared: it walks in from the door. */
  enter: boolean;
  /** It is no longer in the office: it walks out and reports back. */
  leaving: boolean;
  /** The character's position in pixels, shared with whatever follows it. */
  position: Animated.ValueXY;
  visiting: boolean;
  saying: string | null;
  selected: boolean;
  dimmed: boolean;
  still: boolean;
  onPress: (agentId: string) => void;
  onGone: (agentId: string) => void;
  /** It is closed and has walked out of the door: its desk can go to somebody else. */
  onLeft: (agentId: string) => void;
}

/**
 * A character belongs at a spot: its chair, beside it, the lounge, or out of
 * the room. When its spot changes it walks there along the aisle and the
 * corridor; when the same spot is somewhere else the room moved, and it is
 * placed. Under reduced motion it is always placed. Positions run on the
 * animation driver, and the walk cycle on the scene's one timer, so a walking
 * character costs a render per step, not per frame.
 */
const Character = memo(
  function Character({
    theme,
    tile,
    agent,
    presence,
    places,
    placesKey,
    breakKey,
    seatKey,
    corridorX,
    enter,
    leaving,
    position,
    visiting,
    saying,
    selected,
    dimmed,
    still: reduced,
    onPress,
    onGone,
    onLeft,
  }: CharacterProps) {
    const { activity } = presence;
    const spot: Spot = leaving ? "out" : spotOf(activity);
    const [walking, setWalking] = useState<Heading | null>(null);
    const [row, setRow] = useState(places[spot].at.y);
    // Whether it has reached "out"; until then a leaving character is still drawn.
    const [gone, setGone] = useState(spot === "out");

    const latest = useRef({ places, onGone, onLeft });
    latest.current = { places, onGone, onLeft };
    // Only how it first appears matters; afterwards its room is always "already there".
    const entered = useRef(enter).current;
    const standing = useRef<Standing | null>(null);
    // Its door only moves when the room does. Its desk moving within the room, or its break place, is
    // somebody's doing (a teammate closed, its break moved on), and that is walked.
    const fixedKey = `${places.out.at.x},${places.out.at.y}`;
    const layout = useRef(fixedKey);
    // The last corner it reached, and the clear row it leaves that corner by.
    const where = useRef<Place>(places[spot]);
    // The leg it was on when it was interrupted, so it finishes the stride before turning.
    const stride = useRef<{ leg: Leg; endsAt: number } | null>(null);

    useEffect(() => {
      const here = latest.current.places;
      const place = here[spot];
      const next: Standing = {
        spot,
        key: spot === "lounge" ? breakKey : spot === "out" ? "out" : seatKey,
        at: place.at,
        tile,
      };
      const previous = standing.current;
      const kind = reduced ? "snap" : moveKind(previous, next, entered);
      const reflowed = layout.current !== fixedKey;
      standing.current = next;
      layout.current = fixedKey;
      let cancelled = false;
      let running: Animated.CompositeAnimation | null = null;

      const run = (legs: Leg[], done: () => void) => {
        const step = (index: number) => {
          if (cancelled) return;
          const leg = legs[index];
          if (!leg) {
            stride.current = null;
            done();
            return;
          }
          setWalking(leg.heading);
          setRow(leg.row);
          stride.current = { leg, endsAt: Date.now() + leg.durationMs };
          running = Animated.timing(position, {
            toValue: { x: leg.to.x * tile, y: leg.to.y * tile },
            duration: leg.durationMs,
            easing: Easing.linear,
            useNativeDriver: true,
          });
          running.start(({ finished }) => {
            if (!finished) return;
            where.current = { at: leg.to, aisleY: leg.to.y };
            step(index + 1);
          });
        };
        step(0);
      };

      const arrive = () => {
        where.current = place;
        setWalking(null);
        setRow(place.at.y);
        setGone(spot === "out");
        if (leaving) latest.current.onGone(agent.id);
        else if (spot === "out") latest.current.onLeft(agent.id);
      };

      if (kind === "snap") {
        stride.current = null;
        position.setValue({ x: place.at.x * tile, y: place.at.y * tile });
        arrive();
      } else {
        setGone(false);
        const legs: Leg[] = [];
        if (kind === "enter") {
          where.current = here.out;
          position.setValue({ x: here.out.at.x * tile, y: here.out.at.y * tile });
        } else if (reflowed && previous) {
          // The room moved while it changes spot: start from where its old spot is now.
          stride.current = null;
          where.current = here[previous.spot];
          position.setValue({ x: where.current.at.x * tile, y: where.current.at.y * tile });
        } else if (stride.current) {
          const { leg, endsAt } = stride.current;
          legs.push({ ...leg, durationMs: Math.max(60, endsAt - Date.now()) });
          // A stride that ends where it used to be (in its chair, on the sofa) leaves by that place's own way out.
          const old = previous ? here[previous.spot] : null;
          const back = old !== null && old.at.x === leg.to.x && old.at.y === leg.to.y;
          where.current = back ? old : { at: leg.to, aisleY: leg.to.y };
        }
        legs.push(...walkPath(where.current, place, corridorX));
        run(legs, arrive);
      }
      return () => {
        cancelled = true;
        running?.stop();
      };
      // `places` is read through `placesKey`.
    }, [agent.id, breakKey, corridorX, entered, leaving, placesKey, position, reduced, seatKey, spot, tile]);

    const act = walking ? null : presence.act;
    const pose: CharacterPose = walking
      ? "walk"
      : act && act !== "read"
        ? act
        : presence.lounging
          ? "sit"
          : POSE[activity];
    const beat = useFrame(reduced ? "off" : walking ? "walk" : pose === "type" || (act && act !== "read") ? "slow" : "off");
    // People across a table take turns: whoever faces right speaks on the even beats.
    const frame = act && !reduced ? actFrame(act, beat, seedOf(agent.id, presence.facing)) : beat;
    const emoteFrame = useFrame(!reduced && presence.emote !== null && walking === null ? "slow" : "off");
    const height = tile * CHARACTER_HEIGHT;
    // The pressable itself is at least 44 px each way: a visitor or a wanderer has no desk cell behind it.
    const padX = touchSlop(tile);
    const padTop = Math.max(0, MIN_TOUCH - height);
    const hidden = gone && walking === null;
    return (
      <Animated.View
        pointerEvents={hidden || leaving ? "none" : "auto"}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: tile,
          height: tile,
          opacity: hidden ? 0 : dimmed ? DIMMED : 1,
          zIndex: row,
          transform: position.getTranslateTransform(),
        }}
      >
        <Pressable
          accessible={!hidden && !leaving}
          accessibilityRole="button"
          accessibilityLabel={characterLabel(agent, presence.state, saying, visiting)}
          accessibilityState={{ selected }}
          onPress={() => onPress(agent.id)}
          style={{
            position: "absolute",
            left: -padX,
            bottom: 0,
            width: tile + 2 * padX,
            height: height + padTop,
            paddingHorizontal: padX,
            paddingTop: padTop,
          }}
        >
          <CharacterSprite
            theme={theme}
            tile={tile}
            agentId={agent.id}
            role={spriteRole(agent)}
            pose={pose}
            heading={walking ?? presence.facing}
            frame={frame}
            carry={presence.carry}
            lift={walking ? 0 : presence.lift}
          />
        </Pressable>
        {visiting ? (
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              top: tile,
              alignSelf: "center",
              paddingHorizontal: 3,
              borderRadius: 3,
              borderWidth: selected ? 1 : 0,
              borderColor: theme.colors.accent,
              backgroundColor: theme.colors.surface0,
            }}
          >
            <Text numberOfLines={1} style={{ color: theme.colors.foregroundMuted, fontSize: 7, lineHeight: 9 }}>
              visitor
            </Text>
          </View>
        ) : null}
        {presence.emote && walking === null && !hidden ? (
          <View
            pointerEvents="none"
            // At the desk the emote sits to the right of the head, clear of the monitor.
            style={{ position: "absolute", left: spot === "seat" || spot === "stand" ? (tile * 9) / 16 : 0, bottom: height - tile / 8 }}
          >
            <EmoteSprite theme={theme} tile={tile} kind={presence.emote} frame={emoteFrame} />
          </View>
        ) : null}
      </Animated.View>
    );
  },
  (before, after) =>
    before.theme === after.theme &&
    before.tile === after.tile &&
    before.agent === after.agent &&
    before.placesKey === after.placesKey &&
    before.breakKey === after.breakKey &&
    before.seatKey === after.seatKey &&
    before.corridorX === after.corridorX &&
    before.leaving === after.leaving &&
    before.position === after.position &&
    before.visiting === after.visiting &&
    before.saying === after.saying &&
    before.selected === after.selected &&
    before.dimmed === after.dimmed &&
    before.still === after.still &&
    before.onPress === after.onPress &&
    before.presence.activity === after.presence.activity &&
    before.presence.state === after.presence.state &&
    before.presence.emote === after.presence.emote &&
    before.presence.facing === after.presence.facing &&
    before.presence.lounging === after.presence.lounging &&
    before.presence.act === after.presence.act &&
    before.presence.carry === after.presence.carry &&
    before.presence.lift === after.presence.lift &&
    before.presence.seated === after.presence.seated,
);

interface DeskProps {
  theme: PluginTheme;
  tile: number;
  node: CrewNode;
  desk: Desk;
  presence: Presence | undefined;
  selected: boolean;
  dimmed: boolean;
  onPress: (agentId: string) => void;
}

/**
 * The desk cell is the large target: two tiles by three, 64 by 96 px at 2×. It speaks for the agent only when no character is sitting there to do
 * so (closed, or away in the lounge), so a screen reader meets each agent once.
 */
const DeskCell = memo(function DeskCell({ theme, tile, node, desk, presence, selected, dimmed, onPress }: DeskProps) {
  const { agent, state } = node;
  const vacant = !presence?.visible;
  const elsewhere = presence?.activity === "wandering" || presence?.activity === "gathering";
  const speaks = vacant || elsewhere;
  const screen = state === "failed" ? "error" : presence?.screenOn ? "on" : "off";
  const color = stateColor(theme, state);
  return (
    <Pressable
      accessible={speaks}
      accessibilityRole="button"
      accessibilityLabel={speaks ? `${vacant ? "Empty desk" : "Desk"}, ${characterLabel(agent, state)}` : undefined}
      accessibilityState={{ selected }}
      onPress={() => onPress(agent.id)}
      style={{
        position: "absolute",
        left: desk.cell.x * tile,
        top: desk.cell.y * tile,
        width: DESK_WIDTH * tile,
        height: (desk.aisleY - desk.cell.y + 1) * tile,
        borderRadius: tile / 4,
        borderWidth: selected ? Math.max(2, tile / 8) : 0,
        borderColor: theme.colors.accent,
        backgroundColor: selected ? theme.colors.surface2 : "transparent",
        opacity: dimmed ? DIMMED : vacant ? 0.6 : 1,
      }}
    >
      <View pointerEvents="none" style={{ position: "absolute", left: tile / 2, top: tile }}>
        <ChairSprite theme={theme} tile={tile} />
      </View>
      <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0 }}>
        <DeskSprite theme={theme} tile={tile} screen={screen} />
      </View>
      {/* The state in the theme's own status colour, for a reader who does not know the sprites yet. */}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: tile / 4,
          top: tile / 4,
          width: Math.max(4, tile / 4),
          height: Math.max(4, tile / 4),
          borderRadius: tile / 8,
          backgroundColor: state === "closed" ? "transparent" : color,
          borderWidth: state === "closed" ? 1 : 0,
          borderColor: color,
        }}
      />
      {vacant ? (
        // On the chair row, clear of the monitors of the desks in the next row.
        <View
          pointerEvents="none"
          style={{ position: "absolute", left: 0, right: 0, top: tile * 1.45, alignItems: "center" }}
        >
          <Text
            numberOfLines={1}
            style={{
              paddingHorizontal: 3,
              borderRadius: 3,
              overflow: "hidden",
              color: theme.colors.foregroundMuted,
              backgroundColor: theme.colors.surface0,
              fontSize: Math.min(font.xs, tile * 0.3),
              lineHeight: Math.min(font.xs, tile * 0.3) * 1.3,
            }}
          >
            {STATE_LABEL[state]}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
});

/**
 * A pixel bubble over its speaker. It follows the character as it walks and
 * stays inside the office; the tail points at where the speaker belongs.
 */
const SpeechBubble = memo(function SpeechBubble({
  theme,
  tile,
  bubble,
  position,
  home,
  officeWidth,
  still: reduced,
}: {
  theme: PluginTheme;
  tile: number;
  bubble: Bubble;
  /** The speaker's position, so the bubble walks with it. */
  position: Animated.ValueXY;
  /** The speaker's tile at rest, for the tail. */
  home: Point;
  officeWidth: number;
  still: boolean;
}) {
  const opacity = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) {
      opacity.setValue(1);
      return;
    }
    const fade = Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true });
    fade.start();
    return () => fade.stop();
  }, [opacity, reduced]);
  const art = useMemo(
    () => ({ text: bubble.text, tone: bubble.tone, ...(bubble.status ? { status: bubble.status } : {}) }),
    [bubble.text, bubble.tone, bubble.status],
  );
  const available = officeWidth - 4;
  const { width, height } = bubbleSize(art, available);
  const track = useMemo(() => bubbleTrack(width, height, tile, officeWidth), [width, height, tile, officeWidth]);
  // Where the speaker's head is under the bubble once the bubble has been kept inside the office.
  const centre = (home.x + 0.5) * tile;
  const left = Math.min(Math.max(2, centre - width / 2), Math.max(2, officeWidth - width - 2));
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width,
        height,
        opacity,
        zIndex: ABOVE_ROOM + 1,
        transform: [
          {
            translateX:
              track.x.fixed ??
              position.x.interpolate({ inputRange: track.x.inputRange, outputRange: track.x.outputRange, extrapolate: "clamp" }),
          },
          {
            translateY: position.y.interpolate({
              inputRange: track.y.inputRange,
              outputRange: track.y.outputRange,
              extrapolateLeft: "clamp",
              extrapolateRight: "extend",
            }),
          },
        ],
      }}
    >
      <BubbleSprite theme={theme} art={art} availablePx={available} tail={centre - left} />
    </Animated.View>
  );
});

/**
 * A message in flight. It leaves the sender's desk and rests on the recipient's
 * until the exchange expires; an end that is not in this office is the room's
 * door. Under reduced motion there is no travel: a line joins the two ends and
 * the envelope sits at the recipient.
 */
const Marker = memo(function Marker({
  theme,
  tile,
  exchange,
  office,
  still: reduced,
}: {
  theme: PluginTheme;
  tile: number;
  exchange: Exchange;
  office: Office;
  still: boolean;
}) {
  const path = useMemo(() => markerPath(exchange, office), [exchange, office]);
  const progress = useRef(new Animated.Value(reduced ? 1 : markerProgress(exchange.at, Date.now()))).current;
  useEffect(() => {
    if (reduced) {
      progress.setValue(1);
      return;
    }
    const start = markerProgress(exchange.at, Date.now());
    progress.setValue(start);
    const travel = Animated.timing(progress, {
      toValue: 1,
      duration: (1 - start) * MARKER_TRAVEL_MS,
      easing: Easing.inOut(Easing.quad),
      useNativeDriver: true,
    });
    travel.start();
    return () => travel.stop();
  }, [exchange.at, progress, reduced]);
  if (!path) return null;
  // The envelope rides above the heads, so it does not cover the face it lands on.
  const lift = (CHARACTER_HEIGHT - 0.25) * tile;
  const link = linkBetween(path.from, path.to, tile);
  return (
    <>
      {reduced ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: link.cx - link.length / 2,
            top: link.cy - 1,
            width: link.length,
            height: 2,
            borderRadius: 1,
            backgroundColor: theme.colors.accent,
            opacity: 0.5,
            zIndex: ABOVE_ROOM,
            transform: [{ rotate: `${link.angle}deg` }],
          }}
        />
      ) : null}
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          zIndex: ABOVE_ROOM,
          transform: [
            {
              translateX: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [path.from.x * tile, path.to.x * tile],
              }),
            },
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [path.from.y * tile - lift, path.to.y * tile - lift],
              }),
            },
          ],
        }}
      >
        <MarkerSprite theme={theme} tile={tile} />
      </Animated.View>
    </>
  );
});

const RoomSign = memo(function RoomSign({
  theme,
  tile,
  room,
  mail,
}: {
  theme: PluginTheme;
  tile: number;
  room: Room;
  mail: number;
}) {
  const { colors } = theme;
  const urgent = room.urgency === 0 ? colors.statusWarning : room.urgency === 1 ? colors.statusDanger : null;
  return (
    <View
      pointerEvents="none"
      accessible
      accessibilityRole="header"
      accessibilityLabel={`${room.name}, ${summary(room.counts)}`}
      style={{
        position: "absolute",
        left: room.header.x * tile + 2,
        top: room.header.y * tile,
        maxWidth: room.header.width * tile - 4,
        // The plate hangs on the upper row of the wall; monitors rise into the lower one.
        height: Math.max(14, Math.min(tile, 18)),
        paddingHorizontal: 4,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface0,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
      }}
    >
      {urgent ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: urgent }} /> : null}
      <Text numberOfLines={1} style={{ flexShrink: 1, color: colors.foreground, fontSize: 10, fontWeight: "600" }}>
        {room.name}
      </Text>
      <Text numberOfLines={1} style={{ flexShrink: 0, color: colors.foregroundMuted, fontSize: 10 }}>
        {room.agentCount}
      </Text>
      {mail > 0 ? (
        <>
          <Icon name="Mail" size={11} color={colors.accent} />
          <Text style={{ color: colors.accent, fontSize: font.xs }}>{mail}</Text>
        </>
      ) : null}
    </View>
  );
});

/**
 * A room's closed agents: they have no desk, only this plate on the top wall.
 * Pressing it lists them, with what can still be done with each.
 */
const ClosedFixture = memo(function ClosedFixture({
  theme,
  tile,
  room,
  matching,
  dimmed,
  onPress,
}: {
  theme: PluginTheme;
  tile: number;
  room: Room;
  /** How many of them a search or filter singles out; null when none is set. */
  matching: number | null;
  dimmed: boolean;
  onPress: (workspaceId: string) => void;
}) {
  const closed = room.closed;
  if (!closed) return null;
  const count = closed.ids.length;
  const found = matching !== null && matching > 0;
  // The cabinet rises a tile above its own. The pressable covers both and is padded out to 44 px each
  // way by layout, not by hitSlop, which the web does not promise to honour.
  const padX = touchSlop(tile);
  const padTop = Math.max(0, MIN_TOUCH - 2 * tile);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${count} closed ${count === 1 ? "agent" : "agents"} in ${room.name}${found ? `, ${matching} matching` : ""}. Opens the list.`}
      onPress={() => onPress(room.workspaceId)}
      style={{
        position: "absolute",
        left: closed.at.x * tile - padX,
        top: (closed.at.y - 1) * tile - padTop,
        width: tile + 2 * padX,
        height: 2 * tile + padTop,
        paddingHorizontal: padX,
        justifyContent: "flex-end",
        borderRadius: 3,
        borderWidth: found ? 1 : 0,
        borderColor: theme.colors.accent,
        opacity: dimmed ? DIMMED : 1,
        zIndex: closed.at.y,
      }}
    >
      <ArchiveSprite theme={theme} tile={tile} count={count} label={found ? `${matching}/${count}` : String(count)} />
    </Pressable>
  );
});

interface CastMember {
  agentId: string;
  agent: PaseoAgent;
  presence: Presence;
  places: Places;
  placesKey: string;
  breakKey: string;
  seatKey: string;
  corridorX: number;
  roomId: string;
  visiting: boolean;
}

/** More than this leaving at once is a change of view, not people leaving: they are dropped. */
const MAX_DEPARTING = 4;

export interface OfficeSceneProps {
  theme: PluginTheme;
  office: Office;
  /** Pixels per tile. */
  tile: number;
  nodes: ReadonlyMap<string, CrewNode>;
  /** The whole directory, for visitors, who are not in `nodes`. */
  agents: ReadonlyMap<string, PaseoAgent>;
  presences: ReadonlyMap<string, Presence>;
  bubbles: ReadonlyMap<string, Bubble>;
  exchanges: readonly Exchange[];
  selected: string | null;
  /** When set, everyone outside it is dimmed in place. */
  highlighted: ReadonlySet<string> | null;
  /** Reduced motion: no walking, no frames, no travelling markers. */
  still: boolean;
  onSelect: (agentId: string) => void;
  /** A closed agent has walked out of the door. */
  onLeft: (agentId: string) => void;
  /** The plate of a room's closed agents was pressed. */
  onOpenClosed: (workspaceId: string) => void;
  /** The width of the pane, in pixels: the office sits in the middle of it. */
  available: number;
  /** The rooms on screen, as the scroll position changes. */
  onRoomsInView?: (workspaceIds: readonly string[]) => void;
}

export function OfficeScene({
  theme,
  office,
  tile,
  nodes,
  agents,
  presences,
  bubbles,
  exchanges,
  selected,
  highlighted,
  still: reduced,
  onSelect,
  onLeft,
  onOpenClosed,
  available,
  onRoomsInView,
}: OfficeSceneProps) {
  const width = office.width * tile;
  const height = office.height * tile;
  const scroll = useRef({ top: 0, height: 0 });
  const reported = useRef("");
  const report = () => {
    if (!onRoomsInView || scroll.current.height === 0) return;
    const rooms = roomsInView(office, scroll.current.top / tile, (scroll.current.top + scroll.current.height) / tile);
    const key = rooms.join("|");
    if (key === reported.current) return;
    reported.current = key;
    onRoomsInView(rooms);
  };
  const reportRef = useRef(report);
  reportRef.current = report;
  useEffect(() => {
    reportRef.current();
  }, [office, tile]);
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scroll.current.top = event.nativeEvent.contentOffset.y;
    report();
  };
  const onLayout = (event: LayoutChangeEvent) => {
    scroll.current.height = event.nativeEvent.layout.height;
    report();
  };

  const mail = useMemo(() => {
    const counts = new Map<string, number>();
    for (const exchange of exchanges) {
      const room = office.roomOf.get(exchange.to) ?? (exchange.from ? office.roomOf.get(exchange.from) : undefined);
      if (room !== undefined) counts.set(room, (counts.get(room) ?? 0) + 1);
    }
    return counts;
  }, [exchanges, office]);

  const seated = useMemo(() => [...office.desks.values()], [office]);
  const dim = (agentId: string) => highlighted !== null && !highlighted.has(agentId);

  // Everyone who can be drawn as a character, with where each of their spots is in this layout.
  const cast = useMemo(() => {
    const rooms = new Map(office.rooms.map((room) => [room.workspaceId, room]));
    const out = new Map<string, CastMember>();
    const add = (agentId: string, agent: PaseoAgent, room: Room, desk: Desk | null, spot: Point | null) => {
      const presence = presences.get(agentId);
      if (!presence) return;
      // On a break it is wherever the break took it; otherwise this spot is only somewhere to have come from.
      const away =
        presence.activity === "wandering" || presence.activity === "gathering" || presence.activity === "visiting";
      const home = spot ?? (away ? presence.at : { x: room.lounge.walkway.x + 1, y: room.lounge.walkway.y });
      const lounge: Place = { at: home, aisleY: away ? presence.aisleY : home.y };
      const places: Places = {
        seat: desk ? { at: desk.seat, aisleY: desk.aisleY } : lounge,
        stand: desk ? { at: desk.stand, aisleY: desk.aisleY } : lounge,
        lounge,
        out: { at: room.door, aisleY: room.door.y },
      };
      const placesKey = (["seat", "stand", "lounge", "out"] as const)
        .map((name) => `${places[name].at.x},${places[name].at.y},${places[name].aisleY}`)
        .join("|");
      // The place's own name, which a reshape of the room does not change: only the agent moving on does.
      const breakKey = presence.placeId ?? "desk";
      out.set(agentId, { agentId, agent, presence, places, placesKey, breakKey, seatKey: desk?.seatKey ?? "visitor", corridorX: room.corridorX, roomId: room.workspaceId, visiting: desk === null });
    };
    for (const desk of seated) {
      const node = nodes.get(desk.agentId);
      const room = rooms.get(office.roomOf.get(desk.agentId) ?? "");
      if (node && room) add(desk.agentId, node.agent, room, desk, null);
    }
    for (const visitor of office.visitors.values()) {
      const agent = agents.get(visitor.agentId);
      const room = rooms.get(visitor.workspaceId);
      if (agent && room) add(visitor.agentId, agent, room, null, visitor.at);
    }
    return out;
  }, [office, seated, nodes, agents, presences]);

  // What was drawn last time: a character new to a room that was already there walks in,
  // and one that left a room that is still there walks out before it is dropped.
  const drawn = useRef<{ tile: number; rooms: Set<string>; cast: Map<string, CastMember> } | null>(null);
  const departing = useRef(new Map<string, CastMember>());
  const positions = useRef(new Map<string, Animated.ValueXY>());
  const [, redraw] = useState(0);
  const before = drawn.current;
  const sameScale = before?.tile === tile;
  const roomIds = new Set(office.rooms.map((room) => room.workspaceId));
  for (const id of cast.keys()) departing.current.delete(id);
  if (before && sameScale && !reduced) {
    for (const [id, member] of before.cast) {
      if (cast.has(id) || departing.current.has(id)) continue;
      if (roomIds.has(member.roomId) && departing.current.size < MAX_DEPARTING) departing.current.set(id, member);
    }
  } else departing.current.clear();
  const entering = (member: CastMember) => Boolean(before && sameScale && before.rooms.has(member.roomId) && !before.cast.has(member.agentId));
  const positionOf = (member: CastMember, enter: boolean) => {
    let position = positions.current.get(member.agentId);
    if (!position) {
      const start = enter && !reduced ? member.places.out.at : member.places[spotOf(member.presence.activity)].at;
      position = new Animated.ValueXY({ x: start.x * tile, y: start.y * tile });
      positions.current.set(member.agentId, position);
    }
    return position;
  };
  useEffect(() => {
    drawn.current = { tile, rooms: roomIds, cast };
    for (const id of positions.current.keys()) {
      if (!cast.has(id) && !departing.current.has(id)) positions.current.delete(id);
    }
  });
  const onGone = useCallback((agentId: string) => {
    if (departing.current.delete(agentId)) redraw((count) => count + 1);
  }, []);
  const everyone = [...cast.values(), ...departing.current.values()];

  return (
    <ScrollView style={{ flex: 1 }} onScroll={onScroll} onLayout={onLayout} scrollEventThrottle={200}>
      {/* Only a width too narrow for one desk scrolls sideways. */}
      <ScrollView
        horizontal
        scrollEnabled={office.cramped}
        contentContainerStyle={{ minWidth: "100%", height }}
      >
        {/* A pane is rarely a whole number of tiles wide: the office sits in the middle of what is left
            over, on a device pixel so that nothing in it softens. */}
        <View style={{ width, height, marginLeft: snapToDevice(Math.max(0, (available - width) / 2)) }}>
          {office.building && office.rooms.length > 1 ? (
            <BuildingBackdrop theme={theme} tile={tile} depth={office.building.depth} />
          ) : null}
          {office.rooms.map((room) => (
            <RoomBackdrop key={room.workspaceId} theme={theme} tile={tile} room={room} />
          ))}
          {office.rooms.map((room) => (
            <RoomSign
              key={room.workspaceId}
              theme={theme}
              tile={tile}
              room={room}
              mail={mail.get(room.workspaceId) ?? 0}
            />
          ))}
          {office.rooms.map((room) => {
            const matching = highlighted && room.closed ? room.closed.ids.filter((id) => highlighted.has(id)).length : null;
            return (
              <ClosedFixture
                key={`closed:${room.workspaceId}`}
                theme={theme}
                tile={tile}
                room={room}
                matching={matching}
                dimmed={highlighted !== null && matching === 0}
                onPress={onOpenClosed}
              />
            );
          })}
          {seated.map((desk) => {
            const node = nodes.get(desk.agentId);
            if (!node) return null;
            return (
              <DeskCell
                key={desk.agentId}
                theme={theme}
                tile={tile}
                node={node}
                desk={desk}
                presence={presences.get(desk.agentId)}
                selected={selected === desk.agentId}
                dimmed={dim(desk.agentId)}
                onPress={onSelect}
              />
            );
          })}
          {everyone.map((member) => {
            const leaving = !cast.has(member.agentId);
            const enter = !leaving && entering(member);
            return (
              <Character
                key={member.agentId}
                theme={theme}
                tile={tile}
                agent={member.agent}
                presence={member.presence}
                places={member.places}
                placesKey={member.placesKey}
                breakKey={member.breakKey}
                seatKey={member.seatKey}
                corridorX={member.corridorX}
                enter={enter}
                leaving={leaving}
                position={positionOf(member, enter)}
                visiting={member.visiting}
                saying={bubbles.get(member.agentId)?.label ?? null}
                selected={selected === member.agentId}
                dimmed={dim(member.agentId)}
                still={reduced}
                onPress={onSelect}
                onGone={onGone}
                onLeft={onLeft}
              />
            );
          })}
          {exchanges.map((exchange) => (
            <Marker key={exchange.id} theme={theme} tile={tile} exchange={exchange} office={office} still={reduced} />
          ))}
          {[...bubbles.values()].map((bubble) => {
            const member = cast.get(bubble.agentId);
            const position = positions.current.get(bubble.agentId);
            if (!member || !position || !member.presence.visible || dim(bubble.agentId)) return null;
            return (
              <SpeechBubble
                key={`${bubble.agentId}:${bubble.key}`}
                theme={theme}
                tile={tile}
                bubble={bubble}
                position={position}
                home={member.places[spotOf(member.presence.activity)].at}
                officeWidth={width}
                still={reduced}
              />
            );
          })}
        </View>
      </ScrollView>
    </ScrollView>
  );
}
