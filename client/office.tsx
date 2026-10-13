import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, ScrollView } from "@getpaseo/plugin/client/react-native";
import type { PaseoAgent } from "@getpaseo/client";
import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
  BUBBLE_HEIGHT,
  CHARACTER_HEIGHT,
  MARKER_TRAVEL_MS,
  bubbleBox,
  characterLabel,
  linkBetween,
  markerPath,
  markerProgress,
  roomsInView,
  spriteRole,
  touchSlop,
  walkLegs,
  wanderCircuit,
  type Heading,
} from "./scene-model";
import {
  ChairSprite,
  CharacterSprite,
  DeskSprite,
  EmoteSprite,
  MarkerSprite,
  RoomBackdrop,
  type CharacterPose,
} from "./sprites";
import { font, stateColor } from "./ui";

const FRAME_MS = 280;
const DIMMED = 0.28;

/** One interval for every animated sprite in the scene; it runs only while somebody is listening. */
const frames = (() => {
  let frame = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  const listeners = new Set<() => void>();
  return {
    read: () => frame,
    subscribe(listener: () => void) {
      listeners.add(listener);
      timer ??= setInterval(() => {
        frame = (frame + 1) % 1024;
        for (const notify of listeners) notify();
      }, FRAME_MS);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && timer) {
          clearInterval(timer);
          timer = null;
        }
      };
    },
  };
})();
const still = () => () => {};
const zero = () => 0;

/** The shared frame counter while `active`, otherwise a constant 0 and no subscription. */
function useFrame(active: boolean): number {
  return useSyncExternalStore(active ? frames.subscribe : still, active ? frames.read : zero);
}

const POSE: Record<Presence["activity"], CharacterPose> = {
  typing: "type",
  asking: "stand",
  stuck: "sit",
  done: "stand",
  wandering: "stand",
  asleep: "sleep",
  away: "sit",
  visiting: "stand",
};

interface CharacterProps {
  theme: PluginTheme;
  tile: number;
  agent: PaseoAgent;
  presence: Presence;
  /** The row the character walks along: the one under its own desk. */
  aisleY: number;
  saying: string | null;
  selected: boolean;
  dimmed: boolean;
  still: boolean;
  onPress: (agentId: string) => void;
}

/**
 * A character walks to wherever its presence puts it. The walk and the lounge
 * circuit run on the native driver; under reduced motion it is simply placed.
 */
