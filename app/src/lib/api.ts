// Deals for the screens, from one of three places:
// - backend mode (Convex + Clerk keys set): the Convex feed (convex/deals.ts); Convex calls the Dibs API.
// - EXPO_PUBLIC_API_URL set without the backend: the Dibs API directly (/extract/search for the feed).
// - neither: mock data.
// Independently of the feed, EXPO_PUBLIC_API_URL turns on the API's Elastic features: search (/search/deals) and
// "Ask dibs" (/agent/ask).
import { useQuery } from 'convex/react';
import { useEffect, useMemo, useState } from 'react';

import { api } from '@convex/_generated/api';
import type { IconName } from '@/components/icon';
import { usingBackend } from '@/lib/backend';
import { isEvent, splitFeed, storeTypeLabel, toDeal, toEvent } from '@/lib/feed';
import { interestIcon } from '@/lib/interests';
import { distanceMeters } from '@/lib/line-check';
import { HOME, MOCK_DEALS, MOCK_EVENTS } from '@/lib/mock';
import { useStore } from '@/lib/store';
import type { ApiDeal, ApiSearchResponse, Deal, DealEvent, DealTag } from '@/lib/types';
import { colors } from '@/theme';

export const API_URL = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');

export const usingLiveApi = Boolean(API_URL);

/** The API's shared key (DIBS_API_KEY), when it's set: sent as X-Dibs-Key on every call. */
const API_KEY = process.env.EXPO_PUBLIC_DIBS_API_KEY;

