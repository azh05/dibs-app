import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';

import { findDeal, useDeals } from '@/lib/api';
import { ACTIONS, configureNotifications, scheduleReminder } from '@/lib/notifications';
import { useStore } from '@/lib/store';

configureNotifications();

/** Routes taps on alerts: a deal alert and "Get Directions" open the deal (as in the prototype),
 *  "Save" saves it, "Remind Me" schedules a reminder; event reminders open the event. */
export function useNotificationActions() {
  const { deals } = useDeals();
  const store = useStore();
  const latest = useRef({ deals, store });

  useEffect(() => {
    latest.current = { deals, store };
  });

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const { dealId, eventId } = response.notification.request.content.data ?? {};
      if (typeof eventId === 'string') {
        router.push(`/event/${eventId}`);
        return;
      }
      const { deals: current, store: s } = latest.current;
      const deal = typeof dealId === 'string' ? findDeal(current, dealId) : undefined;
      if (!deal) return;
      if (response.actionIdentifier === ACTIONS.save) {
        if (!s.saved.has(deal.id)) s.toggleSaved(deal.id);
      } else if (response.actionIdentifier === ACTIONS.remind) {
        scheduleReminder(deal).catch(() => undefined);
      } else {
        router.push(`/deal/${deal.id}`);
      }
    });
    return () => subscription.remove();
  }, []);
}
