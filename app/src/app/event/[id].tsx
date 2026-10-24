import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionBar, Button } from '@/components/button';
import { DetailHeader } from '@/components/detail-header';
import { DetailList } from '@/components/detail-list';
import { Icon } from '@/components/icon';
import { Overline } from '@/components/section-header';
import { Text } from '@/components/text';
import { findEvent } from '@/lib/api';
import { countdown, eventRange } from '@/lib/format';
import { useStore } from '@/lib/store';
import { useNow } from '@/lib/use-now';
import { colors, gutter, radii } from '@/theme';

// 07 · Upcoming event (Figma 9:766)
export default function EventDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const now = useNow();
  const { saved, toggleSaved, reminders, toggleReminder } = useStore();
  const event = findEvent(id);

  if (!event) {
    return (
      <View style={[styles.missing, { paddingTop: insets.top + 40 }]}>
        <Text weight="bold" size={18}>
          This event is gone.
        </Text>
        <Button label="Back to deals" onPress={() => router.replace('/deals')} />
      </View>
    );
  }

  const left = countdown(event.startsAt, now);
  const units = [
    { value: left.days, label: 'days' },
    { value: left.hours, label: 'hrs' },
    { value: left.minutes, label: 'min' },
  ];
  const reminding = reminders.has(event.id);

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <DetailHeader
          post={event.post}
          height={276}
          imageHeight={160}
          saved={saved.has(event.id)}
          onToggleSaved={() => toggleSaved(event.id)}
        />
        <View style={styles.content}>
          <View style={{ gap: 10 }}>
            <View style={styles.tags}>
              <View style={styles.upcomingTag}>
                <Icon name="calendar" size={12} color={colors.orange} />
                <Text weight="bold" size={12} color={colors.orange}>
                  Upcoming
                </Text>
              </View>
              <View style={styles.scheduledTag}>
                <Icon name="instagram" size={12} />
                <Text weight="bold" size={11} color={colors.inkSecondary}>
                  Future-dated post · found {event.foundDaysEarly}d early
                </Text>
              </View>
            </View>
            <Text weight="extrabold" size={30} tracking={-0.9} style={{ lineHeight: 36 }}>
              {event.title}
            </Text>
            <View style={styles.place}>
              <Icon name={event.icon} size={16} color={colors.orange} />
              <Text size={13} color={colors.inkTertiary}>
                {event.store} · {event.area} · {event.distanceMi} mi
              </Text>
            </View>
          </View>

          <View style={{ gap: 8 }}>
            <Overline size={11}>STARTS IN</Overline>
            <View style={styles.countdown}>
              {units.map((u) => (
                <View key={u.label} style={styles.unit}>
                  <Text weight="extrabold" size={26} tracking={-0.78}>
                    {u.value}
                  </Text>
                  <Text weight="semibold" size={12} color={colors.inkTertiary}>
                    {u.label}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          <DetailList
            rows={[
              {
                key: 'when',
                icon: <Icon name="calendar" size={20} />,
                title: eventRange(event),
                subtitle: 'Collab pop-up announced on Instagram',
              },
              {
                key: 'where',
                icon: <Icon name="pin" size={20} />,
                title: event.address,
                subtitle: `${event.distanceMi} mi · ${event.travel}`,
              },
              {
                key: 'recheck',
                icon: <Icon name="zap" size={20} color={colors.orange} />,
                title: 'We’ll re-check it before it starts',
                subtitle: 'If anything changes, you’ll know first',
              },
            ]}
          />
        </View>
      </ScrollView>
      <ActionBar bottomInset={insets.bottom}>
        <Button
          label="Add to calendar"
          icon="calendar"
          variant="outline"
          onPress={() => Alert.alert('Added to calendar', `${event.title}\n${eventRange(event)}`)}
          style={{ paddingHorizontal: 16 }}
        />
        <Button
          label={reminding ? 'Reminder on' : 'Remind me'}
          icon={reminding ? 'check' : 'bell'}
          onPress={() => toggleReminder(event.id)}
          style={{ flex: 1, paddingHorizontal: 16 }}
        />
      </ActionBar>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { paddingTop: 22, paddingHorizontal: gutter, gap: 18 },
  tags: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  upcomingTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.orange,
    backgroundColor: colors.surface,
  },
  scheduledTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.muted,
  },
  place: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  countdown: { flexDirection: 'row', gap: 10 },
  unit: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: radii.button,
    backgroundColor: colors.muted,
  },
  missing: { flex: 1, alignItems: 'center', gap: 16, paddingHorizontal: gutter, backgroundColor: colors.surface },
});
