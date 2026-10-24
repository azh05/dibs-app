import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Animated, StyleSheet, useAnimatedValue, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import DotWelcome from '@/assets/shapes/dot-welcome.svg';
import { Button } from '@/components/button';
import { Text } from '@/components/text';
import { Wordmark } from '@/components/wordmark';
import { colors } from '@/theme';

// 01 · Welcome (Figma 3:97), onboarding step 1 of 3.
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

  const signUp = () => router.push('/onboarding/interests');
  const signIn = () => router.replace('/deals');

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 24) + 24 }]}>
      <StatusBar style="light" />
      <View style={styles.hero}>
        <Wordmark height={113.4} color={colors.surface} dot="ink" />
        <Text weight="extrabold" size={36} tracking={-1.08} color={colors.surface} style={{ lineHeight: 40 }}>
          Never miss out on a deal again.
        </Text>
        <Text weight="semibold" size={17} color={colors.orangeSoft} style={{ lineHeight: 24 }}>
          Your personal AI agent runs 24/7 and pings you the second a deal you care about drops.
        </Text>
        <View style={styles.scanning}>
          <Animated.View style={{ opacity: pulse }}>
            <DotWelcome width={8} height={8} />
          </Animated.View>
          <Text weight="semibold" size={13} color={colors.surface}>
            Watching 1,284 spots near you · 24/7
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        <Button label="Find deals near me" variant="dark" onPress={signUp} style={styles.cta} />
        <Button label="I already have an account" variant="ghost" onPress={signIn} style={styles.cta} />
        <Text size={12} color={colors.orangeSoft} style={{ textAlign: 'center' }}>
          We only read public posts. No store pays to be in your feed.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.orange, paddingHorizontal: 28 },
  hero: { flex: 1, justifyContent: 'center', alignItems: 'flex-start', gap: 20 },
  scanning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  actions: { gap: 12 },
  cta: { paddingVertical: 17 },
});