const Character = memo(function Character({
  theme,
  tile,
  agent,
  presence,
  aisleY,
  saying,
  selected,
  dimmed,
  still: reduced,
  onPress,
}: CharacterProps) {
  const { at, activity, range } = presence;
  const position = useRef(new Animated.ValueXY({ x: at.x * tile, y: at.y * tile })).current;
  const last = useRef<{ at: Point; tile: number }>({ at, tile });
  const [walking, setWalking] = useState<Heading | null>(null);
  const wanders = activity === "wandering" && range !== null && !reduced;
  const visiting = activity === "visiting";
  // The presence object is rebuilt on every directory update; the walk must only restart when it really changed.
  const rangeRef = useRef(range);
  rangeRef.current = range;
  const rangeKey = range ? `${range.x},${range.y},${range.width},${range.height}` : "";

  useEffect(() => {
    const from = last.current;
    last.current = { at, tile };
    let cancelled = false;
    let running: Animated.CompositeAnimation | null = null;
    const moved = from.at.x !== at.x || from.at.y !== at.y;

    const wander = () => {
      const area = rangeRef.current;
      if (cancelled || !wanders || !area) return;
      const stops = wanderCircuit(agent.id, at, area);
      const steps: Animated.CompositeAnimation[] = [];
      stops.forEach((stop, index) => {
        const previous = stops[(index + stops.length - 1) % stops.length] as Point;
        const distance = Math.abs(stop.x - previous.x) + Math.abs(stop.y - previous.y);
        steps.push(
          Animated.timing(position, {
            toValue: { x: stop.x * tile, y: stop.y * tile },
            duration: Math.max(1, distance) * 420,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
          Animated.delay(1_600 + index * 500),
        );
      });
      // The circuit ends on the home tile, where it began.
      steps.push(steps.shift() as Animated.CompositeAnimation, steps.shift() as Animated.CompositeAnimation);
      running = Animated.loop(Animated.sequence(steps));
      running.start();
    };

    if (reduced || !moved || from.tile !== tile) {
      position.setValue({ x: at.x * tile, y: at.y * tile });
      setWalking(null);
      wander();
    } else {
      const legs = walkLegs(from.at, at, aisleY);
      const step = (index: number) => {
        if (cancelled) return;
        const leg = legs[index];
        if (!leg) {
          setWalking(null);
          wander();
          return;
        }
        setWalking(leg.heading);
        running = Animated.timing(position, {
          toValue: { x: leg.to.x * tile, y: leg.to.y * tile },
          duration: leg.durationMs,
          easing: Easing.linear,
          useNativeDriver: true,
        });
        running.start(({ finished }) => finished && step(index + 1));
      };
      step(0);
    }
    return () => {
      cancelled = true;
      running?.stop();
    };
    // `at` is read through its coordinates, `range` through its key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id, aisleY, at.x, at.y, position, rangeKey, reduced, tile, wanders]);

  const pose: CharacterPose = walking || wanders ? "walk" : POSE[activity];
  const animated = !reduced && (pose === "type" || pose === "walk");
  const frame = useFrame(animated);
  const emoteFrame = useFrame(!reduced && presence.emote !== null && walking === null);
  const height = tile * CHARACTER_HEIGHT;
  const slop = touchSlop(tile);
  return (
    <Animated.View
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: tile,
        height: tile,
        opacity: dimmed ? DIMMED : 1,
        zIndex: at.y,
        transform: position.getTranslateTransform(),
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={characterLabel(agent, presence.state, saying, visiting)}
        accessibilityState={{ selected }}
        hitSlop={{ left: slop, right: slop, top: slop + (height - tile), bottom: slop }}
        onPress={() => onPress(agent.id)}
        style={{ position: "absolute", left: 0, bottom: 0, width: tile, height }}
      >
        <CharacterSprite
          theme={theme}
          tile={tile}
          agentId={agent.id}
          role={spriteRole(agent)}
          pose={pose}
          heading={walking ?? presence.facing}
          frame={frame}
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
          <Text numberOfLines={1} style={{ color: theme.colors.foregroundMuted, fontSize: 8, lineHeight: 10 }}>
            visitor
          </Text>
        </View>
      ) : null}
      {presence.emote && walking === null ? (
        <View
          pointerEvents="none"
          style={{ position: "absolute", left: presence.seated ? (tile * 9) / 16 : 0, bottom: height - tile / 8 }}
        >
          <EmoteSprite theme={theme} tile={tile} kind={presence.emote} frame={emoteFrame} />
        </View>
      ) : null}
    </Animated.View>
  );
});

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
 * The desk cell is the large target: three tiles square, 48 px at the smallest
 * scale. It speaks for the agent only when no character is sitting there to do
 * so (closed, or away in the lounge), so a screen reader meets each agent once.
 */
const DeskCell = memo(function DeskCell({ theme, tile, node, desk, presence, selected, dimmed, onPress }: DeskProps) {
  const { agent, state } = node;
  const vacant = !presence?.visible;
  const elsewhere = presence?.activity === "wandering";
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
      <View pointerEvents="none" style={{ position: "absolute", left: tile, top: tile }}>
        <ChairSprite theme={theme} tile={tile} />
      </View>
      <View pointerEvents="none" style={{ position: "absolute", left: tile / 2, top: 0 }}>
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
        <Text
          numberOfLines={1}
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            textAlign: "center",
            color: theme.colors.foregroundMuted,
            fontSize: Math.min(font.xs, tile / 2),
          }}
        >
          {STATE_LABEL[state]}
        </Text>
      ) : null}
    </Pressable>
  );
});

