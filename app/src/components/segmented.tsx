import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/text';
import { colors, radii } from '@/theme';

type Props<T> = {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
};

// Figma "Segmented": muted track, the selected segment raised in white (distance, sort, scope).
export function Segmented<T extends string | number>({ options, value, onChange }: Props<T>) {
  return (
    <View style={styles.track}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            onPress={() => onChange(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[styles.segment, active && styles.active]}>
            <Text weight="bold" size={13} color={active ? colors.ink : colors.inkTertiary} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', gap: 4, padding: 4, borderRadius: radii.thumb, backgroundColor: colors.muted },
  // Sized to the label, then sharing the spare width, so a long label ("Westwood Village") gets more room than
  // "UCLA" instead of spilling over its neighbours.
  segment: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 'auto',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  active: {
    backgroundColor: colors.surface,
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
});
