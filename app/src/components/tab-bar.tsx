import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, type IconName } from '@/components/icon';
import { Text } from '@/components/text';
import { colors } from '@/theme';

const TABS: Record<string, { label: string; icon: IconName }> = {
  deals: { label: 'Deals', icon: 'tag' },
  map: { label: 'Map', icon: 'map' },
  friends: { label: 'Friends', icon: 'users' },
  earn: { label: 'Earn', icon: 'camera' },
  alerts: { label: 'Alerts', icon: 'bell' },
  profile: { label: 'Profile', icon: 'user' },
};

/** Screens without their own tab light up the tab they're opened from. */
const PARENT_TAB: Record<string, string> = { saved: 'profile', leaderboard: 'profile' };

// Figma "Tab Bar" (2:193): active tab is orange, the rest tertiary grey.
export function TabBar({ state, emitter, navigateToTab, insets }: BottomTabBarProps) {
  const current = state.routes[state.index].name;
  const active = PARENT_TAB[current] ?? current;
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      {state.routes.map((route) => {
        const tab = TABS[route.name];
        if (!tab) return null;
        const focused = route.name === active;
        const color = focused ? colors.orange : colors.inkTertiary;
        const onPress = () => {
          const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (route.name !== current && !event.defaultPrevented) navigateToTab(route.key);
        };
        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={tab.label}
            style={styles.item}>
            <Icon name={tab.icon} size={24} color={color} />
            <Text weight="semibold" size={11} color={color}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 10,
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  item: { width: 58, alignItems: 'center', gap: 4 },
});
