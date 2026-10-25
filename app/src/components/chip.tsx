import { Pressable, StyleSheet } from 'react-native';

import { Text } from '@/components/text';
import { colors, radii, shadows } from '@/theme';

type Props = {
  label: string;
  active?: boolean;
  onPress?: () => void;
  /** Drop shadow used when chips float over the map. */
  floating?: boolean;
  /** Active look: ink (default) or orange-soft with an orange border, like a selected Interest Chip. */
  tone?: 'ink' | 'orange';
};

// Figma "Chip" (2:146): Default = white with border, Active = ink. Deals' "All" uses the orange tone.
export function Chip({ label, active = false, onPress, floating = false, tone = 'ink' }: Props) {
  const orange = active && tone === 'orange';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.chip,
        active ? (orange ? styles.orange : styles.active) : styles.default,
        floating && shadows.button,
        pressed && { opacity: 0.7 },
      ]}>
      <Text weight={orange ? 'bold' : 'semibold'} size={14} color={active && !orange ? colors.surface : colors.ink}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  default: { backgroundColor: colors.surface, borderColor: colors.border },
  active: { backgroundColor: colors.ink, borderColor: colors.ink },
  orange: { backgroundColor: colors.orangeSoft, borderColor: colors.orange, borderWidth: 1.5 },
});
