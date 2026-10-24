import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Animated, Pressable, StyleSheet, useAnimatedValue, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import GlowBottom from '@/assets/shapes/glow-bottom.svg';
import GlowTop from '@/assets/shapes/glow-top.svg';
import { AppIcon } from '@/components/app-icon';
import { Text } from '@/components/text';
import { useNow } from '@/lib/use-now';
import { colors } from '@/theme';

// The lock screen preview: what alerts for the interests you picked look like.
const NOTIFICATIONS = [
  { label: 'BOBA · 0.3 MI', ago: 'now', title: 'BOGO milk tea · Tapioca Lab', body: 'Ends 6 PM' },
  { label: 'NAILS · 0.4 MI', ago: '4m', title: '30% OFF gel manis · Polish Bar', body: 'Today only' },
  { label: 'GYMS · 0.8 MI', ago: '12m', title: '1st month FREE · Iron Pulse', body: 'Students only' },
  { label: 'UPCOMING · SAWTELLE', ago: '1h', title: 'KDA × Chicha · Sat 12 PM', body: 'Pop-up drop', upcoming: true },
];

const STAGGER_MS = 350;
/** Move on by itself shortly after the last notification lands; a tap skips ahead. */
const AUTO_ADVANCE_MS = STAGGER_MS * NOTIFICATIONS.length + 3500;

function enterApp() {
  router.dismissAll();
  router.replace('/deals');
}

// 03 · Live alerts (Figma 28:980), onboarding step 3 of 3.
export default function LiveAlerts() {
  const insets = useSafeAreaInsets();
  const now = useNow(10000);

  useEffect(() => {
    const id = setTimeout(enterApp, AUTO_ADVANCE_MS);
    return () => clearTimeout(id);
  }, []);

  return (
    <Pressable style={styles.screen} onPress={enterApp} accessibilityRole="button" accessibilityLabel="Continue to deals">
      <StatusBar style="light" />
      <GlowTop width={840} height={840} style={styles.glowTop} />
      <GlowBottom width={640} height={640} style={styles.glowBottom} />

      <View style={[styles.clock, { marginTop: insets.top + 32 }]}>
        <Text weight="semibold" size={17} color="rgba(255,255,255,0.75)">
          {now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </Text>
        <Text weight="bold" size={92} tracking={-2.76} color={colors.surface}>
          {now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/, '')}
        </Text>
      </View>

      <View style={styles.notifications}>
        {NOTIFICATIONS.map((n, i) => (
          <Notification key={n.title} {...n} index={i} />
        ))}
      </View>

      <View style={[styles.tagline, { paddingBottom: insets.bottom + 22 }]}>
        <Text weight="extrabold" size={30} tracking={-0.9} color={colors.surface} style={[styles.center, { lineHeight: 34 }]}>
          Never miss out on a deal again.
        </Text>
        <Text size={14} color="rgba(255,255,255,0.7)" style={[styles.center, { lineHeight: 20 }]}>
          Live alerts for the things you picked. Edit them anytime.
        </Text>
      </View>
    </Pressable>
  );
}

function Notification({
  label,
  ago,
  title,
  body,
  upcoming = false,
  index,
}: (typeof NOTIFICATIONS)[number] & { index: number }) {
  const enter = useAnimatedValue(0);

  useEffect(() => {
    Animated.spring(enter, { toValue: 1, delay: 300 + index * STAGGER_MS, useNativeDriver: true }).start();
  }, [enter, index]);

  return (
    <Animated.View
      style={[
        styles.card,
        {
          // Each card down the stack is a little fainter, as on the lock screen.
          opacity: enter.interpolate({ inputRange: [0, 1], outputRange: [0, 1 - index * 0.05] }),
          transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) }],
        },
      ]}>
      <AppIcon />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={styles.cardHeader}>
          <Text
            weight="extrabold"
            size={10}
            tracking={0.6}
            color={upcoming ? colors.orange : 'rgba(255,255,255,0.6)'}>
            {label}
          </Text>
          <Text size={12} color="rgba(255,255,255,0.55)">
            {ago}
          </Text>
        </View>
        <Text weight="extrabold" size={16} color={colors.surface}>
          {title}
        </Text>
        <Text size={13} color="rgba(255,255,255,0.75)">
          {body}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink, overflow: 'hidden' },
  // Figma places the 520px and 360px glows; their blurred SVGs are 840 and 640 square around them.
  glowTop: { position: 'absolute', left: -224, top: -460 },
  glowBottom: { position: 'absolute', left: -20, bottom: -288 },
  clock: { alignItems: 'center' },
  notifications: { marginTop: 77, marginHorizontal: 16, gap: 8 },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 14,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.13)',
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  // Capped at the 393pt design width so the headline breaks as in Figma on wider phones.
  tagline: { marginTop: 'auto', gap: 8, paddingHorizontal: 32, alignSelf: 'center', maxWidth: 393 },
  center: { textAlign: 'center' },
});
