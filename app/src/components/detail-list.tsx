import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/text';
import { colors, radii } from '@/theme';

export type DetailRow = {
  key: string;
  icon: ReactNode;
  title: string;
  /** Emphasised end of the title, e.g. "~15 min" in "Line now: ~15 min". */
  accent?: string;
  subtitle: string;
  /** Pill or control at the right edge ("Live"). */
  trailing?: ReactNode;
};

// The grey "Details" panel on the deal and event screens: icon + title + subtitle rows.
export function DetailList({ rows }: { rows: DetailRow[] }) {
  return (
    <View style={styles.panel}>
      {rows.map((row, i) => (
        <View key={row.key} style={[styles.row, i < rows.length - 1 && styles.divider]}>
          {row.icon}
          <View style={styles.text}>
            <Text weight="semibold" size={14}>
              {row.title}
              {row.accent && (
                <Text weight="extrabold" size={14} color={colors.orange}>
                  {row.accent}
                </Text>
              )}
            </Text>
            <Text size={12} color={colors.inkTertiary}>
              {row.subtitle}
            </Text>
          </View>
          {row.trailing}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: colors.muted, borderRadius: radii.card, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 14 },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  text: { flex: 1, gap: 2 },
});
