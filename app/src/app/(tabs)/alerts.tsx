import Slider from '@react-native-community/slider';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import DotRead from '@/assets/shapes/dot-read.svg';
import DotUnread from '@/assets/shapes/dot-unread.svg';
import { Chip } from '@/components/chip';
import { EventCard } from '@/components/event-card';
import { Icon } from '@/components/icon';
import { Overline } from '@/components/section-header';
import { Text } from '@/components/text';
import { Thumb } from '@/components/thumb';
import { Wordmark } from '@/components/wordmark';
import { findDeal, useDeals } from '@/lib/api';
import { expiryText } from '@/lib/format';
import { NOTIFY_TOPICS, useStore } from '@/lib/store';
import { colors, gutter } from '@/theme';

// 06 · Alerts (Figma 5:559)
export default function AlertsScreen() {
  const insets = useSafeAreaInsets();
  const { deals, events } = useDeals();
  const store = useStore();
  const { activity, instant, topics, radiusMi, reminders } = store;

  const latest = activity[0]?.dealId ? findDeal(deals, activity[0].dealId) : undefined;
  const nextEvent = events[0];

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.titleRow}>
          <Text weight="extrabold" size={30} tracking={-0.9}>
            Alerts
          </Text>
          <View style={styles.instant}>
            <Text weight="bold" size={14} color={colors.inkSecondary}>
              Instant
            </Text>
            <Switch
              value={instant}
              onValueChange={store.setInstant}
              trackColor={{ true: colors.orange, false: colors.border }}
              ios_backgroundColor={colors.border}
            />
          </View>
        </View>

        {instant && latest && (
          <Pressable onPress={() => router.push(`/deal/${latest.id}`)} style={styles.push}>
            <View style={styles.appIcon}>
              <Wordmark height={15.12} color={colors.surface} dot="ink" />
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <View style={styles.pushHeader}>
                <Text weight="bold" size={14} color={colors.surface}>
                  New deal · {latest.distanceMi} mi away
                </Text>
                <Text size={12} color={colors.inkTertiary}>
                  now
                </Text>
              </View>
              <Text size={13} color={colors.border} style={{ lineHeight: 18 }}>
                {latest.store} just posted {latest.offer}. {expiryText(latest)}.
              </Text>
            </View>
          </Pressable>
        )}

        {nextEvent && (
          <View style={{ gap: 10 }}>
            <View style={styles.rowBetween}>
              <Overline>COMING UP</Overline>
              {reminders.has(nextEvent.id) && (
                <View style={styles.reminder}>
                  <Icon name="bell" size={12} color={colors.orange} />
                  <Text weight="bold" size={12} color={colors.orange}>
                    Reminder on
                  </Text>
                </View>
              )}
            </View>
            <EventCard event={nextEvent} onPress={() => router.push(`/event/${nextEvent.id}`)} />
          </View>
        )}

        <View style={{ gap: 4 }}>
          <Overline>TODAY</Overline>
          {activity.map((a) => (
            <Pressable
              key={a.id}
              style={styles.activity}
              onPress={() => {
                store.markRead(a.id);
                if (a.dealId) router.push(`/deal/${a.dealId}`);
              }}>
              <Thumb icon={a.icon} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text weight="bold" size={14} numberOfLines={1}>
                  {a.title}
                </Text>
                <Text size={12} color={colors.inkTertiary} numberOfLines={1}>
                  {a.subtitle}
                </Text>
              </View>
              <View style={styles.activityMeta}>
                <Text size={12} color={colors.inkTertiary}>
                  {a.ago}
                </Text>
                {a.unread ? <DotUnread width={8} height={8} /> : <DotRead width={8} height={8} />}
              </View>
            </Pressable>
          ))}
        </View>

        <View style={{ gap: 12 }}>
          <Overline>NOTIFY ME ABOUT</Overline>
          <View style={styles.topics}>
            {NOTIFY_TOPICS.map((t) => (
              <Chip key={t} label={t} active={topics.has(t)} onPress={() => store.toggleTopic(t)} />
            ))}
          </View>
          <View style={{ gap: 10 }}>
            <View style={styles.rowBetween}>
              <Text weight="bold" size={14}>
                Distance
              </Text>
              <Text weight="bold" size={14} color={colors.orange}>
                Within {radiusMi} mi
              </Text>
            </View>
            <Slider
              value={radiusMi}
              onValueChange={store.setRadiusMi}
              minimumValue={0.25}
              maximumValue={3}
              step={0.25}
              minimumTrackTintColor={colors.orange}
              maximumTrackTintColor={colors.border}
              accessibilityLabel="Alert distance"
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { paddingTop: 8, paddingHorizontal: gutter, paddingBottom: 24, gap: 20 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  instant: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  push: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 14,
    borderRadius: 22,
    backgroundColor: colors.ink,
  },
  appIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pushHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reminder: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  activity: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  activityMeta: { alignItems: 'flex-end', gap: 6 },
  topics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
