import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { colors } from '@/theme';

/** Create account is step 1, Pick interests step 2, Live alerts step 3. */
export const ONBOARDING_STEPS = 3;

// Back arrow, segmented progress bar and "n of 3" at the top of the onboarding forms.
export function OnboardingProgress({ step }: { step?: number }) {
  return (
    <View style={styles.row}>
      <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
        <Icon name="back" size={22} />
      </Pressable>
      {step != null && (
        <>
          <View style={styles.bars}>
            {Array.from({ length: ONBOARDING_STEPS }, (_, i) => (
              <View key={i} style={[styles.bar, { backgroundColor: i < step ? colors.orange : colors.border }]} />
            ))}
          </View>
          <Text weight="bold" size={12} color={colors.inkTertiary}>
            {step} of {ONBOARDING_STEPS}
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  bars: { flex: 1, flexDirection: 'row', gap: 6 },
  bar: { flex: 1, height: 5, borderRadius: 3 },
});
