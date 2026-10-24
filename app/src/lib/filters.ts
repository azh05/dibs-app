import type { Deal, DealEvent, StoreType } from '@/lib/types';

// Store type chips on the Deals and Map screens, in design order.
export const FILTERS = [
  'All',
  'Upcoming',
  'Food',
  'Boba',
  'Cafes',
  'Barbers',
  'Gyms',
  'Grocery',
  'Boxing',
  'Fast food',
] as const;
export type Filter = (typeof FILTERS)[number];

const TYPES: Partial<Record<Filter, StoreType[]>> = {
  Food: ['food', 'fastfood'],
  Boba: ['boba'],
  Cafes: ['cafe'],
  Barbers: ['barber'],
  Gyms: ['gym'],
  Grocery: ['grocery'],
  Boxing: ['boxing'],
  'Fast food': ['fastfood'],
};

function matchesQuery(query: string, ...fields: string[]) {
  const q = query.trim().toLowerCase();
  return !q || fields.some((f) => f.toLowerCase().includes(q));
}

export function filterDeals(deals: Deal[], filter: Filter, query: string) {
  if (filter === 'Upcoming') return [];
  const types = TYPES[filter];
  return deals.filter(
    (d) => (!types || types.includes(d.storeType)) && matchesQuery(query, d.store, d.offer, d.typeLabel),
  );
}

export function filterEvents(events: DealEvent[], filter: Filter, query: string) {
  const types = TYPES[filter];
  return events.filter((e) => (!types || types.includes(e.storeType)) && matchesQuery(query, e.title, e.store, e.area));
}