const SpeechBubble = memo(function SpeechBubble({
  theme,
  tile,
  bubble,
  at,
  officeWidth,
  still: reduced,
}: {
  theme: PluginTheme;
  tile: number;
  bubble: Bubble;
  at: Point;
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
  const { colors } = theme;
  const tone =
    bubble.tone === "alert"
      ? colors.statusDanger
      : bubble.tone === "ask"
        ? colors.statusWarning
        : bubble.tone === "tell"
          ? colors.accent
          : colors.border;
  const text =
    bubble.tone === "tool" && bubble.status === "failed" ? `${bubble.text} failed` : bubble.text;
  // A tool bubble carries an icon; leave room for it.
  const box = bubbleBox(at, bubble.tone === "tool" ? `${text}   ` : text, tile, officeWidth);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: box.left,
        top: box.top,
        width: box.width,
        height: BUBBLE_HEIGHT,
        paddingHorizontal: 6,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: tone,
        backgroundColor: colors.surface0,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        opacity,
      }}
    >
      {bubble.tone === "tool" ? <Icon name="Wrench" size={10} color={colors.foregroundMuted} /> : null}
      <Text
        numberOfLines={1}
        style={{
          flexShrink: 1,
          color: bubble.tone === "tool" ? colors.foregroundMuted : colors.foreground,
          fontSize: font.xs,
        }}
      >
        {text}
      </Text>
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
        height: Math.max(16, Math.min(tile, 22)),
        paddingHorizontal: 6,
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
      <Text numberOfLines={1} style={{ flexShrink: 1, color: colors.foreground, fontSize: font.xs, fontWeight: "600" }}>
        {room.name}
      </Text>
      <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: font.xs }}>
        {summary(room.counts)}
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

  return (
    <ScrollView style={{ flex: 1 }} onScroll={onScroll} onLayout={onLayout} scrollEventThrottle={200}>
      {/* Only a width too narrow for one desk scrolls sideways. */}
      <ScrollView horizontal scrollEnabled={office.cramped} contentContainerStyle={{ width, height }}>
        <View style={{ width, height }}>
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
          {seated.map((desk) => {
            const node = nodes.get(desk.agentId);
            const presence = presences.get(desk.agentId);
            if (!node || !presence?.visible) return null;
            return (
              <Character
                key={desk.agentId}
                theme={theme}
                tile={tile}
                agent={node.agent}
                presence={presence}
                aisleY={desk.aisleY}
                saying={bubbles.get(desk.agentId)?.text ?? null}
                selected={selected === desk.agentId}
                dimmed={dim(desk.agentId)}
                still={reduced}
                onPress={onSelect}
              />
            );
          })}
          {[...office.visitors.values()].map((visitor) => {
            const agent = agents.get(visitor.agentId);
            const presence = presences.get(visitor.agentId);
            if (!agent || !presence) return null;
            return (
              <Character
                key={visitor.agentId}
                theme={theme}
                tile={tile}
                agent={agent}
                presence={presence}
                aisleY={visitor.at.y}
                saying={bubbles.get(visitor.agentId)?.text ?? null}
                selected={selected === visitor.agentId}
                dimmed={dim(visitor.agentId)}
                still={reduced}
                onPress={onSelect}
              />
            );
          })}
          {exchanges.map((exchange) => (
            <Marker key={exchange.id} theme={theme} tile={tile} exchange={exchange} office={office} still={reduced} />
          ))}
          {[...bubbles.values()].map((bubble) => {
            const presence = presences.get(bubble.agentId);
            if (!presence?.visible || dim(bubble.agentId)) return null;
            return (
              <SpeechBubble
                key={`${bubble.agentId}:${bubble.key}`}
                theme={theme}
                tile={tile}
                bubble={bubble}
                at={presence.at}
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
