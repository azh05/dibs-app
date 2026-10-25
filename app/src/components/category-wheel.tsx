import { useEffect, useState } from 'react';
import { Animated, StyleSheet, useAnimatedValue, View } from 'react-native';

import { STORE_SECTIONS } from '@/lib/interests';
import { colors, fonts } from '@/theme';

/** Every store type, taking one from each section in turn so neighbours differ (Restaurants, Nails, Gyms…). */
const TYPES = (() => {
  const sections = STORE_SECTIONS.filter((s) => !s.adult).map((s) => s.interests.map((i) => i.label));
  const longest = Math.max(...sections.map((s) => s.length));
  return Array.from({ length: longest }, (_, i) => sections.flatMap((s) => (i < s.length ? [s[i]] : []))).flat();
})();

// Figma "Category Wheel" (89:3190): hidden, faded, centre, faded, hidden. The last slot is where
// the bottom item comes in from.
const SLOTS = [
  { top: -10, size: 13, opacity: 0 },
  { top: 8, size: 17, opacity: 0.45 },
  { top: 43, size: 30, opacity: 1 },
  { top: 92, size: 17, opacity: 0.45 },
  { top: 118, size: 13, opacity: 0 },
  { top: 136, size: 13, opacity: 0 },
];
const CENTER = 2;
const HOLD_MS = 500;
const MOVE_MS = 350;

/** Store types roll up one at a time on Welcome: each step holds 0.5 s, then slides to the next. */
export function CategoryWheel() {
  const [head, setHead] = useState(0);
  const step = useAnimatedValue(0);

  useEffect(() => {
    // Reset in the same commit that shifts the labels, so nothing jumps back for a frame.
    step.setValue(0);
    const move = Animated.sequence([
      Animated.delay(HOLD_MS),
      Animated.timing(step, { toValue: 1, duration: MOVE_MS, useNativeDriver: false }),
    ]);
    move.start(({ finished }) => {
      if (finished) setHead((h) => (h + 1) % TYPES.length);
    });
    return () => move.stop();
  }, [head, step]);

  return (
    <View style={styles.wheel} accessibilityLabel="Store types dibs watches">
      {SLOTS.map((slot, i) => {
        const to = SLOTS[Math.max(i - 1, 0)];
        const label = TYPES[(head + i - CENTER + TYPES.length) % TYPES.length];
        const range = { inputRange: [0, 1], extrapolate: 'clamp' as const };
        return (
          <Animated.Text
            key={i}
            numberOfLines={1}
            style={[
              styles.item,
              {
                fontFamily: i === CENTER ? fonts.extrabold : fonts.semibold,
                letterSpacing: i === CENTER ? -0.6 : 0,
                top: step.interpolate({ ...range, outputRange: [slot.top, to.top] }),
                fontSize: step.interpolate({ ...range, outputRange: [slot.size, to.size] }),
                opacity: step.interpolate({ ...range, outputRange: [slot.opacity, i === 0 ? 0 : to.opacity] }),
              },
            ]}>
            {label}
          </Animated.Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wheel: { height: 124, alignSelf: 'stretch', overflow: 'hidden' },
  item: { position: 'absolute', left: 0, color: colors.surface },
});
