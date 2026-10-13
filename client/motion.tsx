import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Animated, AppState, Easing, Platform, StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from "react-native";
import { frameAt, glideAt, glidePieces, nextTick, type Cycle, type Glide, type Px } from "./motion-model";
import { ON_WEB, slideTo } from "./web";

/**
 * Everything that moves. On the web React Native's `Animated` runs in
 * JavaScript and commits a render per display frame, so here a move is a CSS
 * transition and a pulse or a fade is a keyframe animation: one render when it
 * starts and none while it runs. Native keeps `Animated` on its native driver.
 * A loop of frames is a strip moved by one shared timer, everywhere.
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

/**
 * One timer for every loop of frames on screen. It sleeps until the next
 * moment any of them changes frame, tells those that changed, and sleeps
 * again; with no loop playing there is no timer. The frame comes from the
 * clock, so equal loops are in step whenever they started.
 *
 * Not CSS animation: while one runs, however small and however slow, the
 * browser draws a frame for every refresh of the display. Measured in pairs on
 * the same view, loops as CSS animations cost five to six points of a core and
 * the same frames written by a timer cost what no animation does.
 */
interface Loop {
  cycle: Cycle;
  shown: number;
  show(frame: number): void;
}
const playing = new Set<Loop>();
let wake: ReturnType<typeof setTimeout> | null = null;
// The app in the background (on the web: the document hidden) draws nothing: the timer stops outright
// and catches up when the app comes back.
let appActive = AppState.currentState !== "background";
let watching: { remove(): void } | null = null;
function watch(): void {
  if (playing.size > 0 && !watching) {
    watching = AppState.addEventListener("change", (state) => {
      appActive = state !== "background";
      if (appActive) tick();
      else arm();
    });
  } else if (playing.size === 0 && watching) {
    watching.remove();
    watching = null;
  }
}
function arm(): void {
  if (wake) clearTimeout(wake);
  wake = null;
  if (!appActive) return;
  const now = Date.now();
  const cycles: Cycle[] = [];
  for (const loop of playing) cycles.push(loop.cycle);
  const at = nextTick(cycles, now);
  // A touch past the moment: a timer that fires early would find nothing changed.
  if (at !== null) wake = setTimeout(tick, at - now + 2);
}
function tick(): void {
  wake = null;
  const now = Date.now();
  for (const loop of playing) {
    const frame = frameAt(loop.cycle, now);
    if (frame !== loop.shown) {
      loop.shown = frame;
      loop.show(frame);
    }
  }
  arm();
}
/** Plays a loop from where the clock is; the returned function stops it, leaving its frame as it is. */
function play(cycle: Cycle, show: (frame: number) => void): () => void {
  const loop: Loop = { cycle, shown: frameAt(cycle, Date.now()), show };
  show(loop.shown);
  playing.add(loop);
  watch();
  arm();
  return () => {
    playing.delete(loop);
    watch();
    arm();
  };
}

/** True under a pane that is not on screen: every loop below it stands still. */
export const MotionPaused = createContext(false);

/**
 * A loop of frames played from a strip: `children` is one image holding
 * `count` frames side by side, each `width` by `height`, behind a window one
 * frame wide. `cycle` says which frame shows on each beat.
 *
 * On the web the strip is slid by writing its transform when its frame
 * changes: nothing is rendered again while it plays. Elsewhere the frame is
 * state, and only this view renders. `paused`, and a pane that is not shown,
 * leave it at the frame it had. The caller draws a still instead when nothing
 * should move.
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
  const strip = useRef<View>(null);
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (held) return;
    return play(cycle, ON_WEB ? (next) => slideTo(strip.current, (-100 * next) / count) : setFrame);
    // Keyed by content: a caller may build an equal cycle on every render.
  }, [key, held, count]);
  return (
    <View style={[style, { width, height, overflow: "hidden" }]}>
      <View
        ref={strip}
        style={[{ width: count * width, height }, ON_WEB ? null : { transform: [{ translateX: -frame * width }] }]}
      >
        {children}
      </View>
    </View>
  );
}
