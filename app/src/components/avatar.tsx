import { View, type StyleProp, type ViewStyle } from 'react-native';

import { Text } from '@/components/text';
import type { AvatarTone } from '@/lib/social';
import { colors } from '@/theme';

const TONES: Record<AvatarTone, { bg: string; fg: string }> = {
  ink: { bg: colors.ink, fg: colors.surface },
  orange: { bg: colors.orange, fg: colors.surface },
  soft: { bg: colors.orangeSoft, fg: colors.orange },
  muted: { bg: colors.muted, fg: colors.ink },
};

type Props = {
  initials: string;
  size: number;
  tone?: AvatarTone;
  /** Ring around the avatar (podium, profile). */
  ring?: { width: number; color: string };
  style?: StyleProp<ViewStyle>;
};

// Round initials avatar (Profile, Leaderboard, Friends); text is ~36% of the size.
export function Avatar({ initials, size, tone = 'muted', ring, style }: Props) {
  const { bg, fg } = TONES[tone];
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: bg,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: ring?.width ?? 0,
          borderColor: ring?.color,
        },
        style,
      ]}>
      <Text weight="extrabold" size={Math.round(size * 0.36)} color={fg}>
        {initials}
      </Text>
    </View>
  );
}
