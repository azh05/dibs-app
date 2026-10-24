import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { SourcePill } from '@/components/pills';
import { Text } from '@/components/text';
import { eventWeekday, eventWhen } from '@/lib/format';
import type { DealEvent } from '@/lib/types';
import { colors, radii } from '@/theme';

type Props = {
  event: DealEvent;
  onPress: () => void;
  /** 290 in the Deals carousel; omit to fill the row (Alerts). */
  width?: number;
};

// Figma "Event Card" (7:626): an upcoming event found from a future-dated post.
export function EventCard({ event, onPress, width }: Props) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, { width }, pressed && { opacity: 0.85 }]}>
      <View style={styles.date}>
        <Text weight="extrabold" size={11} tracking={0.88} color={colors.orange}>
          {eventWeekday(event)}
        </Text>
        <Text weight="extrabold" size={24} tracking={-0.72}>
          {event.startsAt.getDate()}
        </Text>
      </View>
      <View style={styles.info}>
        <View style={styles.when}>
          <Icon name="calendar" size={12} color={colors.orange} />
          <Text weight="extrabold" size={10} tracking={0.6} color={colors.orange}>
            {eventWhen(event)}
          </Text>
        </View>
        <Text weight="bold" size={15} numberOfLines={1}>
          {event.title}
        </Text>
        <Text size={12} color={colors.inkTertiary} numberOfLines={1}>
          {event.store} · {event.area}
        </Text>
        <View style={{ paddingTop: 5, alignItems: 'flex-start' }}>
          <SourcePill icon="instagram" label="Instagram · scheduled" />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    padding: 14,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
  },
  date: {
    width: 56,
    height: 64,
    borderRadius: radii.thumb,
    backgroundColor: colors.orangeSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: { flex: 1, gap: 3 },
  when: { flexDirection: 'row', alignItems: 'center', gap: 5 },
});
