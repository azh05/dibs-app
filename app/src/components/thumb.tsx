import { View } from 'react-native';

import { Icon, type IconName } from '@/components/icon';
import { colors } from '@/theme';

type Props = {
  icon: IconName;
  /** 44 for deal/activity rows, 40 for submissions, 56 for the upload tile. */
  size?: number;
  tone?: 'orange' | 'muted';
};

// Rounded square with a category icon (radius is 32% of the size, as in Figma).
export function Thumb({ icon, size = 44, tone = 'orange' }: Props) {
  const orange = tone === 'orange';
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.32,
        backgroundColor: orange ? colors.orangeSoft : colors.muted,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Icon name={icon} size={size / 2} color={orange ? colors.orange : colors.ink} />
    </View>
  );
}
