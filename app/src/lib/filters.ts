// Filters shared by Deals, Map and the Filters screen (Figma "08 · Filters"), plus the
// quick chips on the Deals screen, which narrow the list further without touching them.
import type { IconName } from '@/components/icon';
import { sectionOf } from '@/lib/interests';
import type { Deal, DealEvent, SourceKind } from '@/lib/types';

export type Sort = 'nearest' | 'newest' | 'ending';

export const SORTS: { key: Sort; label: string; sortedBy: string }[] = [
  { key: 'nearest', label: 'Nearest', sortedBy: 'distance' },
  { key: 'newest', label: 'Newest', sortedBy: 'newest' },
  { key: 'ending', label: 'Ending soon', sortedBy: 'ending soon' },
];

export const SOURCES: { kind: SourceKind; label: string; icon: IconName }[] = [
  { kind: 'instagram', label: 'Instagram', icon: 'instagram' },
  { kind: 'website', label: 'Websites', icon: 'globe' },
  { kind: 'community', label: 'Community', icon: 'users' },
];

export const UPCOMING_EVENTS = 'Upcoming events';

export type Filters = {
  sort: Sort;
  radiusMi: number;
  /** Deal types from the catalog; empty means any. "Upcoming events" toggles events. */
  dealTypes: Set<string>;
  /** Store types from the catalog; empty means any. */
  storeTypes: Set<string>;
  openNow: boolean;
  communityVerified: boolean;
  hideExpired: boolean;
  sources: Set<SourceKind>;
};

export const DEFAULT_FILTERS: Filters = {
  sort: 'nearest',
  radiusMi: 1,
  dealTypes: new Set(),
  storeTypes: new Set(),
  openNow: false,
  communityVerified: false,
  hideExpired: true,
  sources: new Set(SOURCES.map((s) => s.kind)),
};

/** Posts this old with no end date have probably run their course. */
const STALE_HOURS = 24 * 7;

export function isLikelyExpired(deal: Deal, now = new Date()) {
  if (deal.endsAt) return deal.endsAt < now;
  return deal.postedHoursAgo > STALE_HOURS;
}

export function isOpenNow(deal: Deal, now = new Date()) {
  if (!deal.hours) return true;
  const [open, close] = deal.hours;
  const hour = now.getHours() + now.getMinutes() / 60;
  return hour >= open && hour < close;
}

function isCommunityVerified(deal: Deal) {
  return deal.confirmations > 0 || deal.source.kind === 'community';
}

function matchesQuery(query: string, ...fields: string[]) {
  const q = query.trim().toLowerCase();
  return !q || fields.some((f) => f.toLowerCase().includes(q));
}

function withinRadius(distanceMi: number | null, radiusMi: number) {
  return distanceMi == null || distanceMi <= radiusMi;
}

const SORTERS: Record<Sort, (a: Deal, b: Deal) => number> = {
  nearest: (a, b) => (a.distanceMi ?? Infinity) - (b.distanceMi ?? Infinity),
  newest: (a, b) => a.postedHoursAgo - b.postedHoursAgo,
  ending: (a, b) => (a.endsAt?.getTime() ?? Infinity) - (b.endsAt?.getTime() ?? Infinity),
};

export function applyFilters(deals: Deal[], filters: Filters, query = '', now = new Date()) {
  const dealTypes = [...filters.dealTypes].filter((t) => t !== UPCOMING_EVENTS);
  return deals
    .filter(
      (d) =>
        withinRadius(d.distanceMi, filters.radiusMi) &&
        (dealTypes.length === 0 || d.tags.some((t) => filters.dealTypes.has(t))) &&
        (filters.storeTypes.size === 0 || filters.storeTypes.has(d.storeType)) &&
        (!filters.openNow || isOpenNow(d, now)) &&
        (!filters.communityVerified || isCommunityVerified(d)) &&
        (!filters.hideExpired || !isLikelyExpired(d, now)) &&
        filters.sources.has(d.source.kind) &&
        matchesQuery(query, d.store, d.offer, d.typeLabel, d.storeType),
    )
    .sort(SORTERS[filters.sort]);
}

