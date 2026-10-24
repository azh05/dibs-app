// Deals come from the dibs API when EXPO_PUBLIC_API_URL is set, otherwise from mock data.
import { useEffect, useState } from 'react';

import type { IconName } from '@/components/icon';
import { HOME, MOCK_DEALS, MOCK_EVENTS } from '@/lib/mock';
import type { ApiDeal, ApiSearchResponse, Deal, DealEvent, DealTag } from '@/lib/types';
import { colors } from '@/theme';

export const API_URL = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');

export const usingLiveApi = Boolean(API_URL);

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
    id: `api-${index}-${d.shop_name.toLowerCase().replace(/\W+/g, '-')}`,
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
  const res = await fetch(`${API_URL}/extract/search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      location: { neighborhood: HOME.label.split(',')[0], city: 'Los Angeles', region: 'California' },
      radius_miles: 1,
      max_searches: 5,
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as ApiSearchResponse;
  return body.deals.filter((d) => d.status !== 'expired').map(fromApiDeal);
}

type DealsState = { deals: Deal[]; events: DealEvent[]; loading: boolean; error: string | null };

// One fetch per app session, shared by every screen.
let cache: Promise<Deal[]> | null = null;

export function useDeals(): DealsState {
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

export function findDeal(deals: Deal[], id: string) {
  return deals.find((d) => d.id === id) ?? MOCK_DEALS.find((d) => d.id === id);
}

export function findEvent(id: string) {
  return MOCK_EVENTS.find((e) => e.id === id);
}
