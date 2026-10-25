// Live deal alerts as real local notifications (Figma "6 · Notifications": lock screen, banner,
// expanded with Get Directions / Save / Remind Me). Store logos as the notification icon need
// iOS communication notifications, which Expo can't send, so the dibs icon stays.
import * as Notifications from 'expo-notifications';
import { Linking } from 'react-native';

import { clock, dayAndTime, shortAgo } from '@/lib/format';
import type { Deal, DealEvent } from '@/lib/types';

export const ACTIONS = { directions: 'directions', save: 'save', remind: 'remind' } as const;

/** "Ends Oct 24, 6 PM", or when it was posted if the end isn't known (Figma notifications' last line). */
export function dealWhen(deal: Deal) {
  return deal.endsAt ? `Ends ${dayAndTime(deal.endsAt)}` : `Posted ${shortAgo(deal.postedHoursAgo)} ago`;
}

/** The notification body and in-app previews: the deal, then when it ends ("BOGO milk tea\nEnds Oct 24, 6 PM"). */
export function alertBody(deal: Deal) {
  return `${deal.shortOffer}\n${dealWhen(deal)}`;
}

/** "KDA × Chicha pop-up\nStarts Oct 31, 12 PM" */
export function eventAlertBody(event: DealEvent) {
  return `${event.title}\nStarts ${dayAndTime(event.startsAt)}`;
}

/** Half an hour before the deal ends, or an hour from now when the end isn't known. */
export function reminderTime(deal: Deal, now = new Date()) {
  const before = deal.endsAt ? new Date(deal.endsAt.getTime() - 30 * 60000) : null;
  return before && before > now ? before : new Date(now.getTime() + 3600000);
}

export function configureNotifications() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/** Ask once; whatever the answer, alerts stay editable in the Alerts tab. */
export async function requestAlertPermission() {
  const { granted } = await Notifications.requestPermissionsAsync().catch(() => ({ granted: false }));
  return granted;
}

/** Each deal gets its own category so the remind button can say when ("Remind Me at 5:30 PM"). */
export async function sendDealAlert(deal: Deal, delaySeconds = 1) {
  const category = `deal-${deal.id}`;
  await Notifications.setNotificationCategoryAsync(category, [
    { identifier: ACTIONS.directions, buttonTitle: 'Get Directions' },
    { identifier: ACTIONS.save, buttonTitle: 'Save', options: { opensAppToForeground: false } },
    {
      identifier: ACTIONS.remind,
      buttonTitle: `Remind Me at ${clock(reminderTime(deal))}`,
      options: { opensAppToForeground: false },
    },
  ]);
  return Notifications.scheduleNotificationAsync({
    content: { title: deal.store, body: alertBody(deal), data: { dealId: deal.id }, categoryIdentifier: category },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: delaySeconds },
  });
}

export async function scheduleReminder(deal: Deal) {
  return Notifications.scheduleNotificationAsync({
    content: { title: `Reminder · ${deal.store}`, body: `${deal.shortOffer}. Don't miss it.`, data: { dealId: deal.id } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: reminderTime(deal) },
  });
}

/** An hour before the event starts ("Remind me" on an upcoming event). */
export async function scheduleEventReminder(event: DealEvent) {
  const at = new Date(event.startsAt.getTime() - 3600000);
  if (at <= new Date() || !(await requestAlertPermission())) return null;
  return Notifications.scheduleNotificationAsync({
    content: { title: `${event.title} starts in an hour`, body: `${event.store} · ${event.area}`, data: { eventId: event.id } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at },
  });
}

export function openDirections(deal: Deal) {
  const q = deal.coords
    ? `daddr=${deal.coords.latitude},${deal.coords.longitude}`
    : `daddr=${encodeURIComponent(deal.address ?? deal.store)}`;
  return Linking.openURL(`https://maps.apple.com/?${q}&dirflg=w`);
}
