import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/text';
import { colors, gutter } from '@/theme';

// "Coming up" / "Live now" headers on the Deals screen.
export function SectionHeader({
  leading,
  title,
  onSeeAll,
}: {
  leading: ReactNode;
  title: string;
  onSeeAll?: () => void;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.title}>
        {leading}
        <Text weight="extrabold" size={18} tracking={-0.18}>
          {title}
        </Text>
      </View>
      {onSeeAll && (
        <Pressable onPress={onSeeAll} hitSlop={10} accessibilityRole="button">
          <Text weight="bold" size={14} color={colors.orange}>
            See all
          </Text>
        </Pressable>
      )}
    </View>
  );
}

/** Small caps label: "TODAY", "COMING UP", "NOTIFY ME ABOUT". */
export function Overline({ children, size = 12 }: { children: string; size?: number }) {
  return (
    <Text weight="bold" size={size} tracking={size * 0.08} color={colors.inkTertiary}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: gutter,
  },
  title: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
