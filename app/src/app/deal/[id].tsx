import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import {
  ActivityIndicator,
  ActionSheetIOS,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import VerifiedSuccess from '@/assets/shapes/verified-success.svg';
import { ActionBar, Button } from '@/components/button';
import { DetailHeader } from '@/components/detail-header';
import { DetailList, type DetailRow } from '@/components/detail-list';
import { Icon } from '@/components/icon';
import { StatusPill } from '@/components/pills';
import { Text } from '@/components/text';
import { Thumb } from '@/components/thumb';
import { useDeal } from '@/lib/api';
import { usingBackend } from '@/lib/backend';
import { SOURCE_ICONS, endsIn, expiryText, shortAgo } from '@/lib/format';
import { combinedLine, lineLabel } from '@/lib/line-check';
import { openDirections } from '@/lib/notifications';
import { followKey, useStore, type Store } from '@/lib/store';
import type { Deal } from '@/lib/types';
import { useNow } from '@/lib/use-now';
import { colors, gutter } from '@/theme';

function sourceRow(deal: Deal): DetailRow {
  const icon = <Icon name={SOURCE_ICONS[deal.source.kind]} size={20} />;
  const spotted = `Spotted by your agent ${shortAgo(deal.postedHoursAgo)} ago`;
  const social = { instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook' } as const;
  if (deal.source.kind in social) {
    const handle = deal.source.handle ? ` · @${deal.source.handle}` : '';
    const network = social[deal.source.kind as keyof typeof social];
    return { key: 'source', icon, title: `Found on ${network}${handle}`, subtitle: spotted };
  }
  if (deal.source.kind === 'website') {
    const host = deal.source.url ? new URL(deal.source.url).host.replace(/^www\./, '') : 'the web';
    return { key: 'source', icon, title: `Found on ${host}`, subtitle: spotted };
  }
  return {
    key: 'source',
    icon,
    title: 'Reported by the dibs community',
    subtitle: `Posted ${shortAgo(deal.postedHoursAgo)} ago`,
  };
}

// 10 · Deal detail (Figma 5:341)
export default function DealDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const now = useNow();
  const store = useStore();
  const { saved, toggleSaved, followed, toggleFollowed, lineReports } = store;
  const { deal, loading } = useDeal(id);

  if (!deal && loading) {
    return (
      <View style={[styles.missing, { paddingTop: insets.top + 40 }]}>
        <ActivityIndicator color={colors.orange} />
      </View>
    );
  }

  if (!deal) {
    return (
      <View style={[styles.missing, { paddingTop: insets.top + 40 }]}>
        <Text weight="bold" size={18}>
          This deal is gone.
        </Text>
        <Button label="Back to deals" onPress={() => router.replace('/deals')} />
      </View>
    );
  }

  const meta = [
    deal.typeLabel,
    deal.distanceMi != null && `${deal.distanceMi} mi`,
    deal.openUntil && `Open until ${deal.openUntil}`,
  ]
    .filter(Boolean)
    .join(' · ');

  const rows: DetailRow[] = [];
  if (deal.window) rows.push({ key: 'when', icon: <Icon name="clock" size={20} />, ...deal.window });
  const line = combinedLine(deal, lineReports);
  if (line) {
    rows.push({
      key: 'line',
      icon: <Icon name="users" size={20} />,
      title: 'Line now: ',
      accent: lineLabel(line.minutes),
      subtitle: `${line.reports} ${line.reports === 1 ? 'report' : 'reports'} in the last hour`,
      trailing: <StatusPill label="Live" small />,
    });
  }
  if (deal.address) {
    const subtitle = [deal.distanceMi != null && `${deal.distanceMi} mi`, deal.walk].filter(Boolean).join(' · ');
    rows.push({
      key: 'where',
      icon: <Icon name="pin" size={20} />,
      title: deal.address,
      subtitle: subtitle || 'Westwood',
    });
  }
  rows.push(sourceRow(deal));
  if (deal.confirmations > 0) {
    rows.push({
      key: 'verified',
      icon: <VerifiedSuccess width={20} height={20} />,
      title: `Confirmed by ${deal.confirmations} dibs ${deal.confirmations === 1 ? 'user' : 'users'}`,
      subtitle:
        deal.lastCheckMinutes == null
          ? 'Checked recently'
          : deal.lastCheckMinutes < 60
            ? `Last check ${deal.lastCheckMinutes} min ago`
            : `Last check ${shortAgo(deal.lastCheckMinutes / 60)} ago`,
    });
  }

  const following = followed.has(followKey(deal));

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <DetailHeader
          post={deal.post}
          height={286}
          imageHeight={170}
          saved={saved.has(deal.id)}
          onToggleSaved={() => toggleSaved(deal.id)}
        />
        <View style={styles.content}>
          <View style={styles.store}>
            <Thumb icon={deal.icon} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text weight="bold" size={16}>
                {deal.store}
              </Text>
              <Text size={13} color={colors.inkTertiary}>
                {meta}
              </Text>
            </View>
          </View>
          <View style={{ gap: 10, alignItems: 'flex-start' }}>
            <Text weight="extrabold" size={30} tracking={-0.9} style={{ lineHeight: 36 }}>
              {deal.offer}
            </Text>
            <StatusPill label={deal.endsAt ? endsIn(deal.endsAt, now) : expiryText(deal, now)} />
          </View>
          <DetailList rows={rows} />
          <StillRunning deal={deal} store={store} />
          <Pressable onPress={() => addToList(store, deal.id)} accessibilityRole="button" style={styles.addToList}>
            <Icon name="bookmark" size={16} color={colors.orange} />
            <Text weight="bold" size={13} color={colors.orange}>
              Add to a list
            </Text>
          </Pressable>
          <View style={styles.trust}>
            <Icon name="zap" size={16} color={colors.orange} />
            <Text weight="semibold" size={12} color={colors.inkSecondary} style={{ flex: 1 }}>
              Found by dibs agents. No store paid to be here.
            </Text>
          </View>
        </View>
      </ScrollView>
      <ActionBar bottomInset={insets.bottom}>
        <Button
          label={following ? 'Following' : 'Follow'}
          icon={following ? 'check' : 'bell'}
          variant="outline"
          onPress={() => toggleFollowed(followKey(deal))}
        />
        <Button label="Get directions" icon="navigation" onPress={() => openDirections(deal)} style={{ flex: 1 }} />
      </ActionBar>
    </View>
  );
}

