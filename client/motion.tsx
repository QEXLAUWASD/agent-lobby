import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Animated, Easing, Platform, StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from "react-native";
import { cycleSteps, frameAt, glideAt, glidePieces, type Cycle, type Glide, type Px } from "./motion-model";

/**
 * Everything that moves. On the web React Native's `Animated` runs in
 * JavaScript and commits a render per display frame, so here a move is a CSS
 * transition and a pulse or a fade is a keyframe animation: one render when it
 * starts and none while it runs, and a loop of frames is a strip slid by a
 * stepped animation. Native keeps `Animated` on its native driver and one
 * shared timer for frames.
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

/** One timer per beat length for the frame loops the platform cannot run itself; it stops when nobody listens. */
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

/** True under a pane that is not on screen: every loop below it stands still. */
export const MotionPaused = createContext(false);

/** One keyframe per change of frame: the strip is slid to that frame and held there until the next. */
const slides = new Map<string, ViewStyle>();
function slideFor(count: number, cycle: Cycle): ViewStyle {
  const key = `${count}|${cycle.frames.join(",")}`;
  let style = slides.get(key);
  if (!style) {
    // As CSS text: keyframes are not put through the style preprocessor, so a transform array would be dropped.
    const at = (frame: number) => ({ transform: `translateX(${(-100 * frame) / count}%)` });
    const steps: Record<string, unknown> = {};
    for (const step of cycleSteps(cycle)) steps[`${Math.round(1e4 * step.at) / 100}%`] = at(step.frame);
    steps["100%"] = at(cycle.frames[cycle.frames.length - 1] ?? 0);
    style = StyleSheet.create({ strip: web({ animationKeyframes: steps }) }).strip;
    slides.set(key, style);
  }
  return style;
}

/**
 * A loop of frames played from a strip: `children` is one image holding
 * `count` frames side by side, each `width` by `height`, behind a window one
 * frame wide. `cycle` says which frame shows on each beat. Every loop runs on
 * the one clock, so equal cycles are in step wherever they were started.
 *
 * On the web the strip is slid by a stepped CSS animation: no timer, no render
 * and no style written while it plays; `paused` holds it where it is. Elsewhere
 * one shared timer per beat length moves it. The caller draws a still instead
 * when nothing should move.
 */
export function Strip({
  count,
  width,
  height,
  cycle,
  paused = false,
  style,
  children,
}: {
  count: number;
  width: number;
  height: number;
  cycle: Cycle;
  paused?: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const held = useContext(MotionPaused) || paused;
  const key = `${cycle.beatMs}:${cycle.frames.join(",")}`;
  // How far into its loop the clock is when the animation is started; keyed by content, as a caller may build an equal cycle anew.
  const elapsed = useMemo(() => Date.now() % (cycle.frames.length * cycle.beatMs), [key]);
  const subscribe = useMemo(
    () => (!CSS && !held ? (listener: () => void) => onBeat(cycle.beatMs, listener) : never),
    [held, cycle.beatMs],
  );
  const frame = useSyncExternalStore(subscribe, () => (CSS ? 0 : frameAt(cycle, Date.now())));
  return (
    <View style={[style, { width, height, overflow: "hidden" }]}>
      <View
        key={key}
        style={[
          { width: count * width, height },
          CSS
            ? [
                slideFor(count, cycle),
                web({
                  animationDuration: `${cycle.frames.length * cycle.beatMs}ms`,
                  animationDelay: `${-elapsed}ms`,
                  animationTimingFunction: "step-end",
                  animationIterationCount: "infinite",
                  animationPlayState: held ? "paused" : "running",
                }),
              ]
            : { transform: [{ translateX: -frame * width }] },
        ]}
      >
        {children}
      </View>
    </View>
  );
}
