import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon, type IconName } from '@/components/icon';
import { Text } from '@/components/text';
import { colors, radii, shadows } from '@/theme';

const VARIANTS = {
  primary: { bg: colors.orange, fg: colors.surface, border: colors.orange, borderWidth: 0 },
  dark: { bg: colors.ink, fg: colors.surface, border: colors.ink, borderWidth: 0 },
  outline: { bg: colors.surface, fg: colors.ink, border: colors.border, borderWidth: 1.5 },
  /** White outline on the orange Welcome screen. */
  ghost: { bg: 'transparent', fg: colors.surface, border: 'rgba(255,255,255,0.5)', borderWidth: 1.5 },
} as const;

type Props = {
  label: string;
  icon?: IconName;
  variant?: keyof typeof VARIANTS;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
};

export function Button({ label, icon, variant = 'primary', onPress, style }: Props) {
  const v = VARIANTS[variant];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: v.bg, borderColor: v.border, borderWidth: v.borderWidth },
        pressed && { opacity: 0.8 },
        style,
      ]}>
      {icon && <Icon name={icon} size={18} color={v.fg} />}
      <Text weight="bold" size={16} color={v.fg}>
        {label}
      </Text>
    </Pressable>
  );
}

/** 42px round icon button (back, bookmark, alerts). */
export function CircleButton({
  icon,
  onPress,
  tone = 'surface',
  color = colors.ink,
  accessibilityLabel,
  children,
}: {
  icon: IconName;
  onPress?: () => void;
  tone?: 'surface' | 'muted';
  color?: string;
  accessibilityLabel: string;
  children?: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.circle,
        tone === 'surface' ? [{ backgroundColor: colors.surface }, shadows.button] : { backgroundColor: colors.muted },
        pressed && { opacity: 0.7 },
      ]}>
      <Icon name={icon} size={20} color={color} />
      {children}
    </Pressable>
  );
}

/** Sticky bottom bar holding the detail screens' two actions. */
export function ActionBar({ children, bottomInset }: { children: React.ReactNode; bottomInset: number }) {
  return <View style={[styles.actionBar, { paddingBottom: Math.max(bottomInset, 14) }]}>{children}</View>;
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderRadius: radii.button,
  },
  circle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBar: {
    flexDirection: 'row',
    gap: 12,
    paddingTop: 14,
    paddingHorizontal: 20,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
