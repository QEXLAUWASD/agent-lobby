import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useEffect, useState, type ReactNode } from "react";
import {
  AccessibilityInfo,
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";

/** React Native Web adds `hovered` to the pressable state; native never sets it. */
export type PressState = PressableStateCallbackType & { hovered?: boolean };
export const pressStyle =
  (fn: (state: PressState) => StyleProp<ViewStyle>) =>
  (state: PressableStateCallbackType): StyleProp<ViewStyle> =>
    fn(state as PressState);
import type { CrewState } from "./model";
import { Pulse } from "./motion";

/** Spacing steps and type sizes mirror Paseo's theme scale so the pane sits flush with host chrome. */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
export const font = { xs: 11, sm: 12, base: 13, lg: 15 } as const;
export const radius = { sm: 6, md: 8, lg: 10 } as const;

export function stateColor(theme: PluginTheme, state: CrewState): string {
  switch (state) {
    case "needs-input":
      return theme.colors.statusWarning;
    case "failed":
      return theme.colors.statusDanger;
    case "working":
      return theme.colors.accent;
    case "ready":
      return theme.colors.statusSuccess;
    case "idle":
    case "closed":
      return theme.colors.foregroundMuted;
  }
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => active && setReduced(value))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => {
      active = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

/**
 * A working agent breathes, like Paseo's own running dot; every other state holds still.
 * Motion is the signal that the agent is alive, so it stops when the user asks for less motion.
 */
export function StatusDot({
  theme,
  state,
  size = 8,
  pulse = state === "working",
}: {
  theme: PluginTheme;
  state: CrewState;
  size?: number;
  pulse?: boolean;
}) {
  const reduced = useReducedMotion();
  return (
    <Pulse
      on={pulse && !reduced}
      rest={state === "closed" ? 0.5 : 1}
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: stateColor(theme, state) }}
    />
  );
}

type ButtonVariant = "default" | "secondary" | "outline" | "ghost" | "destructive";
type ButtonSize = "xs" | "sm" | "md";

const buttonHeight: Record<ButtonSize, number> = { xs: 28, sm: 32, md: 40 };
const buttonFont: Record<ButtonSize, number> = { xs: font.sm, sm: font.base, md: font.base };
const buttonPad: Record<ButtonSize, number> = { xs: space.sm, sm: space.md, md: space.lg };

export function Button({
  theme,
  label,
  onPress,
  variant = "secondary",
  size = "sm",
  icon,
  disabled,
  style,
}: {
  theme: PluginTheme;
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = theme;
  const fill =
    variant === "default"
      ? colors.accent
      : variant === "destructive"
        ? colors.statusDanger
        : variant === "secondary"
          ? colors.surface2
          : "transparent";
  const text =
    variant === "default" || variant === "destructive" ? colors.accentForeground : colors.foreground;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled ?? false }}
      disabled={disabled}
      onPress={onPress}
      style={pressStyle(({ pressed, hovered }) => [
        {
          height: buttonHeight[size],
          paddingHorizontal: buttonPad[size],
          borderRadius: radius.md,
          backgroundColor:
            variant === "ghost" && (hovered || pressed) ? colors.surface2 : fill,
          borderWidth: variant === "outline" ? StyleSheet.hairlineWidth * 2 : 0,
          borderColor: variant === "outline" ? colors.border : colors.accent,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: space.xs + 2,
          opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
        },
        style,
      ])}
    >
      {icon ? <Icon name={icon} size={14} color={text} /> : null}
      <Text style={{ color: text, fontSize: buttonFont[size], fontWeight: "500" }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export function IconButton({
  theme,
  icon,
  label,
  onPress,
  size = 28,
  color,
}: {
  theme: PluginTheme;
  icon: string;
  label: string;
  onPress: () => void;
  size?: number;
  color?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={pressStyle(({ pressed, hovered }) => ({
        width: size,
        height: size,
        borderRadius: radius.sm,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: hovered || pressed ? theme.colors.surface2 : "transparent",
      }))}
    >
      <Icon name={icon} size={16} color={color ?? theme.colors.foregroundMuted} />
    </Pressable>
  );
}

export function Chip({
  theme,
  label,
  count,
  selected,
  color,
  onPress,
}: {
  theme: PluginTheme;
  label: string;
  count?: number;
  selected: boolean;
  color?: string;
  onPress: () => void;
}) {
  const { colors } = theme;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={pressStyle(({ hovered }) => ({
        height: 26,
        paddingHorizontal: space.sm + 2,
        borderRadius: 13,
        flexDirection: "row",
        alignItems: "center",
        gap: space.xs + 1,
        backgroundColor: selected ? colors.surface2 : hovered ? colors.surface1 : "transparent",
      }))}
    >
      {color ? (
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
      ) : null}
      <Text
        style={{
          color: selected ? colors.foreground : colors.foregroundMuted,
          fontSize: font.sm,
          fontWeight: selected ? "500" : "400",
        }}
      >
        {label}
      </Text>
      {count !== undefined ? (
        <Text style={{ color: colors.foregroundMuted, fontSize: font.xs }}>{count}</Text>
      ) : null}
    </Pressable>
  );
}

export function Muted({
  theme,
  children,
  size = font.sm,
  numberOfLines,
  style,
}: {
  theme: PluginTheme;
  children: ReactNode;
  size?: number;
  numberOfLines?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[{ color: theme.colors.foregroundMuted, fontSize: size, lineHeight: size * 1.4 }, style as never]}
    >
      {children}
    </Text>
  );
}

export function Empty({ theme, label }: { theme: PluginTheme; label: string }) {
  return (
    <View style={{ paddingVertical: space.xl * 2, alignItems: "center" }}>
      <Muted theme={theme} size={font.base}>
        {label}
      </Muted>
    </View>
  );
}
