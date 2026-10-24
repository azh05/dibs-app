import { View } from 'react-native';

import { colors } from '@/theme';

type Props = { value: number; height?: number; track?: string; fill?: string };

/** Rounded bar filled to `value` (0–1): XP, weekly challenge, line check countdown. */
export function ProgressBar({ value, height = 8, track = colors.muted, fill = colors.orange }: Props) {
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: track, overflow: 'hidden' }}>
      <View
        style={{
          width: `${Math.min(1, Math.max(0, value)) * 100}%`,
          height,
          borderRadius: height / 2,
          backgroundColor: fill,
        }}
      />
    </View>
  );
}
