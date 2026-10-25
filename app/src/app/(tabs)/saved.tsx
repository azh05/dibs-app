import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EventCard } from '@/components/event-card';
import { Icon, type IconName } from '@/components/icon';
import { Overline } from '@/components/section-header';
import { StoreLogo } from '@/components/store-logo';
import { Text } from '@/components/text';
import { Thumb } from '@/components/thumb';
import { useDeals } from '@/lib/api';
import { isLikelyExpired } from '@/lib/filters';
import { endsIn, isSameDay, plural } from '@/lib/format';
import { SAVED_LISTS, type SavedList } from '@/lib/social';
import { useStore } from '@/lib/store';
import type { Deal } from '@/lib/types';
import { useNow } from '@/lib/use-now';
import { colors, gutter, radii } from '@/theme';

const TABS = ['Deals', 'Events', 'Stores', 'Lists'] as const;
type Tab = (typeof TABS)[number];

const LIST_TONES = {
  orange: { bg: colors.orange, title: colors.surface, sub: colors.orangeSoft },
  soft: { bg: colors.orangeSoft, title: colors.ink, sub: colors.inkSecondary },
  muted: { bg: colors.muted, title: colors.ink, sub: colors.inkSecondary },
} as const;

type Kind = 'ending' | 'live' | 'expired';

function endsToday(deal: Deal, now: Date) {
  return deal.endsAt ? isSameDay(deal.endsAt, now) : deal.expiryLabel === 'Today only';
}

/** "Ends in 2h 10m", "Live · ends Sun", "Expired" */
function pillLabel(deal: Deal, kind: Kind, now: Date) {
  if (kind === 'expired') return 'Expired';
  if (kind === 'ending') return deal.endsAt ? endsIn(deal.endsAt, now) : 'Today only';
  const day = deal.endsAt?.toLocaleDateString('en-US', { weekday: 'short' });
  return day ? `Live · ends ${day}` : 'Live';
}

