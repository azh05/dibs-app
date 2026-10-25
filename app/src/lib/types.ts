import type { IconName } from '@/components/icon';

/** A verified deal as returned by the API (`api/app/schemas.py` → `Deal`). */
export type ApiDeal = {
  shop_name: string;
  shop_handle: string | null;
  address: string | null;
  category: 'food' | 'drink' | 'retail' | 'entertainment' | 'beauty' | 'fitness' | 'other';
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
  /** Stable deal id, and the id of its shop in the response's `shops`. */
  id?: string | null;
  shop_id?: string | null;
  /** Display fields Claude fills (see api/README.md, "Display fields"). */
  headline?: string | null;
  title?: string | null;
  deal_types?: string[];
  kind?: 'deal' | 'event';
  student_only?: boolean;
  est_savings_cents?: number | null;
};

export type ApiSearchResponse = {
  as_of: string;
  deals: ApiDeal[];
  rejected?: { deal: unknown; reason: string }[];
  search_errors: string[];
  /** user_photo only: every word read off the photo. */
  transcript?: string | null;
};

export type SourceKind = 'instagram' | 'tiktok' | 'facebook' | 'community' | 'website';

export type LatLng = { latitude: number; longitude: number };

/** Figma "Store Logo": the store's brand colour behind its category icon. */
export type StoreLogo = { bg: string; fg: string };

/** Deal types a deal can carry, as named in the interest catalog (`DEAL_TYPES`). */
export type DealTag = 'BOGO' | '% off' | 'Free stuff' | 'Student deals' | 'Happy hour' | 'Late night' | 'New openings';

/** Crowd-reported wait, combined from line checks in the last hour. */
export type LineEstimate = { minutes: number; reports: number };

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
  /** Store type from the interest catalog, e.g. "Boba & tea". */
  storeType: string;
  /** Shown before the distance, e.g. "Boba" in "Boba · 0.3 mi". */
  typeLabel: string;
  icon: IconName;
  logo: StoreLogo | null;
  offer: string;
  /** Short name for lists and notifications, e.g. "BOGO milk tea". */
  shortOffer: string;
  tags: DealTag[];
  /** Short text on the map pin, e.g. "BOGO". */
  pinLabel: string;
  distanceMi: number | null;
  coords: LatLng | null;
  address: string | null;
  walk: string | null;
  openUntil: string | null;
  /** Opening hours as [open, close] in 24h hours, for "Open now". */
  hours: [number, number] | null;
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
  /** Line reports from other dibs users in the last hour. */
  line: LineEstimate | null;
  post: SourcePost;
  /** Backend only: the store's id (follows, line checks) and community signals. */
  storeId?: string;
  geofenceM?: number;
  upvotes?: number;
  downvotes?: number;
  myVote?: -1 | 0 | 1;
  status?: 'live' | 'needs_check' | 'stale' | 'expired' | 'upcoming' | 'hidden';
  /** What using it once saves, when the source states prices. */
  estSavingsCents?: number | null;
  /** Student-only and the viewer hasn't verified a .edu email. */
  locked?: boolean;
};

export type DealEvent = {
  id: string;
  title: string;
  store: string;
  area: string;
  storeType: string;
  icon: IconName;
  logo: StoreLogo | null;
  pinLabel: string;
  distanceMi: number;
  travel: string;
  startsAt: Date;
  endsAt: Date;
  address: string;
  coords: LatLng;
  foundDaysEarly: number;
  post: SourcePost;
  storeId?: string;
  /** Where the event was announced, e.g. "Instagram". */
  sourceName?: string;
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
  status: 'verified' | 'review' | 'rejected' | 'checking';
  /** The photo: a local file for new mock submissions, a URL from the backend. */
  photoUri?: string;
  /** Backend: credits this submission earned, and whether they've posted yet. */
  credits?: { amount: number; status: 'pending' | 'posted' | 'reversed' } | null;
};
