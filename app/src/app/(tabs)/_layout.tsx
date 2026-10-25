import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';

import { TabBar } from '@/components/tab-bar';
import { useStore } from '@/lib/store';
import { colors } from '@/theme';

// Saved and Leaderboard open from Profile but keep the tab bar (Profile stays active), as in Figma. TabBar only draws
// the six real tabs, so they need no `href: null` (which now hides a tab *and* redirects away from it). An account
// without a username picks one first, so friends can find it.
export default function TabsLayout() {
  const { needsUsername } = useStore();
  if (needsUsername) return <Redirect href="/onboarding/username" />;
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
      <Tabs.Screen name="saved" />
      <Tabs.Screen name="leaderboard" />
    </Tabs>
  );
}
