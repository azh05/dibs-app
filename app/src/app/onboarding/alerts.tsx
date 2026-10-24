import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Animated, Pressable, StyleSheet, useAnimatedValue, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import GlowBottom from '@/assets/shapes/glow-bottom.svg';
import GlowTop from '@/assets/shapes/glow-top.svg';
import { NotificationCard } from '@/components/notification-card';
import { Text } from '@/components/text';
import { findDeal, findEvent } from '@/lib/api';
import { clock } from '@/lib/format';
import { MOCK_DEALS } from '@/lib/mock';
import { alertBody } from '@/lib/notifications';
import { useNow } from '@/lib/use-now';
import { colors } from '@/theme';

// The lock screen preview: what alerts for the interests you picked look like, in the
// iOS notification format the app sends (store · deal · via source · store logo).
const NOTIFICATIONS = [
  ...[
    { id: 'tapioca-lab-bogo', time: 'now' },
    { id: 'polish-bar-gel', time: '4m ago' },
    { id: 'iron-pulse-month', time: '12m ago' },
  ].flatMap(({ id, time }) => {
    const deal = findDeal(MOCK_DEALS, id);
    return deal ? [{ title: deal.store, body: alertBody(deal), time, logo: deal.logo, icon: deal.icon }] : [];
  }),
  ...[findEvent('kda-chicha-popup')].flatMap((e) =>
    e
      ? [
          {
            title: e.store,
            body: `${e.title} ${e.startsAt.toLocaleDateString('en-US', { weekday: 'short' })} ${clock(e.startsAt)} · via Instagram`,
            time: '1h ago',
            logo: e.logo,
            icon: e.icon,
          },
        ]
      : [],
  ),
];

const STAGGER_MS = 350;
/** Move on by itself shortly after the last notification lands; a tap skips ahead. */
const AUTO_ADVANCE_MS = STAGGER_MS * NOTIFICATIONS.length + 3500;

function enterApp() {
  router.dismissAll();
  router.replace('/deals');
}

// 05 · Live alerts (Figma 28:980), onboarding step 3 of 3. Tap anywhere, or wait, to enter the app.
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
        <Text weight="semibold" size={20} color="rgba(255,255,255,0.75)">
          {now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </Text>
        <Text weight="bold" size={96} tracking={-2.88} color={colors.surface}>
          {now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/, '')}
        </Text>
      </View>

      <View style={styles.notifications}>
        {NOTIFICATIONS.map((n, i) => (
          <Notification key={n.title} notification={n} index={i} />
        ))}
      </View>

      <View style={[styles.tagline, { paddingBottom: insets.bottom + 22 }]}>
        <Text weight="extrabold" size={30} tracking={-0.9} color={colors.surface} style={[styles.center, { lineHeight: 34 }]}>
          Never miss out on a deal again.
        </Text>
        <Text size={14} color="rgba(255,255,255,0.7)" style={[styles.center, { lineHeight: 20 }]}>
          Live alerts for the things you care about, 24/7
        </Text>
      </View>
    </Pressable>
  );
}

function Notification({ notification, index }: { notification: (typeof NOTIFICATIONS)[number]; index: number }) {
  const enter = useAnimatedValue(0);

  useEffect(() => {
    Animated.spring(enter, { toValue: 1, delay: 300 + index * STAGGER_MS, useNativeDriver: true }).start();
  }, [enter, index]);

  return (
    <Animated.View
      style={{
        opacity: enter,
        transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) }],
      }}>
      <NotificationCard {...notification} />
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
  // Capped at the 393pt design width so the headline breaks as in Figma on wider phones.
  tagline: { marginTop: 'auto', gap: 8, paddingHorizontal: 32, alignSelf: 'center', maxWidth: 393 },
  center: { textAlign: 'center' },
});
