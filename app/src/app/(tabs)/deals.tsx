import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Badge from '@/assets/shapes/badge.svg';
import Caret from '@/assets/shapes/caret.svg';
import DotSection from '@/assets/shapes/dot-section.svg';
import { CircleButton } from '@/components/button';
import { Chip } from '@/components/chip';
import { DealCard } from '@/components/deal-card';
import { EventCard } from '@/components/event-card';
import { Icon } from '@/components/icon';
import { SearchBar } from '@/components/search-bar';
import { SectionHeader } from '@/components/section-header';
import { Text } from '@/components/text';
import { useDeals, usingLiveApi } from '@/lib/api';
import {
  ALL_DEALS,
  QUICK_FILTERS,
  UPCOMING_ONLY,
  applyEventFilters,
  applyFilters,
  quickFilterDeals,
  quickFilterEvents,
  type QuickFilter,
} from '@/lib/filters';
import { combinedLine } from '@/lib/line-check';
import { HOME } from '@/lib/mock';
import { useStore } from '@/lib/store';
import { colors, gutter } from '@/theme';

// 06 · Deals (Figma 4:73)
export default function DealsScreen() {
  const insets = useSafeAreaInsets();
  const { deals, events, loading, error } = useDeals();
  const { saved, toggleSaved, activity, filters, lineReports } = useStore();
  const [quick, setQuick] = useState<QuickFilter>(ALL_DEALS);
  const [query, setQuery] = useState('');

  const shownDeals = quickFilterDeals(applyFilters(deals, filters, query), quick);
  const shownEvents = quickFilterEvents(applyEventFilters(events, filters, query), quick);
  const unread = activity.some((a) => a.unread);

  let agentStatus = 'Watching 1,284 spots near you';
  if (loading) agentStatus = 'Your agent is scanning Instagram and the web near you…';
  else if (error) agentStatus = `Couldn't reach your agent: ${error}`;
  else if (usingLiveApi) agentStatus = `Your agent found ${deals.length} verified deals on the web just now`;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Pressable style={styles.location} accessibilityRole="button" accessibilityLabel="Change location">
            <Icon name="pin" size={18} color={colors.orange} />
            <Text weight="bold" size={16}>
              {HOME.label}
            </Text>
            <Caret width={16} height={16} color={colors.ink} />
          </Pressable>
          <CircleButton icon="bell" tone="muted" accessibilityLabel="Alerts" onPress={() => router.navigate('/alerts')}>
            {unread && (
              <View style={styles.badge}>
                <Badge width={10} height={10} />
              </View>
            )}
          </CircleButton>
        </View>

        <View style={styles.pad}>
          <Text weight="extrabold" size={32} tracking={-0.96}>
            <Text weight="extrabold" size={32} tracking={-0.96} color={colors.orange}>
              {deals.length}
            </Text>{' '}
            live deals
          </Text>
          <Text size={15} color={colors.inkTertiary} style={{ marginTop: 4 }}>
            {events.length} upcoming this week · within {filters.radiusMi} mi
          </Text>
        </View>

        <View style={styles.pad}>
          <SearchBar
            value={query}
            onChangeText={setQuery}
            placeholder="Search stores or deals"
            onFilters={() => router.push('/filters')}
          />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {QUICK_FILTERS.map((f) => (
            <Chip key={f.label} label={f.label} active={f === quick} onPress={() => setQuick(f)} />
          ))}
        </ScrollView>

        <View style={styles.pad}>
          <View style={styles.agent}>
            <Icon name="zap" size={18} color={colors.orange} />
            <Text weight="semibold" size={13} style={{ flex: 1 }}>
              {agentStatus}
            </Text>
          </View>
        </View>

        {shownEvents.length > 0 && (
          <View style={{ gap: 12 }}>
            <SectionHeader
              leading={<Icon name="calendar" size={16} color={colors.orange} />}
              title="Coming up"
              onSeeAll={() => setQuick(UPCOMING_ONLY)}
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.carousel}>
              {shownEvents.map((e) => (
                <EventCard key={e.id} event={e} width={290} onPress={() => router.push(`/event/${e.id}`)} />
              ))}
            </ScrollView>
          </View>
        )}

        {quick !== UPCOMING_ONLY && (
          <View style={{ gap: 20 }}>
            <SectionHeader
              leading={<DotSection width={8} height={8} />}
              title="Live now"
              onSeeAll={() => setQuick(ALL_DEALS)}
            />
            <View style={[styles.pad, { gap: 12 }]}>
              {shownDeals.map((d) => (
                <DealCard
                  key={d.id}
                  deal={d}
                  line={combinedLine(d, lineReports)}
                  saved={saved.has(d.id)}
                  onPress={() => router.push(`/deal/${d.id}`)}
                  onToggleSaved={() => toggleSaved(d.id)}
                />
              ))}
              {!loading && shownDeals.length === 0 && (
                <Text size={14} color={colors.inkTertiary}>
                  No live deals match yet. Your agent keeps looking.
                </Text>
              )}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { paddingTop: 8, paddingBottom: 24, gap: 20 },
  pad: { paddingHorizontal: gutter },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: gutter,
  },
  location: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badge: { position: 'absolute', left: 24, top: 9 },
  chips: { gap: 8, paddingHorizontal: gutter },
  agent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: colors.orangeSoft,
  },
  carousel: { gap: 12, paddingHorizontal: gutter },
});
