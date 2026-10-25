import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { errorText } from '@/lib/backend';
import { currentPlace, NEIGHBORHOODS } from '@/lib/location';
import { useStore, type NewPlace } from '@/lib/store';
import { colors, gutter, radii } from '@/theme';

// Change location (the Deals header's "Westwood, LA ▾"): the feed, map and alerts follow this place, and the
// agents start scanning a new area within minutes.
export default function ChangeLocation() {
  const insets = useSafeAreaInsets();
  const { place, savePlace } = useStore();
  const [busy, setBusy] = useState<string | null>(null);

  const choose = async (key: string, get: () => Promise<NewPlace | null>) => {
    setBusy(key);
    try {
      const next = await get();
      if (!next) {
        Alert.alert('Location is off', 'Allow location access, or pick a neighbourhood below.');
        return;
      }
      await savePlace(next);
      router.back();
    } catch (e) {
      Alert.alert('Couldn’t change location', errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text weight="extrabold" size={26} tracking={-0.78} style={{ flex: 1 }}>
            Where should we look?
          </Text>
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
            <Icon name="close" size={22} />
          </Pressable>
        </View>
        <Text size={14} color={colors.inkSecondary}>
          Deals, the map and alerts follow this place. Now: {place.label}.
        </Text>
        <Button
          label={busy === 'gps' ? 'Finding you…' : 'Use my current location'}
          icon="navigation"
          onPress={() => choose('gps', currentPlace)}
          disabled={busy !== null}
        />
        <Text weight="extrabold" size={16} tracking={-0.16} style={{ marginTop: 8 }}>
          Neighbourhoods
        </Text>
        {NEIGHBORHOODS.map((n) => (
          <Pressable
            key={n.label}
            onPress={() => choose(n.label, async () => n)}
            disabled={busy !== null}
            accessibilityRole="button"
            style={styles.row}>
            <Icon name="pin" size={18} color={colors.orange} />
            <Text weight="bold" size={15} style={{ flex: 1 }}>
              {n.label}
            </Text>
            {busy === n.label ? (
              <ActivityIndicator color={colors.orange} />
            ) : (
              place.label === n.label && <Icon name="check" size={18} color={colors.success} />
            )}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { gap: 14, paddingHorizontal: gutter, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
