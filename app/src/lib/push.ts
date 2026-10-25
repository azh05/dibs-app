// Remote push: this device's Expo push token, sent to Convex (prefs.registerDevice). Convex sends alerts through
// Expo's push service. Needs an EAS projectId (`npx eas-cli@latest init`) and, on Android, a development build.
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { ACTIONS } from '@/lib/notifications';

/** The category Convex puts on deal alerts (convex/notify.ts DEAL_ALERT_CATEGORY). */
export const DEAL_ALERT_CATEGORY = 'deal-alert';

export async function registerForPush(): Promise<{ push_token: string; platform: 'ios' | 'android' } | null> {
  if (!Device.isDevice && Platform.OS === 'android') return null;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return null;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', { name: 'Deal alerts', importance: 4 }); // AndroidImportance.HIGH
  }
  const { granted } = await Notifications.getPermissionsAsync();
  if (!granted) return null; // asked during onboarding ("Turn on live alerts")
  await Notifications.setNotificationCategoryAsync(DEAL_ALERT_CATEGORY, [
    { identifier: ACTIONS.directions, buttonTitle: 'Get Directions' },
    { identifier: ACTIONS.save, buttonTitle: 'Save', options: { opensAppToForeground: false } },
    { identifier: ACTIONS.remind, buttonTitle: 'Remind Me', options: { opensAppToForeground: false } },
  ]);
  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  return { push_token: token.data, platform: Platform.OS === 'android' ? 'android' : 'ios' };
}
