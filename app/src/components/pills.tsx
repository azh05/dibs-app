import { StyleSheet, View } from 'react-native';

import DotLive from '@/assets/shapes/dot-live.svg';
import DotSuccess from '@/assets/shapes/dot-success.svg';
import { Icon, type IconName } from '@/components/icon';
import { Text } from '@/components/text';
import { colors, radii } from '@/theme';

// Figma "Source Pill" (2:148): where a deal was found.
export function SourcePill({ icon, label }: { icon: IconName; label: string }) {
  return (
    <View style={[styles.pill, { backgroundColor: colors.muted }]}>
      <Icon name={icon} size={14} />
      <Text size={12} color={colors.inkSecondary}>
        {label}
      </Text>
    </View>
  );
}

const TONES = {
  orange: { bg: colors.orangeSoft, fg: colors.orange, Dot: DotLive },
  success: { bg: colors.muted, fg: colors.success, Dot: DotSuccess },
} as const;

// Dot + label pill: "Ends 6 PM", "Ends in 2h 14m", "Verified · +$5", "In review".
export function StatusPill({ label, tone = 'orange' }: { label: string; tone?: keyof typeof TONES }) {
  const { bg, fg, Dot } = TONES[tone];
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Dot width={6} height={6} />
      <Text weight="bold" size={12} color={fg}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.pill,
  },
});
