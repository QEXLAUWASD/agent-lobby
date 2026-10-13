import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Animated, Easing, Platform, StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from "react-native";
import { frameAt, glideAt, glidePieces, type Cycle, type Glide, type Px } from "./motion-model";

/**
 * Everything that moves. On the web React Native's `Animated` runs in
 * JavaScript and commits a render per display frame, so here a move is a CSS
 * transition and a pulse or a fade is a keyframe animation: one render when it
 * starts and none while it runs. Native keeps `Animated` on its native driver.
 * A loop of frames is the same everywhere: one shared beat.
 */
const CSS = Platform.OS === "web";

/** Web-only style properties, which React Native's types do not list. */
const web = (style: Record<string, unknown>) => style as ViewStyle;

/** `run` once what was just rendered is on screen, so that a transition has somewhere to start from. */
export function afterPaint(run: () => void): () => void {
  if (!CSS) {
    run();
    return () => {};
  }
  let second = 0;
  const first = requestAnimationFrame(() => {
    second = requestAnimationFrame(run);
  });
  return () => {
    cancelAnimationFrame(first);
    cancelAnimationFrame(second);
  };
}

/** Where something is going, in pixels, and how long it takes to get there. */
export interface Move extends Px {
  ms: number;
  easing?: "linear" | "inOutQuad";
  /** A negative delay starts the move that far in. */
  delayMs?: number;
}

const BEZIER = { linear: "linear", inOutQuad: "cubic-bezier(0.455, 0.03, 0.515, 0.955)" } as const;

/** A view translated to `move`, travelling there over `move.ms`. */
export function Mover({ move, style, children, ...rest }: ViewProps & { move: Move }) {
  if (CSS) {
    return (
      <View
        {...rest}
        style={[
          style,
          web({
            transform: [{ translateX: move.x }, { translateY: move.y }],
            transitionProperty: "transform",
            transitionDuration: `${Math.max(0, Math.round(move.ms))}ms`,
            transitionTimingFunction: BEZIER[move.easing ?? "linear"],
            transitionDelay: `${Math.round(move.delayMs ?? 0)}ms`,
          }),
        ]}
      >
        {children}
      </View>
    );
  }
  return (
    <NativeMover move={move} style={style} {...rest}>
      {children}
    </NativeMover>
  );
}

function NativeMover({ move, style, children, ...rest }: ViewProps & { move: Move }) {
  const position = useRef(new Animated.ValueXY({ x: move.x, y: move.y })).current;
  useEffect(() => {
    const skipped = Math.max(0, -(move.delayMs ?? 0));
    if (move.ms - skipped <= 0) {
      position.setValue({ x: move.x, y: move.y });
      return;
    }
    const travel = Animated.timing(position, {
      toValue: { x: move.x, y: move.y },
      duration: move.ms - skipped,
      easing: move.easing === "inOutQuad" ? Easing.inOut(Easing.quad) : Easing.linear,
      useNativeDriver: true,
    });
    travel.start();
    return () => travel.stop();
  }, [move, position]);
  return (
    <Animated.View {...rest} style={[style, { transform: position.getTranslateTransform() }]}>
      {children}
    </Animated.View>
  );
}

/** A position others can follow: the glide a character is on, or where it rests. */
export interface Motion {
  get(): Glide;
  set(glide: Glide): void;
  subscribe(listener: () => void): () => void;
}

