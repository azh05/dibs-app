import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { colors } from '@/theme';

// Figma "21+ note" (101:2392): under Nightlife on Pick interests and in Filters once it's unlocked.
export function AdultNote() {
  return (
    <View style={styles.note}>
      <Icon name="info" size={16} color={colors.orange} />
      <Text weight="semibold" size={12} color={colors.inkSecondary} style={{ flex: 1 }}>
        Note: you must be 21+ to enter these locations.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.orangeSoft,
  },
});
