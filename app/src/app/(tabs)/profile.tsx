import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { DealCard } from '@/components/deal-card';
import { Overline } from '@/components/section-header';
import { Text } from '@/components/text';
import { useDeals } from '@/lib/api';
import { useStore } from '@/lib/store';
import { colors, gutter, radii } from '@/theme';

// Not in the Figma file: a simple profile built from the same parts (saved deals, earnings).
export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { deals } = useDeals();
  const { saved, toggleSaved, earned, submissions, followed } = useStore();
  const savedDeals = deals.filter((d) => saved.has(d.id));

  const stats = [
    { label: 'earned', value: `$${earned}` },
    { label: 'submitted', value: String(submissions.length) },
    { label: 'following', value: String(followed.size) },
  ];

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text weight="extrabold" size={30} tracking={-0.9}>
          Profile
        </Text>
        <View style={styles.stats}>
          {stats.map((s) => (
            <View key={s.label} style={styles.stat}>
              <Text weight="extrabold" size={26} tracking={-0.78}>
                {s.value}
              </Text>
              <Text weight="semibold" size={12} color={colors.inkTertiary}>
                {s.label}
              </Text>
            </View>
          ))}
        </View>
        <View style={{ gap: 12 }}>
          <Overline>SAVED DEALS</Overline>
          {savedDeals.length === 0 ? (
            <Text size={14} color={colors.inkTertiary}>
              Tap the bookmark on any deal to keep it here.
            </Text>
          ) : (
            savedDeals.map((d) => (
              <DealCard
                key={d.id}
                deal={d}
                saved
                onPress={() => router.push(`/deal/${d.id}`)}
                onToggleSaved={() => toggleSaved(d.id)}
              />
            ))
          )}
        </View>
        <Button label="Back to welcome" variant="outline" onPress={() => router.replace('/')} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { paddingTop: 8, paddingHorizontal: gutter, paddingBottom: 24, gap: 20 },
  stats: { flexDirection: 'row', gap: 10 },
  stat: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: radii.button,
    backgroundColor: colors.muted,
  },
});
