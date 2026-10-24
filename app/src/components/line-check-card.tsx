import { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, useAnimatedValue, View } from 'react-native';

import { Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { AUTO_DISMISS_MS, LINE_OPTIONS, lineLabel, REPORT_XP, type LineReport } from '@/lib/line-check';
import { colors, radii } from '@/theme';

type Props = {
  store: string;
  onReport: (minutes: number) => LineReport;
  onUndo: (report: LineReport) => void;
  onClose: () => void;
};

/** How long the "Thanks" state stays up before the card goes away. */
const THANKS_MS = 6000;

// Figma "Line Check Card" (52:1757): Ask with one-tap answers, auto-dismissing after ~10 s,
// then Thanks with Undo.
export function LineCheckCard({ store, onReport, onUndo, onClose }: Props) {
  const [report, setReport] = useState<LineReport | null>(null);
  const remaining = useAnimatedValue(1);

  useEffect(() => {
    if (report) {
      const id = setTimeout(onClose, THANKS_MS);
      return () => clearTimeout(id);
    }
    const countdown = Animated.timing(remaining, { toValue: 0, duration: AUTO_DISMISS_MS, useNativeDriver: false });
    countdown.start(({ finished }) => finished && onClose());
    return () => countdown.stop();
  }, [report, remaining, onClose]);

  if (report) {
    return (
      <View style={[styles.card, styles.thanks]}>
        <View style={[styles.badge, { backgroundColor: colors.orange }]}>
          <Icon name="check" size={20} color={colors.surface} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text weight="extrabold" size={15} tracking={-0.15}>
            Thanks! Line reported: {lineLabel(report.minutes)}
          </Text>
          <Text weight="semibold" size={12} color={colors.inkTertiary}>
            +{REPORT_XP} XP · live for the next 60 min
          </Text>
        </View>
        <Pressable
          onPress={() => {
            onUndo(report);
            onClose();
          }}
          hitSlop={8}
          accessibilityRole="button">
          <Text weight="bold" size={13} color={colors.orange}>
            Undo
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={[styles.badge, { backgroundColor: colors.orangeSoft }]}>
          <Icon name="pin" size={20} color={colors.orange} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text weight="extrabold" size={16} tracking={-0.16}>
            You’re at {store}
          </Text>
          <View style={styles.verified}>
            <Icon name="check" size={13} color={colors.success} />
            <Text weight="semibold" size={12} color={colors.success}>
              Location verified · just now
            </Text>
          </View>
        </View>
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
          <Icon name="close" size={20} color={colors.inkTertiary} />
        </Pressable>
      </View>
      <Text weight="extrabold" size={22} tracking={-0.44}>
        How long is the line?
      </Text>
      <View style={styles.options}>
        {LINE_OPTIONS.map((o) => (
          <Pressable
            key={o.label}
            onPress={() => setReport(onReport(o.minutes))}
            accessibilityRole="button"
            accessibilityLabel={`${o.label} minutes`}
            style={({ pressed }) => [styles.option, pressed && { backgroundColor: colors.orangeSoft }]}>
            <Text weight="extrabold" size={20} tracking={-0.6}>
              {o.label}
            </Text>
            <Text weight="semibold" size={11} color={colors.inkTertiary}>
              min
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.captions}>
        <Text size={11} color={colors.inkTertiary}>
          Under 10 min
        </Text>
        <Text size={11} color={colors.inkTertiary}>
          Over an hour
        </Text>
      </View>
      <View style={styles.footer}>
        <Icon name="zap" size={14} color={colors.orange} />
        <Text weight="bold" size={12} color={colors.inkSecondary} style={{ flex: 1 }}>
          +{REPORT_XP} XP · helps 40+ people nearby
        </Text>
        <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button">
          <Text weight="bold" size={13} color={colors.inkTertiary}>
            Skip
          </Text>
        </Pressable>
      </View>
      <View style={styles.timer}>
        <Animated.View
          style={[
            styles.timerFill,
            { width: remaining.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 14,
    padding: 16,
    borderRadius: 24,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    shadowColor: '#17171A',
    shadowOpacity: 0.18,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 10 },
  },
  thanks: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  badge: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  verified: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  options: { flexDirection: 'row', gap: 8 },
  option: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.muted,
  },
  captions: { flexDirection: 'row', justifyContent: 'space-between' },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  timer: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, backgroundColor: colors.muted },
  timerFill: { height: 4, backgroundColor: colors.orange },
});
