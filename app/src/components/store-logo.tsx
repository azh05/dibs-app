import { View } from 'react-native';

import { Icon, type IconName } from '@/components/icon';
import type { StoreLogo as Logo } from '@/lib/types';
import { colors } from '@/theme';

/** Stores without a brand colour (e.g. from the API) get the orange-soft category tile. */
const FALLBACK: Logo = { bg: colors.orangeSoft, fg: colors.orange };

// Figma "Store Logo" (65:2122…): the store's brand colour behind its category icon,
// 38px with an 8px radius; the icon is 21/38 of the tile.
export function StoreLogo({ logo, icon, size = 38 }: { logo: Logo | null; icon: IconName; size?: number }) {
  const { bg, fg } = logo ?? FALLBACK;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * (8 / 38),
        backgroundColor: bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Icon name={icon} size={size * (21 / 38)} color={fg} />
    </View>
  );
}
