import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { InterestChip } from '@/components/interest-chip';
import { OnboardingProgress } from '@/components/onboarding-progress';
import { SearchBar } from '@/components/search-bar';
import { Segmented } from '@/components/segmented';
import { Text } from '@/components/text';
import { useDeals } from '@/lib/api';
import { DEAL_TYPES, RADIUS_OPTIONS, STORE_SECTIONS, STORE_TYPE_COUNT, type Interest } from '@/lib/interests';
import { requestAlertPermission, sendDealAlert } from '@/lib/notifications';
import { useStore } from '@/lib/store';
import { colors, gutter, radii } from '@/theme';

/** Chips shown per section before "+N more". */
const COLLAPSED_CHIPS = 4;

/** The first alert lands while Live alerts is on screen. */
const FIRST_ALERT_DELAY_S = 4;

// 04 · Pick interests (Figma 27:887), onboarding step 2 of 3.
// Alerts and Profile → Edit open it again with ?edit=1: no progress bar, and the button just closes it.
export default function PickInterests() {
  const insets = useSafeAreaInsets();
  const editing = useLocalSearchParams<{ edit?: string }>().edit === '1';
  const store = useStore();
  const { topics, alertRadiusMi, adultUnlocked } = store;
  const { deals } = useDeals();
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(new Set<string>());

  const q = query.trim().toLowerCase();
  const matches = (i: Interest) => !q || i.label.toLowerCase().includes(q);
  // Store sections collapse to a few chips with a count; deal types always show in full.
  const sections = [
    ...STORE_SECTIONS.filter((s) => !s.adult || adultUnlocked).map((s) => ({ ...s, collapsible: true })),
    { title: 'Deal types', interests: DEAL_TYPES, collapsible: false },
  ]
    .map((s) => ({ ...s, interests: s.interests.filter(matches) }))
    .filter((s) => s.interests.length > 0);

  const verifyAge = () => {
    const result = store.unlockAdult();
    if (result === 'too-young') Alert.alert('21+ only', 'Nightlife and 21+ shops open up on your 21st birthday.');
    if (result === 'no-birthday') Alert.alert('Add your birthday', 'We need it once to show 21+ deals. It never appears on your profile.');
  };

  const turnOn = async () => {
    store.setInstant(true);
    if (await requestAlertPermission()) {
      const first = deals.find((d) => topics.has(d.storeType) || d.tags.some((t) => topics.has(t)));
      if (first) sendDealAlert(first, FIRST_ALERT_DELAY_S).catch(() => undefined);
    }
    router.push('/onboarding/alerts');
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content} keyboardDismissMode="on-drag">
        <OnboardingProgress step={editing ? undefined : 2} />

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
          const open = !section.collapsible || q !== '' || expanded.has(section.title);
          const shown = open ? section.interests : section.interests.slice(0, COLLAPSED_CHIPS);
          const hidden = section.interests.length - shown.length;
          return (
            <View key={section.title} style={{ gap: 10 }}>
              <View style={styles.sectionHeader}>
                <Text weight="extrabold" size={16} tracking={-0.16}>
                  {section.title}{' '}
                  {section.collapsible && (
                    <Text size={12} color={colors.inkTertiary}>
                      {section.interests.length}
                    </Text>
                  )}
                </Text>
                <Pressable onPress={() => store.setTopicsOn(labels, !allOn)} hitSlop={8} accessibilityRole="button">
                  <Text weight="bold" size={13} color={colors.orange}>
                    {allOn ? 'Clear' : 'Select all'}
                  </Text>
                </Pressable>
              </View>
              <View style={styles.chips}>
                {shown.map((i) => (
                  <InterestChip
                    key={i.label}
                    label={i.label}
                    icon={i.icon}
                    selected={topics.has(i.label)}
                    onPress={() => store.toggleTopic(i.label)}
                  />
                ))}
                {hidden > 0 && (
                  <Pressable
                    onPress={() => setExpanded((s) => new Set(s).add(section.title))}
                    accessibilityRole="button"
                    style={styles.more}>
                    <Text weight="bold" size={13} color={colors.inkSecondary}>
                      +{hidden} more
                    </Text>
                  </Pressable>
                )}
              </View>
              {section.title === 'Stays' && !adultUnlocked && !q && <AgeGate onVerify={verifyAge} />}
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
          <Segmented
            options={RADIUS_OPTIONS.map((mi) => ({ value: mi, label: `${mi} mi` }))}
            value={alertRadiusMi}
            onChange={store.setAlertRadiusMi}
          />
        </View>
      </ScrollView>

      <View style={[styles.cta, { paddingBottom: Math.max(insets.bottom, 24) }]}>
        {editing ? (
          <Button label="Done" icon="check" onPress={() => router.back()} style={styles.ctaButton} />
        ) : (
          <Button label="Turn on live alerts" icon="bell" onPress={turnOn} style={styles.ctaButton} />
        )}
        <Text size={12} color={colors.inkTertiary}>
          {topics.size} picked{editing ? '' : ' · edit anytime in Alerts'}
        </Text>
      </View>
    </View>
  );
}

// Figma "Age gate" (47:1912): Nightlife and 21+ shops stay hidden until the user verifies their age.
function AgeGate({ onVerify }: { onVerify: () => void }) {
  return (
    <View style={styles.gate}>
      <View style={styles.gateIcon}>
        <Icon name="lock" size={20} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text weight="extrabold" size={14} tracking={-0.14}>
          Nightlife & 21+ shops
        </Text>
        <Text size={11} color={colors.inkTertiary} style={{ lineHeight: 14 }}>
          Bars & breweries, clubs, lounges, karaoke, liquor, smoke & vape, dispensaries
        </Text>
      </View>
      <Pressable onPress={onVerify} accessibilityRole="button" style={styles.gateButton}>
        <Text weight="bold" size={13} color={colors.surface}>
          Verify 21+
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { paddingTop: 6, paddingHorizontal: gutter, paddingBottom: 24, gap: 22 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  more: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: radii.pill, backgroundColor: colors.muted },
  gate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
    padding: 14,
    borderRadius: radii.card,
    backgroundColor: colors.muted,
  },
  gateIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gateButton: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: radii.pill, backgroundColor: colors.ink },
  cta: { alignItems: 'center', gap: 10, paddingTop: 12, paddingHorizontal: gutter, backgroundColor: colors.surface },
  ctaButton: { alignSelf: 'stretch', paddingVertical: 17 },
});
