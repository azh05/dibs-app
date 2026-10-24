import { View } from 'react-native';

import { Wordmark } from '@/components/wordmark';
import { colors } from '@/theme';

/** The orange dibs app icon on notifications: 38px, or a small badge on a store logo. */
export function AppIcon({ size = 38 }: { size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.225,
        backgroundColor: colors.orange,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Wordmark height={size * 0.398} color={colors.surface} dot="ink" />
    </View>
  );
}
