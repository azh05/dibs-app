import type { IconName } from '@/components/icon';

/** A verified deal as returned by the API (`api/app/schemas.py` → `Deal`). */
export type ApiDeal = {
  shop_name: string;
  shop_handle: string | null;
  address: string | null;
  category: 'food' | 'drink' | 'retail' | 'entertainment' | 'other';
  offer: string;
  code: string | null;
  conditions: string[];
  start_date: string | null;
  end_date: string | null;
  /** HH:MM:SS local time, only if the source states it. */
  start_time?: string | null;
  end_time?: string | null;
  source_url: string;
  source_post_date: string | null;
  verbatim_quote: string;
  confidence: 'high' | 'medium' | 'low';
  status: 'live' | 'needs_check' | 'stale' | 'expired';
  flags: string[];
};

export type ApiSearchResponse = {
  as_of: string;
  deals: ApiDeal[];
  rejected?: { deal: unknown; reason: string }[];
  search_errors: string[];
  /** user_photo only: every word read off the photo. */
  transcript?: string | null;
};

/** Store types behind the filter chips. */
export type StoreType = 'food' | 'boba' | 'cafe' | 'barber' | 'gym' | 'grocery' | 'boxing' | 'fastfood' | 'nails';

export type SourceKind = 'instagram' | 'community' | 'website';

export type LatLng = { latitude: number; longitude: number };

/** The source post shown at the top of the deal / event detail screens. */
export type SourcePost = {
  author: string;
  initials: string;
  avatarColor: string;
  postedAgo: string;
  headline: string;
  subline: string;
  caption: string;
  imageColor: string;
  sublineColor: string;
  headlineSize: number;
};

export type Deal = {
  id: string;
  store: string;
  storeType: StoreType;
  /** Shown before the distance, e.g. "Boba" in "Boba · 0.3 mi". */
  typeLabel: string;
  icon: IconName;
  offer: string;
  /** Short text on the map pin, e.g. "BOGO". */
  pinLabel: string;
  distanceMi: number | null;
  coords: LatLng | null;
  address: string | null;
  walk: string | null;
  openUntil: string | null;
  /** End of the deal, if known. Drives "Ends 6 PM" and "Ends in 2h 14m". */
  endsAt: Date | null;
  /** Expiry text when there is no clock time, e.g. "Today only". */
  expiryLabel: string | null;
  window: { title: string; subtitle: string } | null;
  source: { kind: SourceKind; handle: string | null; url: string | null };
  /** Hours since the source was posted; drives pin recency. */
  postedHoursAgo: number;
  confirmations: number;
  lastCheckMinutes: number | null;
  post: SourcePost;
};

export type DealEvent = {
  id: string;
  title: string;
  store: string;
  area: string;
  storeType: StoreType;
  icon: IconName;
  pinLabel: string;
  distanceMi: number;
  travel: string;
  startsAt: Date;
  endsAt: Date;
  address: string;
  coords: LatLng;
  foundDaysEarly: number;
  post: SourcePost;
};

export type Activity = {
  id: string;
  dealId: string | null;
  icon: IconName;
  title: string;
  subtitle: string;
  ago: string;
  unread: boolean;
};

export type Submission = {
  id: string;
  store: string;
  offer: string;
  icon: IconName;
  status: 'verified' | 'review';
  /** Local photo the user snapped, for new submissions. */
  photoUri?: string;
};
