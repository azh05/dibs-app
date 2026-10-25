import { Tabs } from 'expo-router/js-tabs';

import { TabBar } from '@/components/tab-bar';
import { colors } from '@/theme';

// Saved and Leaderboard open from Profile but keep the tab bar (Profile stays active), as in Figma.
export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      backBehavior="history"
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.surface } }}>
      <Tabs.Screen name="deals" />
      <Tabs.Screen name="map" />
      <Tabs.Screen name="friends" />
      <Tabs.Screen name="earn" />
      <Tabs.Screen name="alerts" />
      <Tabs.Screen name="profile" />
      <Tabs.Screen name="saved" options={{ href: null }} />
      <Tabs.Screen name="leaderboard" options={{ href: null }} />
    </Tabs>
  );
}