export function apiHeaders(json = true): Record<string, string> {
  return { ...(json ? { 'content-type': 'application/json' } : {}), ...(API_KEY ? { 'x-dibs-key': API_KEY } : {}) };
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { method: 'POST', headers: apiHeaders(), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

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

const TAG_PATTERNS: [DealTag, RegExp][] = [
  ['BOGO', /\bbogo\b|buy one,? get one/i],
  ['% off', /\d+\s*%\s*off/i],
  ['Free stuff', /\bfree\b/i],
  ['Student deals', /\bstudents?\b|\.edu\b/i],
  ['Happy hour', /happy hour/i],
  ['Late night', /late[- ]night|after (9|10|11) ?pm/i],
  ['New openings', /grand opening|now open|new location/i],
];

/** Deal types read off the offer text, since the API doesn't tag them. */
function tagsFrom(text: string): DealTag[] {
  return TAG_PATTERNS.filter(([, re]) => re.test(text)).map(([tag]) => tag);
}

function daysSince(isoDate: string | null) {
  if (!isoDate) return 24 * 30;
  const posted = new Date(`${isoDate}T12:00:00`);
  return Math.max(0, (Date.now() - posted.getTime()) / 3600000);
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/** Map one verified API deal onto the shape the screens render. Location and distance are unknown. */
export function fromApiDeal(d: ApiDeal, index: number): Deal {
  const cat = CATEGORY[d.category] ?? CATEGORY.other; // a category added to the API later still renders
  const instagram = /instagram\.com/i.test(d.source_url);
  const endsAt = d.end_date ? new Date(`${d.end_date}T23:59:00`) : null;
  const postedHoursAgo = daysSince(d.source_post_date);
  return {
    id: d.id ?? `api-${index}-${d.shop_name.toLowerCase().replace(/\W+/g, '-')}`,
    store: d.shop_name,
    storeType: cat.storeType,
    typeLabel: cat.label,
    icon: cat.icon,
    logo: null,
    offer: d.offer,
    shortOffer: d.offer,
    tags: tagsFrom(`${d.offer} ${d.conditions.join(' ')}`),
    pinLabel: d.code ?? d.offer.split(' ').slice(0, 2).join(' '),
    distanceMi: null,
    coords: null,
    address: d.address,
    walk: null,
    openUntil: null,
    hours: null,
    endsAt,
    expiryLabel: d.status === 'needs_check' ? 'Needs check' : d.status === 'stale' ? 'May be over' : null,
    window: d.conditions.length
      ? { title: d.code ? `Code ${d.code}` : 'Conditions', subtitle: d.conditions.join(' · ') }
      : null,
    source: { kind: instagram ? 'instagram' : 'website', handle: d.shop_handle, url: d.source_url },
    postedHoursAgo,
    confirmations: 0,
    lastCheckMinutes: null,
    line: null,
    post: {
      author: d.shop_handle ?? d.shop_name,
      initials: initials(d.shop_name),
      avatarColor: colors.ink,
      postedAgo: '',
      headline: d.code ?? d.offer.split(' ').slice(0, 2).join(' ').toUpperCase(),
      subline: d.offer.toUpperCase(),
      caption: d.verbatim_quote,
      imageColor: colors.orange,
      sublineColor: colors.orangeSoft,
      headlineSize: 36,
    },
  };
}

async function searchDeals(): Promise<Deal[]> {
  const body = await postJson<ApiSearchResponse>('/extract/search', {
    location: { neighborhood: HOME.label.split(',')[0], city: 'Los Angeles', region: 'California' },
    radius_miles: 1,
    max_searches: 5,
  });
  return body.deals.filter((d) => d.status !== 'expired').map(fromApiDeal);
}

/** Deals that came from Elastic search or the agent, so their detail pages can find them. */
const seen = new Map<string, Deal>();

function remember(deals: Deal[]) {
  for (const d of deals) seen.set(d.id, d);
  return deals;
}

type Coords = { latitude: number; longitude: number };

/** Hybrid search over every indexed deal (meaning in any language + keywords + distance). */
export async function searchIndexedDeals(query: string, at: Coords, radiusMi: number): Promise<Deal[]> {
  const body = await postJson<{ deals: ApiDeal[] }>('/search/deals', {
    query,
    lat: at.latitude,
    lng: at.longitude,
    radius_miles: radiusMi,
  });
  return remember(body.deals.map(fromApiDeal));
}

export type AgentAnswer = { answer: string; conversationId: string | null; deals: Deal[] };

/** Ask the dibs agent (Elastic Agent Builder). It answers from the deal index and can watch for deals or scan an area. */
export async function askDibs(
  question: string,
  conversationId: string | null,
  at: Coords,
  pushToken: string | null,
): Promise<AgentAnswer> {
  const body = await postJson<{ answer: string; conversation_id: string | null; deals: ApiDeal[] }>('/agent/ask', {
    question,
    conversation_id: conversationId,
    lat: at.latitude,
    lng: at.longitude,
    push_token: pushToken,
  });
  return { answer: body.answer, conversationId: body.conversation_id, deals: remember(body.deals.map(fromApiDeal)) };
}

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

// One fetch per app session, shared by every screen.
let cache: Promise<Deal[]> | null = null;

function useApiDeals(): DealsState {
  const [state, setState] = useState<DealsState>({
    deals: usingLiveApi ? [] : MOCK_DEALS,
    events: MOCK_EVENTS,
    loading: usingLiveApi,
    error: null,
  });

  useEffect(() => {
    if (!usingLiveApi) return;
    let alive = true;
    cache ??= searchDeals();
    cache.then(
      (deals) => alive && setState((s) => ({ ...s, deals, loading: false })),
      (e: unknown) => {
        cache = null;
        if (alive) setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : String(e) }));
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  return state;
}

export const useDeals: () => DealsState = usingBackend ? useBackendDeals : usingLiveApi ? useApiDeals : useMockDeals;

export function findDeal(deals: Deal[], id: string) {
  return deals.find((d) => d.id === id) ?? seen.get(id) ?? MOCK_DEALS.find((d) => d.id === id);
}

export function findEvent(id: string) {
  return MOCK_EVENTS.find((e) => e.id === id);
}

function useBackendDeal(id: string): { deal: Deal | undefined; loading: boolean } {
  const { place } = useStore();
  const view = useQuery(api.deals.get, { id });
  // Deals from Elastic search or the agent aren't Convex rows; their detail page uses the copy we kept.
  return useMemo(
    () => ({ deal: view ? toDeal(view, place.coords) : seen.get(id), loading: view === undefined && !seen.has(id) }),
    [view, place.coords, id],
  );
}

function useMockDeal(id: string) {
  const { deals } = useDeals();
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
