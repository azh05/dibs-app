import { Pressable, StyleSheet } from 'react-native';

import { Icon, type IconName } from '@/components/icon';
import { Text } from '@/components/text';
import { colors, radii } from '@/theme';

type Props = {
  label: string;
  icon: IconName;
  selected?: boolean;
  onPress?: () => void;
};

// Figma "Interest Chip" (34:1174): Default = white with border and an ink icon,
// Selected = orange-soft with an orange border and icon.
export function InterestChip({ label, icon, selected = false, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      style={({ pressed }) => [styles.chip, selected ? styles.selected : styles.default, pressed && { opacity: 0.7 }]}>
      <Icon name={icon} size={16} color={selected ? colors.orange : colors.ink} />
      <Text weight="semibold" size={14}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingLeft: 12,
    paddingRight: 14,
    paddingVertical: 9,
    borderRadius: radii.pill,
  },
  default: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  selected: { backgroundColor: colors.orangeSoft, borderWidth: 1.5, borderColor: colors.orange },
});
