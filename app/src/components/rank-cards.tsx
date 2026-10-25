import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { useSocial } from '@/lib/social-data';
import { colors } from '@/theme';

// Figma "Rankings" (115:2598) on Friends and Profile: your rank in your neighbourhood and at your school
// ("Westwood" and "UCLA" in the design). Each card opens the leaderboard on that scope.
export function RankCards() {
  const { rankCards } = useSocial();
  return (
    <View style={styles.row}>
      {rankCards.map(({ key, label: scope, icon, rank, change, top }) => {
        return (
          <Pressable
            key={key}
            onPress={() => router.navigate({ pathname: '/leaderboard', params: { scope: key } })}
            accessibilityRole="button"
            accessibilityLabel={`${scope} leaderboard`}
            style={styles.card}>
            <View style={styles.label}>
              <Icon name={icon} size={13} color={colors.inkTertiary} />
              <Text weight="extrabold" size={11} tracking={0.88} color={colors.inkTertiary}>
                {scope.toUpperCase()}
              </Text>
            </View>
            <View style={styles.value}>
              <Text weight="extrabold" size={28} tracking={-0.84}>
                {rank ? `#${rank}` : '–'}
              </Text>
              {top != null && (
                <Text weight="bold" size={12} color={colors.orange} style={{ paddingBottom: 5 }}>
                  Top {top}%
                </Text>
              )}
            </View>
            <Text weight="semibold" size={12} color={change >= 0 ? colors.success : colors.orange}>
              {change > 0 ? `▲ ${change} this week` : change < 0 ? `▼ ${-change} this week` : 'No change this week'}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10 },
  card: { flex: 1, gap: 4, padding: 14, borderRadius: 18, backgroundColor: colors.muted },
  label: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  value: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
});
