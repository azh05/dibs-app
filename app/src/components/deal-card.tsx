import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { SourcePill, StatusPill } from '@/components/pills';
import { Text } from '@/components/text';
import { Thumb } from '@/components/thumb';
import { SOURCE_ICONS, dealMeta, expiryText, sourceText } from '@/lib/format';
import type { Deal } from '@/lib/types';
import { colors, radii } from '@/theme';

type Props = {
  deal: Deal;
  saved: boolean;
  onPress: () => void;
  onToggleSaved: () => void;
};

// Figma "Deal Card" (2:155).
export function DealCard({ deal, saved, onPress, onToggleSaved }: Props) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}>
      <View style={styles.header}>
        <Thumb icon={deal.icon} />
        <View style={styles.store}>
          <Text weight="bold" size={15} numberOfLines={1}>
            {deal.store}
          </Text>
          <Text size={13} color={colors.inkTertiary} numberOfLines={1}>
            {dealMeta(deal)}
          </Text>
        </View>
        <Pressable
          onPress={onToggleSaved}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={saved ? 'Remove bookmark' : 'Bookmark deal'}>
          <Icon name="bookmark" size={20} color={saved ? colors.orange : colors.ink} />
        </Pressable>
      </View>
      <Text weight="bold" size={20} tracking={-0.3}>
        {deal.offer}
      </Text>
      <View style={styles.footer}>
        <SourcePill icon={SOURCE_ICONS[deal.source.kind]} label={sourceText(deal)} />
        <View style={{ flex: 1 }} />
        <StatusPill label={expiryText(deal)} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
    padding: 16,
    gap: 14,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  store: { flex: 1, gap: 2 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
