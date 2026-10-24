import { View } from 'react-native';

import { Wordmark } from '@/components/wordmark';
import { colors } from '@/theme';

/** The 38px orange dibs app icon shown on push notifications. */
export function AppIcon() {
  return (
    <View
      style={{
        width: 38,
        height: 38,
        borderRadius: 10,
        backgroundColor: colors.orange,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Wordmark height={15.12} color={colors.surface} dot="ink" />
    </View>
  );
}
