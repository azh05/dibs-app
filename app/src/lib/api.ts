// Deals for the screens: the Convex feed (convex/deals.ts) in backend mode, mock data otherwise.
// The app never calls the Dibs API itself; Convex does (see app/convex/scans.ts).
import { useQuery } from 'convex/react';
import { useMemo } from 'react';

import { api } from '@convex/_generated/api';
import type { IconName } from '@/components/icon';
import { usingBackend } from '@/lib/backend';
import { isEvent, splitFeed, storeTypeLabel, toDeal, toEvent } from '@/lib/feed';
import { interestIcon } from '@/lib/interests';
import { distanceMeters } from '@/lib/line-check';
import { MOCK_DEALS, MOCK_EVENTS } from '@/lib/mock';
import { useStore } from '@/lib/store';
import type { ApiDeal, Deal, DealEvent } from '@/lib/types';

/** The API's coarse categories, placed on the closest store type in the interest catalog. */
export const CATEGORY: Record<ApiDeal['category'], { storeType: string; label: string; icon: IconName }> = {
  food: { storeType: 'Restaurants', label: 'Food', icon: 'food' },
  drink: { storeType: 'Boba & tea', label: 'Drinks', icon: 'boba' },
  retail: { storeType: 'Convenience stores', label: 'Retail', icon: 'cart' },
  entertainment: { storeType: 'Movies', label: 'Entertainment', icon: 'zap' },
  beauty: { storeType: 'Hair & barbers', label: 'Beauty', icon: 'scissors' },
  fitness: { storeType: 'Gyms', label: 'Fitness', icon: 'dumbbell' },
  other: { storeType: 'Restaurants', label: 'Local', icon: 'tag' },
};

/** The feed covers 5 miles; the Filters distance narrows it on the device. */
const FEED_RADIUS_MILES = 5;

type DealsState = { deals: Deal[]; events: DealEvent[]; loading: boolean; error: string | null };

function useBackendDeals(): DealsState {
  const { place } = useStore();
  const views = useQuery(api.deals.feed, {
    lat: place.coords.latitude,
    lng: place.coords.longitude,
    radius_miles: FEED_RADIUS_MILES,
    scan_area_key: place.areaKey ?? undefined,
  });
  return useMemo(
    () => ({ ...(views ? splitFeed(views, place.coords) : { deals: [], events: [] }), loading: views === undefined, error: null }),
    [views, place.coords],
  );
}

function useMockDeals(): DealsState {
  return { deals: MOCK_DEALS, events: MOCK_EVENTS, loading: false, error: null };
}

export const useDeals: () => DealsState = usingBackend ? useBackendDeals : useMockDeals;

export function findDeal(deals: Deal[], id: string) {
  return deals.find((d) => d.id === id) ?? MOCK_DEALS.find((d) => d.id === id);
}

export function findEvent(id: string) {
  return MOCK_EVENTS.find((e) => e.id === id);
}

function useBackendDeal(id: string): { deal: Deal | undefined; loading: boolean } {
  const { place } = useStore();
  const view = useQuery(api.deals.get, { id });
  return useMemo(() => ({ deal: view ? toDeal(view, place.coords) : undefined, loading: view === undefined }), [view, place.coords]);
}

function useMockDeal(id: string) {
  const { deals } = useMockDeals();
  return { deal: findDeal(deals, id), loading: false };
}

/** One deal by id, also when it isn't in the current feed (e.g. opened from an alert). */
export const useDeal: (id: string) => { deal: Deal | undefined; loading: boolean } = usingBackend ? useBackendDeal : useMockDeal;

function useBackendEvent(id: string): { event: DealEvent | undefined; loading: boolean } {
  const { place } = useStore();
  const view = useQuery(api.deals.get, { id });
  return useMemo(
    () => ({ event: view && isEvent(view) ? toEvent(view, place.coords) : undefined, loading: view === undefined }),
    [view, place.coords],
  );
}

function useMockEvent(id: string) {
  return { event: findEvent(id), loading: false };
}

export const useEvent: (id: string) => { event: DealEvent | undefined; loading: boolean } = usingBackend ? useBackendEvent : useMockEvent;

function useBackendSpots(): number | null {
  const { place } = useStore();
  return useQuery(api.deals.spotsWatched, place.areaKey ? { scan_area_key: place.areaKey } : 'skip') ?? null;
}

/** "Watching N spots near you": stores the agents know in the area. */
export const useSpotsWatched: () => number | null = usingBackend ? useBackendSpots : () => 1284;

export type FollowedStore = { key: string; name: string; icon: IconName; meta: string; deal?: Deal };

type SavedState = { deals: Deal[]; events: DealEvent[]; stores: FollowedStore[] };

function useBackendSaved(): SavedState {
  const { place } = useStore();
  const saved = useQuery(api.saves.saved);
  const follows = useQuery(api.prefs.followedStores);
  return useMemo(() => {
    const { deals, events } = splitFeed(saved ?? [], place.coords);
    const stores = (follows ?? []).map((s) => {
      const label = storeTypeLabel(s.store_type);
      const miles =
        s.lat != null && s.lng != null
          ? Math.round((distanceMeters(place.coords, { latitude: s.lat, longitude: s.lng }) / 1609.344) * 10) / 10
          : null;
      const meta = [label.split(' & ')[0], miles != null && `${miles} mi`, s.active_deals && `${s.active_deals} live`]
        .filter(Boolean)
        .join(' · ');
      return { key: s.id, name: s.name, icon: interestIcon(label), meta };
    });
    return { deals, events, stores };
  }, [saved, follows, place.coords]);
}

function useMockSaved(): SavedState {
  const { saved, followed } = useStore();
  return {
    deals: MOCK_DEALS.filter((d) => saved.has(d.id)),
    events: MOCK_EVENTS.filter((e) => saved.has(e.id)),
    stores: [...followed].map((name) => {
      const deal = MOCK_DEALS.find((d) => d.store === name);
      return { key: name, name, icon: deal?.icon ?? 'store', meta: deal ? `${deal.typeLabel} · ${deal.distanceMi} mi` : 'Following', deal };
    }),
  };
}

/** The Saved screen: saved deals and events (expired ones too) and followed stores. */
export const useSaved: () => SavedState = usingBackend ? useBackendSaved : useMockSaved;
