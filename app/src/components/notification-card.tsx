import { Pressable, Text as SystemText, StyleSheet, View } from 'react-native';

import { AppIcon } from '@/components/app-icon';
import type { IconName } from '@/components/icon';
import { StoreLogo } from '@/components/store-logo';
import { Text } from '@/components/text';
import type { StoreLogo as Logo } from '@/lib/types';
import { colors } from '@/theme';

type Props = {
  title: string;
  /** The deal, then optionally "\n" and when it ends or starts ("Ends Oct 24, 6 PM"). */
  body: string;
  time: string;
  logo: Logo | null;
  icon: IconName;
  /**
   * light: the iOS notification on Live alerts.
   * dark: the push preview on Alerts.
   * Both put the dibs app icon on the left and the store logo on the right.
   */
  tone?: 'light' | 'dark';
  onPress?: () => void;
};

// Figma "iOS Notification" (65:2147) and the Alerts "Push notification" (5:579).
export function NotificationCard({ title, body, time, logo, icon, tone = 'light', onPress }: Props) {
  const dark = tone === 'dark';
  const [lead, ...rest] = body.split('\n');
  const meta = rest.join(' · ');
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={[styles.card, dark ? styles.dark : styles.light]}>
      <AppIcon />
      {dark ? (
        <View style={[styles.content, { gap: 3 }]}>
          <View style={styles.titleRow}>
            <Text weight="bold" size={14} color={colors.surface} style={{ flex: 1 }} numberOfLines={1}>
              {title}
            </Text>
            <Text size={12} color={colors.inkTertiary}>
              {time}
            </Text>
          </View>
          <Text size={13} color={colors.border} style={{ lineHeight: 18 }} numberOfLines={1}>
            {lead}
          </Text>
          {meta !== '' && (
            // Figma sets the push's "Ends …" line in the system font (Inter), like iOS does.
            <SystemText style={styles.darkMeta} numberOfLines={1}>
              {meta}
            </SystemText>
          )}
        </View>
      ) : (
        // iOS draws notifications in the system font (Inter in Figma): deal, then a smaller "Ends …" line.
        <View style={styles.content}>
          <View style={styles.titleRow}>
            <SystemText style={[styles.ios, styles.iosTitle]} numberOfLines={1}>
              {title}
            </SystemText>
            <SystemText style={styles.iosTime}>{time}</SystemText>
          </View>
          <SystemText style={styles.ios} numberOfLines={1}>
            {lead}
          </SystemText>
          {meta !== '' && (
            <SystemText style={styles.iosMeta} numberOfLines={1}>
              {meta}
            </SystemText>
          )}
        </View>
      )}
      <StoreLogo logo={logo} icon={icon} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 13 },
  light: { borderRadius: 23, backgroundColor: 'rgba(245,245,245,0.78)' },
  dark: { alignItems: 'flex-start', gap: 12, padding: 14, borderRadius: 22, backgroundColor: colors.ink },
  content: { flex: 1, gap: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ios: { fontSize: 15, letterSpacing: -0.15, color: '#000000' },
  iosTitle: { flex: 1, fontWeight: '600' },
  iosTime: { fontSize: 13, color: 'rgba(60,60,67,0.6)' },
  iosMeta: { fontSize: 14, letterSpacing: -0.14, color: '#000000', paddingTop: 2 },
  darkMeta: { fontSize: 14, letterSpacing: -0.14, color: 'rgba(255,255,255,0.75)', paddingTop: 2 },
});