/** "Add to list": pick one of your lists, or start a new one. */
function addToList(store: Store, dealId: string) {
  const create = () =>
    Alert.prompt?.('New list', 'Name it, e.g. "Cheap eats"', (name) => name?.trim() && store.createList(name.trim()));
  const names = store.lists.map((l) => l.name);
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      { title: 'Add to list', options: [...names, 'New list…', 'Cancel'], cancelButtonIndex: names.length + 1 },
      (i) => {
        if (i < names.length) store.addToList(store.lists[i].id, dealId);
        else if (i === names.length) create();
      },
    );
    return;
  }
  Alert.alert('Add to list', undefined, [
    ...store.lists.slice(0, 3).map((l) => ({ text: l.name, onPress: () => store.addToList(l.id, dealId) })),
    { text: 'Cancel', style: 'cancel' as const },
  ]);
}

// Community check on a deal: "Still running?" Yes / Ended, plus thumbs up or down.
function StillRunning({ deal, store }: { deal: Deal; store: Store }) {
  const answered = store.confirmedToday.has(deal.id);
  const vote = deal.myVote ?? 0;
  return (
    <View style={styles.check}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text weight="bold" size={14}>
          {answered ? 'Thanks for checking!' : 'Still running?'}
        </Text>
        <Text size={12} color={colors.inkTertiary}>
          {answered ? 'Your answer helps everyone nearby' : 'Seen it in store today? Let others know.'}
        </Text>
      </View>
      {!answered && (
        <>
          <Pressable
            onPress={() => store.confirmDeal(deal.id, 'still_running')}
            accessibilityRole="button"
            style={styles.checkButton}>
            <Text weight="bold" size={13}>
              Yes
            </Text>
          </Pressable>
          <Pressable
            onPress={() => store.confirmDeal(deal.id, 'ended')}
            accessibilityRole="button"
            style={styles.checkButton}>
            <Text weight="bold" size={13} color={colors.orange}>
              Ended
            </Text>
          </Pressable>
        </>
      )}
      {usingBackend && (
        <View style={styles.votes}>
          <Pressable
            onPress={() => store.vote(deal.id, vote === 1 ? 0 : 1)}
            accessibilityRole="button"
            accessibilityLabel="Upvote"
            style={[styles.vote, vote === 1 && styles.voteOn]}>
            <Text weight="bold" size={13} color={vote === 1 ? colors.surface : colors.ink}>
              ▲ {deal.upvotes ?? 0}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => store.vote(deal.id, vote === -1 ? 0 : -1)}
            accessibilityRole="button"
            accessibilityLabel="Downvote"
            style={[styles.vote, vote === -1 && styles.voteOn]}>
            <Text weight="bold" size={13} color={vote === -1 ? colors.surface : colors.ink}>
              ▼
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  check: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
  },
  addToList: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  checkButton: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: colors.muted },
  votes: { flexDirection: 'row', gap: 6 },
  vote: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
  voteOn: { backgroundColor: colors.orange, borderColor: colors.orange },
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { paddingTop: 22, paddingHorizontal: gutter, gap: 18 },
  store: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  trust: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  missing: { flex: 1, alignItems: 'center', gap: 16, paddingHorizontal: gutter, backgroundColor: colors.surface },
});
