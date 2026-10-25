// Filters shared by Deals, Map and the Filters screen (Figma "09 · Filters"), plus the
// quick chips on the Deals screen, which narrow the list further without touching them.
import type { Deal, DealEvent } from '@/lib/types';

export type Sort = 'best' | 'relevance' | 'distance';

export const SORTS: { key: Sort; label: string; sortedBy: string }[] = [
  { key: 'best', label: 'Best deals', sortedBy: 'best deals' },
  { key: 'relevance', label: 'Relevance', sortedBy: 'relevance' },
  { key: 'distance', label: 'Distance', sortedBy: 'distance' },
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
};

export const DEFAULT_FILTERS: Filters = {
  sort: 'best',
  radiusMi: 1,
  dealTypes: new Set(),
  storeTypes: new Set(),
  openNow: true,
  communityVerified: false,
  hideExpired: true,
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

const nearest = (a: Deal, b: Deal) => (a.distanceMi ?? Infinity) - (b.distanceMi ?? Infinity);

/** Best deals: most confirmed in store first, then the freshest post. */
const best = (a: Deal, b: Deal) => b.confirmations - a.confirmations || a.postedHoursAgo - b.postedHoursAgo;

/** Relevance: deals at store types you follow first, then nearest. */
const relevance = (interests: Set<string>) => (a: Deal, b: Deal) =>
  Number(interests.has(b.storeType)) - Number(interests.has(a.storeType)) || nearest(a, b);

export function applyFilters(
  deals: Deal[],
  filters: Filters,
  query = '',
  interests: Set<string> = new Set(),
  now = new Date(),
) {
  const sorter = { best, relevance: relevance(interests), distance: nearest }[filters.sort];
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
        matchesQuery(query, d.store, d.offer, d.typeLabel, d.storeType),
    )
    .sort(sorter);
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

// Quick chips on the Deals screen (Figma "07 · Deals"): "All", your store types, then deal types,
// any number on at once. Running the filters a second time with these sets narrows the list
// further without touching the saved filters; empty sets mean any.
export function quickFilters(filters: Filters, storeTypes: Set<string>, dealTypes: Set<string>): Filters {
  return { ...filters, storeTypes, dealTypes };
}
