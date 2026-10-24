import Slider from '@react-native-community/slider';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import DotRead from '@/assets/shapes/dot-read.svg';
import DotUnread from '@/assets/shapes/dot-unread.svg';
import { EventCard } from '@/components/event-card';
import { Icon } from '@/components/icon';
import { InterestChip } from '@/components/interest-chip';
import { NotificationCard } from '@/components/notification-card';
import { Overline } from '@/components/section-header';
import { Text } from '@/components/text';
import { Thumb } from '@/components/thumb';
import { findDeal, useDeals } from '@/lib/api';
import { INTERESTS } from '@/lib/interests';
import { alertBody } from '@/lib/notifications';
import { useStore } from '@/lib/store';
import { colors, gutter, radii } from '@/theme';

/** Picked interests shown before the "+N more" pill. */
const SHOWN_INTERESTS = 7;

// 12 · Alerts (Figma 5:559)
export default function AlertsScreen() {
  const insets = useSafeAreaInsets();
  const { deals, events } = useDeals();
  const store = useStore();
  const { activity, instant, topics, alertRadiusMi, reminders } = store;

  const latestId = activity[0]?.dealId;
  const latest = latestId ? findDeal(deals, latestId) : undefined;
  const nextEvent = events[0];
  const picked = INTERESTS.filter((i) => topics.has(i.label));
  const editInterests = () => router.push({ pathname: '/onboarding/interests', params: { edit: '1' } });

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
        <Text size={14} color={colors.inkSecondary}>
          Live alerts for the interests you picked.
        </Text>

        <View style={{ gap: 12 }}>
          <View style={styles.rowBetween}>
            <Overline>YOUR INTERESTS</Overline>
            <Pressable onPress={editInterests} hitSlop={8} accessibilityRole="button">
              <Text weight="bold" size={14} color={colors.orange}>
                Edit
              </Text>
            </Pressable>
          </View>
          <View style={styles.topics}>
            {picked.slice(0, SHOWN_INTERESTS).map((i) => (
              <InterestChip key={i.label} label={i.label} icon={i.icon} selected onPress={editInterests} />
            ))}
            {picked.length > SHOWN_INTERESTS && (
              <Pressable onPress={editInterests} accessibilityRole="button" style={styles.more}>
                <Text weight="bold" size={14} color={colors.inkSecondary}>
                  +{picked.length - SHOWN_INTERESTS} more
                </Text>
              </Pressable>
            )}
          </View>
          <View style={{ gap: 10 }}>
            <View style={styles.rowBetween}>
              <Text weight="bold" size={14}>
                Distance
              </Text>
              <Text weight="bold" size={14} color={colors.orange}>
                Within {alertRadiusMi} mi
              </Text>
            </View>
            <Slider
              value={alertRadiusMi}
              onValueChange={store.setAlertRadiusMi}
              minimumValue={0.25}
              maximumValue={5}
              step={0.25}
              minimumTrackTintColor={colors.orange}
              maximumTrackTintColor={colors.border}
              accessibilityLabel="Alert distance"
            />
          </View>
        </View>

        {instant && latest && (
          <NotificationCard
            tone="dark"
            title={latest.store}
            body={alertBody(latest)}
            time="now"
            logo={latest.logo}
            icon={latest.icon}
            onPress={() => router.push(`/deal/${latest.id}`)}
          />
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
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { paddingTop: 8, paddingHorizontal: gutter, paddingBottom: 24, gap: 18 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  instant: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reminder: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  activity: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  activityMeta: { alignItems: 'flex-end', gap: 6 },
  topics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  more: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: radii.pill, backgroundColor: colors.muted },
});
