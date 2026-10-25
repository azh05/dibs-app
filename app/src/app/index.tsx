import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Animated, Pressable, StyleSheet, useAnimatedValue, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import DotWelcome from '@/assets/shapes/dot-welcome.svg';
import { CategoryWheel } from '@/components/category-wheel';
import { Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { Wordmark } from '@/components/wordmark';
import { colors } from '@/theme';

// 01 · Welcome (Figma 3:97). Both buttons lead to Sign in, as in the prototype.
export default function Welcome() {
  const insets = useSafeAreaInsets();
  const pulse = useAnimatedValue(1);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.3, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const signIn = () => router.push('/onboarding/sign-in');

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 24) + 24 }]}>
      <StatusBar style="light" />
      <View style={styles.hero}>
        <Wordmark height={113.4} color={colors.surface} dot="ink" />
        <Text weight="extrabold" size={36} tracking={-1.08} color={colors.surface} style={{ lineHeight: 40 }}>
          Never miss out on a deal again.
        </Text>
        <Text weight="semibold" size={17} color={colors.orangeSoft} style={{ lineHeight: 24 }}>
          Your personal AI agent that runs 24/7 and pings you the second something drops.
        </Text>
      </View>
      <View style={styles.wheelZone}>
        <CategoryWheel />
      </View>
      <View style={styles.actions}>
        <View style={styles.scanning}>
          <Animated.View style={{ opacity: pulse }}>
            <DotWelcome width={8} height={8} />
          </Animated.View>
          <Text weight="semibold" size={13} color={colors.surface}>
            Watching{' '}
            <Text weight="extrabold" size={13} color={colors.surface}>
              1,284
            </Text>{' '}
            spots near you
          </Text>
        </View>
        <Pressable
          onPress={signIn}
          accessibilityRole="button"
          style={({ pressed }) => [styles.primary, pressed && { opacity: 0.9 }]}>
          <Icon name="navigation" size={20} color={colors.orange} />
          <Text weight="extrabold" size={17}>
            Find deals near me
          </Text>
          <Icon name="arrow" size={20} color={colors.orange} />
        </Pressable>
        <Pressable onPress={signIn} accessibilityRole="button" style={styles.secondary}>
          <Text weight="bold" size={15} color={colors.surface}>
            I already have an account
          </Text>
        </Pressable>
        <Text size={12} color={colors.orangeSoft} style={{ textAlign: 'center' }}>
          We only read public posts. No store pays to be in your feed.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.orange, paddingHorizontal: 28 },
  hero: { paddingTop: 68, alignItems: 'flex-start', gap: 20 },
  wheelZone: { flex: 1, justifyContent: 'center' },
  scanning: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  actions: { gap: 14 },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 20,
    borderRadius: 18,
    backgroundColor: colors.surface,
    shadowColor: '#8C2605',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 10 },
  },
  secondary: { alignItems: 'center', paddingVertical: 10 },
});
