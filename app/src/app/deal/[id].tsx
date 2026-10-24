import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import VerifiedSuccess from '@/assets/shapes/verified-success.svg';
import { ActionBar, Button } from '@/components/button';
import { DetailHeader } from '@/components/detail-header';
import { DetailList, type DetailRow } from '@/components/detail-list';
import { Icon } from '@/components/icon';
import { StatusPill } from '@/components/pills';
import { Text } from '@/components/text';
import { Thumb } from '@/components/thumb';
import { findDeal, useDeals } from '@/lib/api';
import { SOURCE_ICONS, endsIn, expiryText, shortAgo } from '@/lib/format';
import { combinedLine, lineLabel } from '@/lib/line-check';
import { openDirections } from '@/lib/notifications';
import { useStore } from '@/lib/store';
import type { Deal } from '@/lib/types';
import { useNow } from '@/lib/use-now';
import { colors, gutter } from '@/theme';

function sourceRow(deal: Deal): DetailRow {
  const icon = <Icon name={SOURCE_ICONS[deal.source.kind]} size={20} />;
  const spotted = `Spotted by your agent ${shortAgo(deal.postedHoursAgo)} ago`;
  if (deal.source.kind === 'instagram') {
    const handle = deal.source.handle ? ` · @${deal.source.handle}` : '';
    return { key: 'source', icon, title: `Found on Instagram${handle}`, subtitle: spotted };
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

// 09 · Deal detail (Figma 5:341)
export default function DealDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const now = useNow();
  const { deals } = useDeals();
  const { saved, toggleSaved, followed, toggleFollowed, lineReports } = useStore();
  const deal = findDeal(deals, id);

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
      trailing: <StatusPill label="Live" />,
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

  const following = followed.has(deal.store);

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
          onPress={() => toggleFollowed(deal.store)}
        />
        <Button label="Get directions" icon="navigation" onPress={() => openDirections(deal)} style={{ flex: 1 }} />
      </ActionBar>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { paddingTop: 22, paddingHorizontal: gutter, gap: 18 },
  store: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  trust: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  missing: { flex: 1, alignItems: 'center', gap: 16, paddingHorizontal: gutter, backgroundColor: colors.surface },
});
