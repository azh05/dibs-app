import { Pressable, StyleSheet, View } from 'react-native';

import { AppIcon } from '@/components/app-icon';
import type { IconName } from '@/components/icon';
import { StoreLogo } from '@/components/store-logo';
import { Text } from '@/components/text';
import type { StoreLogo as Logo } from '@/lib/types';
import { colors } from '@/theme';

type Props = {
  title: string;
  body: string;
  time: string;
  logo: Logo | null;
  icon: IconName;
  /**
   * light: the iOS notification on Live alerts (app icon left, store logo right).
   * dark: the Alerts preview (store logo left with a dibs badge, as on the lock screen).
   */
  tone?: 'light' | 'dark';
  onPress?: () => void;
};

// Figma "iOS Notification" (65:2147) and the Alerts push preview.
export function NotificationCard({ title, body, time, logo, icon, tone = 'light', onPress }: Props) {
  const dark = tone === 'dark';
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={[styles.card, dark ? styles.dark : styles.light]}>
      {dark ? (
        <View>
          <StoreLogo logo={logo} icon={icon} />
          <View style={styles.badge}>
            <AppIcon size={16} />
          </View>
        </View>
      ) : (
        <AppIcon />
      )}
      <View style={styles.content}>
        <View style={styles.titleRow}>
          <Text weight="bold" size={15} color={dark ? colors.surface : '#000000'} style={{ flex: 1 }} numberOfLines={1}>
            {title}
          </Text>
          <Text size={13} color={dark ? colors.inkTertiary : 'rgba(60,60,67,0.6)'}>
            {time}
          </Text>
        </View>
        <Text size={15} color={dark ? colors.border : '#000000'} numberOfLines={2}>
          {body}
        </Text>
      </View>
      {!dark && <StoreLogo logo={logo} icon={icon} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 13 },
  light: { borderRadius: 23, backgroundColor: 'rgba(245,245,245,0.78)' },
  dark: { borderRadius: 22, backgroundColor: colors.ink },
  badge: { position: 'absolute', right: -4, bottom: -4, borderRadius: 5, borderWidth: 1.5, borderColor: colors.ink },
  content: { flex: 1, gap: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
