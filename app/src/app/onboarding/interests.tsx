import * as Notifications from 'expo-notifications';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { InterestChip } from '@/components/interest-chip';
import { SearchBar } from '@/components/search-bar';
import { Text } from '@/components/text';
import { INTEREST_SECTIONS, RADIUS_OPTIONS, STORE_TYPE_COUNT } from '@/lib/interests';
import { useStore } from '@/lib/store';
import { colors, gutter, radii } from '@/theme';

// 02 · Pick interests (Figma 27:887), onboarding step 2 of 3.
// Alerts → Edit opens it again with ?edit=1: no progress bar, and the button just closes it.
export default function PickInterests() {
  const insets = useSafeAreaInsets();
  const editing = useLocalSearchParams<{ edit?: string }>().edit === '1';
  const store = useStore();
  const { topics, radiusMi } = store;
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const sections = INTEREST_SECTIONS.map((s) => ({
    ...s,
    interests: q ? s.interests.filter((i) => i.label.toLowerCase().includes(q)) : s.interests,
  })).filter((s) => s.interests.length > 0);

  const turnOn = async () => {
    // The prompt only appears once; whatever the answer, alerts stay editable in the Alerts tab.
    await Notifications.requestPermissionsAsync().catch(() => undefined);
    store.setInstant(true);
    router.push('/onboarding/alerts');
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content} keyboardDismissMode="on-drag">
        <View style={styles.progress}>
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
            <Icon name="back" size={22} />
          </Pressable>
          {!editing && (
            <>
              <View style={styles.bars}>
                {[1, 2, 3].map((step) => (
                  <View
                    key={step}
                    style={[styles.bar, { backgroundColor: step <= 2 ? colors.orange : colors.border }]}
                  />
                ))}
              </View>
              <Text weight="bold" size={12} color={colors.inkTertiary}>
                2 of 3
              </Text>
            </>
          )}
        </View>

        <View style={{ gap: 8 }}>
          <Text weight="extrabold" size={28} tracking={-0.84} style={{ lineHeight: 33 }}>
            What should your agent watch for?
          </Text>
          <Text size={14} color={colors.inkSecondary} style={{ lineHeight: 21 }}>
            Pick everything you’re into. We’ll ping you the second a matching deal or event drops near you.
          </Text>
        </View>

        <SearchBar value={query} onChangeText={setQuery} placeholder={`Search ${STORE_TYPE_COUNT} store types`} compact />

        {sections.map((section) => {
          const labels = section.interests.map((i) => i.label);
          const allOn = labels.every((l) => topics.has(l));
          return (
            <View key={section.title} style={{ gap: 10 }}>
              <View style={styles.sectionHeader}>
                <Text weight="extrabold" size={16} tracking={-0.16}>
                  {section.title}
                </Text>
                <Pressable onPress={() => store.setTopicsOn(labels, !allOn)} hitSlop={8} accessibilityRole="button">
                  <Text weight="bold" size={13} color={colors.orange}>
                    {allOn ? 'Clear' : 'Select all'}
                  </Text>
                </Pressable>
              </View>
              <View style={styles.chips}>
                {section.interests.map((i) => (
                  <InterestChip
                    key={i.label}
                    label={i.label}
                    icon={i.icon}
                    selected={topics.has(i.label)}
                    onPress={() => store.toggleTopic(i.label)}
                  />
                ))}
              </View>
            </View>
          );
        })}

        {sections.length === 0 && (
          <Text size={14} color={colors.inkTertiary}>
            No store types match “{query.trim()}”.
          </Text>
        )}

        <View style={{ gap: 10 }}>
          <Text weight="bold" size={14}>
            Alert me about deals within
          </Text>
          <View style={styles.segmented}>
            {RADIUS_OPTIONS.map((mi) => {
              const active = mi === radiusMi;
              return (
                <Pressable
                  key={mi}
                  onPress={() => store.setRadiusMi(mi)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[styles.segment, active && styles.segmentActive]}>
                  <Text weight="bold" size={13} color={active ? colors.ink : colors.inkTertiary}>
                    {mi} mi
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </ScrollView>

      <View style={[styles.cta, { paddingBottom: Math.max(insets.bottom, 24) }]}>
        {editing ? (
          <Button label="Done" icon="check" onPress={() => router.back()} style={styles.ctaButton} />
        ) : (
          <Button label="Turn on live alerts" icon="bell" onPress={turnOn} style={styles.ctaButton} />
        )}
        <Text size={12} color={colors.inkTertiary}>
          {topics.size} {topics.size === 1 ? 'interest' : 'interests'} picked
          {editing ? '' : ' · edit anytime in Alerts'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { paddingTop: 6, paddingHorizontal: gutter, paddingBottom: 24, gap: 22 },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  bars: { flex: 1, flexDirection: 'row', gap: 6 },
  bar: { flex: 1, height: 5, borderRadius: 3 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  segmented: { flexDirection: 'row', gap: 4, padding: 4, borderRadius: radii.thumb, backgroundColor: colors.muted },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10 },
  segmentActive: {
    backgroundColor: colors.surface,
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  cta: { alignItems: 'center', gap: 10, paddingTop: 12, paddingHorizontal: gutter, backgroundColor: colors.surface },
  ctaButton: { alignSelf: 'stretch', paddingVertical: 17 },
});
