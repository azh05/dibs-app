import { Tabs } from 'expo-router/js-tabs';

import { TabBar } from '@/components/tab-bar';
import { colors } from '@/theme';

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.surface } }}>
      <Tabs.Screen name="deals" />
      <Tabs.Screen name="map" />
      <Tabs.Screen name="earn" />
      <Tabs.Screen name="alerts" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