export function createMotion(first: Glide): Motion {
  let glide = first;
  const listeners = new Set<() => void>();
  return {
    get: () => glide,
    set(next) {
      glide = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The move a motion is on. */
export function useMotion(motion: Motion): Move {
  const glide = useSyncExternalStore(motion.subscribe, motion.get);
  return useMemo(() => ({ x: glide.to.x, y: glide.to.y, ms: glide.ms }), [glide]);
}

/**
 * The move of something that follows a motion at `place(leader)`, where `place`
 * is a straight line between the knots. It renders once per piece of the
 * leader's glide: once per leg unless a knot is crossed on the way.
 */
export function useFollow(
  motion: Motion,
  place: (leader: Px) => Px,
  knotsX: readonly number[],
  knotsY: readonly number[],
): Move {
  const [move, setMove] = useState<Move>(() => ({ ...place(glideAt(motion.get(), Date.now())), ms: 0 }));
  const mounted = useRef(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const follow = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      const pieces = glidePieces(motion.get(), Date.now(), knotsX, knotsY);
      let index = 0;
      const next = () => {
        const piece = pieces[index];
        if (!piece) return;
        index += 1;
        const to = place(piece.to);
        setMove((current) =>
          current.x === to.x && current.y === to.y && current.ms === piece.ms ? current : { ...to, ms: piece.ms },
        );
        if (index < pieces.length) timer = setTimeout(next, piece.ms);
      };
      next();
    };
    const unsubscribe = motion.subscribe(follow);
    // It was just rendered where the leader is; if the leader is on its way, it joins after that is drawn.
    const moving = glideAt(motion.get(), Date.now()) !== motion.get().to;
    const cancel = !mounted.current && moving ? afterPaint(follow) : (follow(), () => {});
    mounted.current = true;
    return () => {
      unsubscribe();
      cancel();
      if (timer) clearTimeout(timer);
    };
  }, [motion, place, knotsX, knotsY]);
  return move;
}

const keyframes = StyleSheet.create({
  // A working agent breathes: down to a third and back, eased both ways.
  pulse: web({ animationKeyframes: { "0%": { opacity: 1 }, "50%": { opacity: 0.35 }, "100%": { opacity: 1 } } }),
  fadeIn: web({ animationKeyframes: { "0%": { opacity: 0 }, "100%": { opacity: 1 } } }),
});

export const PULSE_HALF_MS = 900;
export const PULSE_LOW = 0.35;

/** A view whose opacity breathes while `on`; at `rest` otherwise. */
export function Pulse({ on, rest = 1, style, children }: { on: boolean; rest?: number; style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  if (CSS) {
    return (
      <View
        style={[
          style,
          { opacity: rest },
          on
            ? [
                keyframes.pulse,
                web({
                  animationDuration: `${2 * PULSE_HALF_MS}ms`,
                  animationTimingFunction: "ease-in-out",
                  animationIterationCount: "infinite",
                }),
              ]
            : null,
        ]}
      >
        {children}
      </View>
    );
  }
  return (
    <NativePulse on={on} rest={rest} style={style}>
      {children}
    </NativePulse>
  );
}

function NativePulse({ on, rest, style, children }: { on: boolean; rest: number; style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  const opacity = useRef(new Animated.Value(rest)).current;
  useEffect(() => {
    if (!on) {
      opacity.setValue(rest);
      return;
    }
    opacity.setValue(1);
    const half = (toValue: number) =>
      Animated.timing(opacity, { toValue, duration: PULSE_HALF_MS, easing: Easing.inOut(Easing.ease), useNativeDriver: true });
    const loop = Animated.loop(Animated.sequence([half(PULSE_LOW), half(1)]));
    loop.start();
    return () => loop.stop();
  }, [on, opacity, rest]);
  return <Animated.View style={[style, { opacity }]}>{children}</Animated.View>;
}

/** A view that fades in over `ms` when it appears; under `still` it is simply there. */
export function FadeIn({ ms, still, style, children, ...rest }: ViewProps & { ms: number; still: boolean }) {
  if (CSS) {
    return (
      <View
        {...rest}
        style={[
          style,
          still ? null : [keyframes.fadeIn, web({ animationDuration: `${ms}ms`, animationTimingFunction: "ease-in-out" })],
        ]}
      >
        {children}
      </View>
    );
  }
  return (
    <NativeFadeIn ms={ms} still={still} style={style} {...rest}>
      {children}
    </NativeFadeIn>
  );
}

function NativeFadeIn({ ms, still, style, children, ...rest }: ViewProps & { ms: number; still: boolean }) {
  const opacity = useRef(new Animated.Value(still ? 1 : 0)).current;
  useEffect(() => {
    if (still) {
      opacity.setValue(1);
      return;
    }
    const fade = Animated.timing(opacity, { toValue: 1, duration: ms, useNativeDriver: true });
    fade.start();
    return () => fade.stop();
  }, [ms, opacity, still]);
  return (
    <Animated.View {...rest} style={[style, { opacity }]}>
      {children}
    </Animated.View>
  );
}

/** One timer for every frame loop that the platform cannot run itself; it stops when nobody listens. */
const beats = new Map<number, { listeners: Set<() => void>; timer: ReturnType<typeof setInterval> }>();
function onBeat(beatMs: number, listener: () => void): () => void {
  let beat = beats.get(beatMs);
  if (!beat) {
    const listeners = new Set<() => void>();
    beat = { listeners, timer: setInterval(() => listeners.forEach((notify) => notify()), beatMs) };
    beats.set(beatMs, beat);
  }
  beat.listeners.add(listener);
  return () => {
    beat.listeners.delete(listener);
    if (beat.listeners.size === 0) {
      clearInterval(beat.timer);
      beats.delete(beatMs);
    }
  };
}

const never = () => () => {};

/**
 * A loop of frames. `render` draws one frame; every frame of the cycle stays
 * mounted and one shared beat says which of them shows, so a beat costs two
 * style writes for whoever's frame changed and nothing for anybody else. The
 * frames of a cycle take turns on the one clock: everybody typing types in
 * step. With `still`, or with a cycle of one frame, only its first frame is
 * drawn and nothing runs.
 *
 * Not a stepped CSS animation: a running animation makes the compositor tick
 * on every display frame, which for thirty small loops measured about twice
 * the cost of this beat (perf/after, P4 against P4b).
 */
export function Frames({
  cycle,
  still,
  render,
}: {
  cycle: Cycle;
  still: boolean;
  render: (frame: number) => ReactNode;
}) {
  const first = cycle.frames[0] ?? 0;
  const key = `${cycle.beatMs}:${cycle.frames.join("")}`;
  // Keyed by content: a caller may build an equal cycle on every render.
  const frames = useMemo(() => [...new Set(cycle.frames)], [key]);
  const animated = !still && frames.length > 1;
  const subscribe = useMemo(
    () => (animated ? (listener: () => void) => onBeat(cycle.beatMs, listener) : never),
    [animated, cycle.beatMs],
  );
  // The frame, not the beat: a loop that holds a frame for many beats is drawn once for all of them.
  const frame = useSyncExternalStore(subscribe, () => (animated ? frameAt(cycle, Date.now()) : first));
  if (!animated) return <>{render(first)}</>;
  return (
    <View>
      {frames.map((each, index) => (
        <View key={each} style={[index === 0 ? null : StyleSheet.absoluteFill, { opacity: each === frame ? 1 : 0 }]}>
          {render(each)}
        </View>
      ))}
    </View>
  );
}