/** Events are worth a short trip, so distance doesn't hide them (the 1.2 mi pop-up shows at 1 mi). */
export function applyEventFilters(events: DealEvent[], filters: Filters, query = '') {
  if (filters.dealTypes.size > 0 && !filters.dealTypes.has(UPCOMING_EVENTS)) return [];
  return events.filter(
    (e) =>
      (filters.storeTypes.size === 0 || filters.storeTypes.has(e.storeType)) &&
      matchesQuery(query, e.title, e.store, e.area),
  );
}

/** Filters that differ from the defaults, as removable chips (Map "Applied filters"). */
export function appliedFilters(filters: Filters): { key: string; label: string; remove: (f: Filters) => Filters }[] {
  const without = (set: Set<string>, value: string) => new Set([...set].filter((v) => v !== value));
  return [
    ...(filters.openNow ? [{ key: 'open', label: 'Open now', remove: (f: Filters) => ({ ...f, openNow: false }) }] : []),
    ...(filters.communityVerified
      ? [{ key: 'verified', label: 'Community verified', remove: (f: Filters) => ({ ...f, communityVerified: false }) }]
      : []),
    ...[...filters.storeTypes].map((t) => ({
      key: `type:${t}`,
      label: t,
      remove: (f: Filters) => ({ ...f, storeTypes: without(f.storeTypes, t) }),
    })),
    ...[...filters.dealTypes].map((t) => ({
      key: `deal:${t}`,
      label: t,
      remove: (f: Filters) => ({ ...f, dealTypes: without(f.dealTypes, t) }),
    })),
  ];
}

// Quick chips on the Deals screen (Figma "06 · Deals"): a deal type, one store type,
// or a whole catalog section.
export type QuickFilter =
  | { label: string; kind: 'all' | 'upcoming' }
  | { label: string; kind: 'tag' | 'type' | 'section'; value: string };

export const ALL_DEALS: QuickFilter = { label: 'All', kind: 'all' };
export const UPCOMING_ONLY: QuickFilter = { label: 'Upcoming', kind: 'upcoming' };

export const QUICK_FILTERS: QuickFilter[] = [
  ALL_DEALS,
  UPCOMING_ONLY,
  { label: 'BOGO', kind: 'tag', value: 'BOGO' },
  { label: '% off', kind: 'tag', value: '% off' },
  { label: 'Free', kind: 'tag', value: 'Free stuff' },
  ...[
    'Restaurants',
    'Fast food',
    'Food trucks',
    'Cafes',
    'Boba & tea',
    'Desserts & bakeries',
    'Nails',
    'Hair & barbers',
    'Spa & massage',
    'Gyms',
  ].map((t) => ({ label: t, kind: 'type' as const, value: t })),
  ...['Shopping', 'Fun', 'Health', 'Everyday', 'Auto', 'Pets'].map((s) => ({
    label: s,
    kind: 'section' as const,
    value: s,
  })),
];

function quickMatchesType(quick: QuickFilter, storeType: string) {
  if (quick.kind === 'type') return storeType === quick.value;
  if (quick.kind === 'section') return sectionOf(storeType)?.title === quick.value;
  return true;
}

export function quickFilterDeals(deals: Deal[], quick: QuickFilter) {
  if (quick.kind === 'upcoming') return [];
  if (quick.kind === 'tag') return deals.filter((d) => d.tags.some((t) => t === quick.value));
  return deals.filter((d) => quickMatchesType(quick, d.storeType));
}

export function quickFilterEvents(events: DealEvent[], quick: QuickFilter) {
  if (quick.kind === 'tag') return [];
  return events.filter((e) => quickMatchesType(quick, e.storeType));
}
