import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
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
import { InterestChip } from '@/components/interest-chip';
import { SearchBar } from '@/components/search-bar';
import { SectionHeader } from '@/components/section-header';
import { Text } from '@/components/text';
import { searchIndexedDeals, useDeals, usingLiveApi } from '@/lib/api';
import { UPCOMING_EVENTS, applyEventFilters, applyFilters, quickFilters } from '@/lib/filters';
import { DEAL_TYPES, STORE_TYPES } from '@/lib/interests';
import { combinedLine } from '@/lib/line-check';
import { HOME } from '@/lib/mock';
import { useStore } from '@/lib/store';
import type { Deal } from '@/lib/types';
import { colors, gutter } from '@/theme';

// 07 · Deals (Figma 4:73)
export default function DealsScreen() {
  const insets = useSafeAreaInsets();
  const { deals, events, loading, error } = useDeals();
  const { saved, toggleSaved, activity, filters, lineReports, topics } = useStore();
  // Quick chips: "All" (on at first), your store-type interests, then every deal type.
  const interests = STORE_TYPES.filter((t) => topics.has(t.label));
  const [pickedStores, setPickedStores] = useState(new Set<string>());
  const [pickedTypes, setPickedTypes] = useState(new Set<string>());
  const [upcomingOnly, setUpcomingOnly] = useState(false);
  const [query, setQuery] = useState('');
  // With the live API, a search goes to the Elastic index (every deal ever found, by meaning and distance).
  const [indexed, setIndexed] = useState<{ query: string; deals: Deal[] } | null>(null);
  const q = query.trim();

  useEffect(() => {
    if (!usingLiveApi || !q) return;
    const id = setTimeout(() => {
      searchIndexedDeals(q, HOME, filters.radiusMi).then(
        (found) => setIndexed({ query: q, deals: found }),
        () => setIndexed({ query: q, deals: [] }),
      );
    }, 400);
    return () => clearTimeout(id);
  }, [q, filters.radiusMi]);

  const toggle = (set: Set<string>, label: string) => {
    const next = new Set(set);
    if (next.has(label)) next.delete(label);
    else next.add(label);
    return next;
  };
  const quick = quickFilters(filters, pickedStores, pickedTypes);
  // "See all" on Coming up, or the Upcoming events chip on its own, shows events only.
  const eventsOnly = upcomingOnly || (pickedTypes.size === 1 && pickedTypes.has(UPCOMING_EVENTS));
  const searchedDeals = usingLiveApi && q ? (indexed?.query === q ? indexed.deals : []) : null;
  const shownDeals = eventsOnly
    ? []
    : (searchedDeals ?? applyFilters(applyFilters(deals, filters, query, topics), quick, '', topics));
  const shownEvents = applyEventFilters(applyEventFilters(events, filters, query), quick);
  const allOn = pickedStores.size === 0 && pickedTypes.size === 0 && !upcomingOnly;
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
          <View style={styles.headerButtons}>
            {usingLiveApi && (
              <CircleButton icon="sparkles" tone="muted" accessibilityLabel="Ask dibs" onPress={() => router.push('/ask')} />
            )}
            <CircleButton icon="bell" tone="muted" accessibilityLabel="Alerts" onPress={() => router.navigate('/alerts')}>
            {unread && (
              <View style={styles.badge}>
                <Badge width={10} height={10} />
              </View>
            )}
          </CircleButton>
          </View>
        </View>

        <View style={styles.pad}>
          <Text weight="extrabold" size={32} tracking={-0.96}>
            <Text weight="extrabold" size={32} tracking={-0.96} color={colors.orange}>
              {deals.length}
            </Text>{' '}
            live deals
          </Text>
          <View style={styles.agents}>
            <Text weight="bold" size={15}>
              Agents searching{' '}
              <Text weight="extrabold" size={15} color={colors.orange}>
                24/7
              </Text>
            </Text>
            <View style={styles.sources}>
              <Icon name="instagram" size={16} color={colors.inkTertiary} />
              <Icon name="globe" size={16} color={colors.inkTertiary} />
              <Icon name="users" size={16} color={colors.inkTertiary} />
            </View>
          </View>
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
          <Chip
            label="All"
            tone="orange"
            active={allOn}
            onPress={() => {
              setPickedStores(new Set());
              setPickedTypes(new Set());
              setUpcomingOnly(false);
            }}
          />
          {interests.map((t) => (
            <InterestChip
              key={t.label}
              label={t.label}
              icon={t.icon}
              selected={pickedStores.has(t.label)}
              onPress={() => setPickedStores((s) => toggle(s, t.label))}
            />
          ))}
          <View style={styles.divider} />
          {DEAL_TYPES.map((t) => (
            <InterestChip
              key={t.label}
              label={t.label}
              icon={t.icon}
              selected={pickedTypes.has(t.label)}
              onPress={() => setPickedTypes((s) => toggle(s, t.label))}
            />
          ))}
          <Chip
            label="+ Edit"
            onPress={() => router.push({ pathname: '/onboarding/interests', params: { edit: '1' } })}
          />
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
              onSeeAll={() => setUpcomingOnly(true)}
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.carousel}>
              {shownEvents.map((e) => (
                <EventCard key={e.id} event={e} width={290} onPress={() => router.push(`/event/${e.id}`)} />
              ))}
            </ScrollView>
          </View>
        )}

        {!eventsOnly && (
          <View style={{ gap: 20 }}>
            <SectionHeader
              leading={<DotSection width={8} height={8} />}
              title="Live now"
              onSeeAll={() => setUpcomingOnly(false)}
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
  headerButtons: { flexDirection: 'row', gap: 10 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: gutter,
  },
  location: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badge: { position: 'absolute', left: 24, top: 9 },
  chips: { gap: 8, paddingHorizontal: gutter, alignItems: 'center' },
  divider: { width: 1.5, height: 24, borderRadius: 1, backgroundColor: colors.border },
  agents: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  sources: { flexDirection: 'row', alignItems: 'center', gap: 7 },
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