// 14 · Saved (Figma 49:1503), opened from Profile → My lists.
export default function SavedScreen() {
  const insets = useSafeAreaInsets();
  const now = useNow();
  const { deals, events } = useDeals();
  const { saved, toggleSaved, used, markUsed, followed, toggleFollowed } = useStore();
  const [tab, setTab] = useState<Tab>('Deals');

  const savedDeals = deals.filter((d) => saved.has(d.id));
  const savedEvents = events.filter((e) => saved.has(e.id));
  const expired = savedDeals.filter((d) => isLikelyExpired(d, now));
  const live = savedDeals.filter((d) => !expired.includes(d));
  const endingSoon = live.filter((d) => endsToday(d, now));
  const stillLive = live.filter((d) => !endingSoon.includes(d));
  const stores = [...followed].map((name) => ({ name, deal: deals.find((d) => d.store === name) }));

  const row = (deal: Deal, kind: Kind) => (
    <SavedDeal
      key={deal.id}
      deal={deal}
      kind={kind}
      pill={pillLabel(deal, kind, now)}
      used={used.has(deal.id)}
      onUse={() => markUsed(deal.id)}
      onRemove={() => toggleSaved(deal.id)}
    />
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <Icon name="back" size={22} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text weight="extrabold" size={28} tracking={-0.84}>
            Saved
          </Text>
          <Text size={13} color={colors.inkTertiary}>
            {plural(savedDeals.length, 'deal')} · {plural(savedEvents.length, 'event')} ·{' '}
            {plural(followed.size, 'store')}
          </Text>
        </View>
      </View>

      <View style={styles.tabs}>
        {TABS.map((t) => (
          <Pressable
            key={t}
            onPress={() => setTab(t)}
            accessibilityRole="tab"
            accessibilityState={{ selected: t === tab }}
            style={styles.tab}>
            <Text
              weight={t === tab ? 'extrabold' : 'semibold'}
              size={15}
              color={t === tab ? colors.ink : colors.inkTertiary}>
              {t}
            </Text>
            <View style={[styles.underline, t === tab && { backgroundColor: colors.orange }]} />
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {tab === 'Deals' && (
          <>
            {endingSoon.length > 0 && (
              <View style={styles.pad}>
                <View style={styles.nudge}>
                  <Icon name="flame" size={18} color={colors.orange} />
                  <Text weight="bold" size={14} color={colors.surface} style={{ flex: 1 }}>
                    {plural(endingSoon.length, 'saved deal')} {endingSoon.length === 1 ? 'ends' : 'end'} today
                  </Text>
                  <Text size={12} color={colors.inkTertiary}>
                    We’ll remind you
                  </Text>
                </View>
              </View>
            )}
            <Section title="ENDING SOON" deals={endingSoon} render={(d) => row(d, 'ending')} />
            <Section title="STILL LIVE" deals={stillLive} render={(d) => row(d, 'live')} />
            <Section title="EXPIRED" deals={expired} render={(d) => row(d, 'expired')} />
            {savedDeals.length === 0 && <Empty text="Tap the bookmark on any deal to keep it here." />}
          </>
        )}

        {tab === 'Events' && (
          <View style={[styles.pad, { gap: 12 }]}>
            {savedEvents.map((e) => (
              <EventCard key={e.id} event={e} onPress={() => router.push(`/event/${e.id}`)} />
            ))}
            {savedEvents.length === 0 && <Empty text="Save an upcoming event to see it here." />}
          </View>
        )}

        {tab === 'Stores' && (
          <View style={styles.pad}>
            {stores.map(({ name, deal }) => (
              <View key={name} style={styles.storeRow}>
                <StoreLogo logo={deal?.logo ?? null} icon={deal?.icon ?? 'store'} size={46} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text weight="extrabold" size={15} tracking={-0.15}>
                    {name}
                  </Text>
                  <Text size={12} color={colors.inkTertiary}>
                    {deal ? `${deal.typeLabel} · ${deal.distanceMi} mi` : 'Following'}
                  </Text>
                </View>
                <PillButton label="Following" icon="check" onPress={() => toggleFollowed(name)} />
              </View>
            ))}
            {stores.length === 0 && <Empty text="Follow a store from any deal to see it here." />}
          </View>
        )}

        {tab === 'Lists' && (
          <View style={[styles.pad, styles.listGrid]}>
            {SAVED_LISTS.map((l) => (
              <ListTile key={l.name} list={l} />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function Section({ title, deals, render }: { title: string; deals: Deal[]; render: (d: Deal) => ReactNode }) {
  if (deals.length === 0) return null;
  return (
    <View style={[styles.pad, { gap: 2 }]}>
      <Overline>{title}</Overline>
      {deals.map(render)}
    </View>
  );
}

function SavedDeal({
  deal,
  kind,
  pill,
  used,
  onUse,
  onRemove,
}: {
  deal: Deal;
  kind: Kind;
  pill: string;
  used: boolean;
  onUse: () => void;
  onRemove: () => void;
}) {
  const expired = kind === 'expired';
  const pillColors =
    kind === 'ending'
      ? { bg: colors.orangeSoft, fg: colors.orange }
      : kind === 'live'
        ? { bg: colors.muted, fg: colors.success }
        : { bg: colors.muted, fg: colors.inkTertiary };
  return (
    <Pressable onPress={() => router.push(`/deal/${deal.id}`)} style={[styles.dealRow, expired && { opacity: 0.7 }]}>
      <Thumb icon={deal.icon} size={46} tone={expired ? 'muted' : 'orange'} />
      <View style={{ flex: 1, gap: 3, alignItems: 'flex-start' }}>
        <Text weight="extrabold" size={15} tracking={-0.15} color={expired ? colors.inkTertiary : colors.ink}>
          {deal.shortOffer}
        </Text>
        <Text size={12} color={colors.inkTertiary}>
          {deal.store}
          {deal.distanceMi != null ? ` · ${deal.distanceMi} mi` : ''}
        </Text>
        <View style={[styles.pill, { backgroundColor: pillColors.bg }]}>
          {!expired && <View style={[styles.dot, { backgroundColor: pillColors.fg }]} />}
          <Text weight="bold" size={11} color={pillColors.fg}>
            {pill}
          </Text>
        </View>
      </View>
      {expired ? (
        <Pressable onPress={onRemove} hitSlop={8} accessibilityRole="button">
          <Text weight="bold" size={13} color={colors.inkTertiary}>
            Remove
          </Text>
        </Pressable>
      ) : (
        <PillButton label={used ? 'Used' : 'Used it'} icon="check" onPress={onUse} done={used} />
      )}
    </Pressable>
  );
}

function PillButton({
  label,
  icon,
  onPress,
  done = false,
}: {
  label: string;
  icon: IconName;
  onPress: () => void;
  done?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={done}
      accessibilityRole="button"
      style={[styles.pillButton, done && { borderColor: colors.success }]}>
      <Icon name={icon} size={14} color={done ? colors.success : colors.ink} />
      <Text weight="bold" size={13} color={done ? colors.success : colors.ink}>
        {label}
      </Text>
    </Pressable>
  );
}

function ListTile({ list }: { list: SavedList }) {
  const tone = LIST_TONES[list.tone];
  return (
    <View style={[styles.listTile, { backgroundColor: tone.bg }]}>
      <Icon name={list.icon} size={22} color={tone.title} />
      <View>
        <Text weight="extrabold" size={14} tracking={-0.14} color={tone.title}>
          {list.name}
        </Text>
        <Text size={12} color={tone.sub}>
          {list.spots} spots
        </Text>
      </View>
    </View>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <Text size={14} color={colors.inkTertiary} style={styles.pad}>
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 6, paddingHorizontal: gutter },
  tabs: {
    flexDirection: 'row',
    gap: 22,
    marginTop: 18,
    paddingHorizontal: gutter,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tab: { alignItems: 'center', gap: 8 },
  underline: { width: 28, height: 3, borderRadius: 2 },
  content: { gap: 18, paddingTop: 18, paddingBottom: 32 },
  pad: { paddingHorizontal: gutter },
  listGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  listTile: { width: 116, height: 116, justifyContent: 'space-between', padding: 12, borderRadius: radii.card },
  nudge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radii.button,
    backgroundColor: colors.ink,
  },
  dealRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: radii.pill,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  pillButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  storeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
});
