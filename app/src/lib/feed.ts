// Convex deal views (convex/lib/views.ts) → the Deal and DealEvent shapes the screens render.
import type { FunctionReturnType } from 'convex/server';

import type { api } from '@convex/_generated/api';
import { DEAL_TYPES as CATALOG_DEAL_TYPES, storeType as catalogStoreType } from '@convex/catalog';
import { distanceMeters } from '@/lib/line-check';
import { interestIcon } from '@/lib/interests';
import { clock, shortAgo } from '@/lib/format';
import type { Deal, DealEvent, DealTag, LatLng, SourceKind } from '@/lib/types';
import { colors } from '@/theme';

export type DealView = FunctionReturnType<typeof api.deals.feed>[number];

const METERS_PER_MILE = 1609.344;
const WALK_MPH = 3;
const DRIVE_MPH = 18;
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_NAMES = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' } as Record<string, string>;

/** Catalog key ("boba_tea") → the app's label ("Boba & tea"); unknown stores read as restaurants. */
export function storeTypeLabel(key: string | null | undefined) {
  return catalogStoreType(key)?.label ?? 'Restaurants';
}

/** "Boba & tea" → "Boba", "Restaurants" → "Restaurants". */
function typeLabel(label: string) {
  return label.split(' & ')[0];
}

const TAG_FOR: Record<string, DealTag> = Object.fromEntries(
  CATALOG_DEAL_TYPES.filter((t) => t.key !== 'event').map((t) => [t.key, t.label as DealTag]),
);

function sourceKind(kind: string | undefined): SourceKind {
  if (kind === 'instagram') return 'instagram';
  if (kind === 'photo') return 'community';
  return 'website';
}

const SOURCE_NAME: Record<string, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  facebook: 'Facebook',
  website: 'their website',
  google: 'Google',
  photo: 'the dibs community',
};

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function travel(miles: number | null) {
  if (miles == null) return null;
  if (miles <= 1.5) return `${Math.max(1, Math.round((miles / WALK_MPH) * 60))} min walk`;
  return `${Math.max(1, Math.round((miles / DRIVE_MPH) * 60))} min drive`;
}

/** "11 AM", "5:30 PM" → hours since midnight. */
function parseClock(text: string, fallbackMeridiem?: string): number | null {
  const m = text.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  const meridiem = (m[3] ?? fallbackMeridiem ?? '').toUpperCase();
  if (meridiem === 'PM') h += 12;
  return h + Number(m[2] ?? 0) / 60;
}

/** Google Maps hours for today ("11 AM to 10 PM", "11:30 AM to 2 PM, 5 to 10 PM", "Open 24 hours", "Closed")
 *  → [open, close] in hours (close past midnight goes above 24), plus the closing time as text. */
export function todaysHours(hours: { day: string; hours: string }[] | null | undefined, now = new Date()) {
  if (!hours?.length) return { hours: null, openUntil: null };
  const today = hours.find((h) => h.day.toLowerCase().startsWith(DAYS[now.getDay()]));
  if (!today) return { hours: null, openUntil: null };
  const text = today.hours.replace(/ | /g, ' ');
  if (/24 hours/i.test(text)) return { hours: [0, 24] as [number, number], openUntil: null };
  if (/closed/i.test(text)) return { hours: [0, 0] as [number, number], openUntil: null };
  const ranges = text.split(',').map((r) => r.split(/\s+to\s+|\s*[–-]\s*/i));
  const first = ranges[0];
  const last = ranges[ranges.length - 1];
  if (!first || first.length < 2 || !last || last.length < 2) return { hours: null, openUntil: null };
  const closeText = last[1].trim();
  const closeMeridiem = closeText.match(/(AM|PM)$/i)?.[1];
  const open = parseClock(first[0], first[1].match(/(AM|PM)$/i)?.[1]);
  let close = parseClock(closeText);
  if (open == null || close == null) return { hours: null, openUntil: null };
  if (close <= open) close += 24;
  return { hours: [open, close] as [number, number], openUntil: closeText.replace(/:00(?=\s|$)/, '') || (closeMeridiem ?? null) };
}

function fmtTime(t: string) {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

function windowFor(v: DealView, now: Date): Deal['window'] {
  const fine = v.conditions.join(' · ');
  const times = v.start_time && v.end_time ? `${fmtTime(v.start_time)} – ${fmtTime(v.end_time)}` : v.end_time ? `Until ${fmtTime(v.end_time)}` : null;
  if (v.recurring_window) {
    const days = v.recurring_window.days.length ? v.recurring_window.days.map((d) => DAY_NAMES[d] ?? d).join(', ') : 'Daily';
    const t =
      v.recurring_window.start_time && v.recurring_window.end_time
        ? `${fmtTime(v.recurring_window.start_time)} – ${fmtTime(v.recurring_window.end_time)}`
        : v.recurring_window.end_time
          ? `before ${fmtTime(v.recurring_window.end_time)}`
          : '';
    return { title: [days, t].filter(Boolean).join(' · '), subtitle: fine || 'Repeats every week' };
  }
  const today = localISO(now);
  if (times) return { title: `${v.end_date === today || v.start_date === today ? 'Today' : 'Hours'} · ${times}`, subtitle: fine || 'As posted by the store' };
  if (v.code) return { title: `Code ${v.code}`, subtitle: fine || 'Show or enter at checkout' };
  if (fine) return { title: 'Conditions', subtitle: fine };
  return null;
}

function localISO(d: Date) {
  const z = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

function hoursSince(iso: string | null, fallbackMs: number, now: Date) {
  const ms = iso ? new Date(`${iso}T12:00:00`).getTime() : fallbackMs;
  return Math.max(0, (now.getTime() - ms) / 3_600_000);
}

function initialsOf(name: string) {
  return name
    .replace(/^@/, '')
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

function miles(v: DealView, here: LatLng | null) {
  if (v.distance_m != null) return round1(v.distance_m / METERS_PER_MILE);
  if (here && v.store?.lat != null && v.store.lng != null)
    return round1(distanceMeters(here, { latitude: v.store.lat, longitude: v.store.lng }) / METERS_PER_MILE);
  return null;
}

export function toDeal(v: DealView, here: LatLng | null, now = new Date()): Deal {
  const label = storeTypeLabel(v.store?.store_type);
  const name = v.store?.name ?? 'Local shop';
  const distanceMi = miles(v, here);
  const { hours, openUntil } = todaysHours(v.store?.hours, now);
  const endsAt = v.ends_at ? new Date(v.ends_at) : null;
  const short = v.title ?? v.offer;
  const headline = v.headline ?? short.split(' ').slice(0, 2).join(' ');
  const kind = v.source?.kind ?? 'website';
  const postedHoursAgo = hoursSince(v.source?.posted_at ?? null, v.first_seen_at, now);
  const today = localISO(now);
  return {
    id: v.id,
    storeId: v.store?.id,
    geofenceM: v.store?.geofence_m,
    store: name,
    storeType: label,
    typeLabel: typeLabel(label),
    icon: interestIcon(label),
    logo: null,
    offer: v.offer,
    shortOffer: short,
    tags: v.deal_types.map((t) => TAG_FOR[t]).filter((t): t is DealTag => Boolean(t)),
    pinLabel: headline,
    distanceMi,
    coords: v.store?.lat != null && v.store.lng != null ? { latitude: v.store.lat, longitude: v.store.lng } : null,
    address: v.store?.address ?? null,
    walk: travel(distanceMi),
    openUntil,
    hours,
    endsAt,
    expiryLabel:
      v.status === 'needs_check'
        ? 'Needs check'
        : v.end_date === today && !v.end_time
          ? 'Today only'
          : v.status === 'upcoming' && v.starts_at
            ? `Starts ${clock(new Date(v.starts_at))}`
            : null,
    window: windowFor(v, now),
    source: { kind: sourceKind(kind), handle: v.source?.handle ?? null, url: v.source?.url ?? null },
    postedHoursAgo,
    confirmations: v.confirmations,
    lastCheckMinutes: v.last_confirmed_at ? Math.round((now.getTime() - v.last_confirmed_at) / 60_000) : null,
    line: v.line,
    post: {
      author: v.source?.handle ?? name,
      initials: initialsOf(v.source?.handle ?? name),
      avatarColor: colors.ink,
      postedAgo: shortAgo(postedHoursAgo),
      headline: (v.headline ?? v.code ?? headline).toUpperCase(),
      subline: short.toUpperCase(),
      caption: v.source?.quote ?? v.source?.caption ?? v.offer,
      imageColor: colors.orange,
      sublineColor: colors.orangeSoft,
      headlineSize: (v.headline ?? headline).length > 8 ? 34 : 52,
    },
    upvotes: v.upvotes,
    downvotes: v.downvotes,
    myVote: v.my_vote as -1 | 0 | 1,
    status: v.status,
    estSavingsCents: v.est_savings_cents,
    locked: v.locked,
  };
}

export function isEvent(v: DealView) {
  return (v.kind === 'event' || v.status === 'upcoming') && v.starts_at != null && v.store?.lat != null;
}

export function toEvent(v: DealView, here: LatLng | null): DealEvent {
  const deal = toDeal(v, here);
  const startsAt = new Date(v.starts_at!);
  return {
    id: v.id,
    storeId: v.store?.id,
    title: v.title ?? v.offer,
    store: deal.store,
    area: v.store?.address?.split(',')[1]?.trim() ?? '',
    storeType: deal.storeType,
    icon: 'calendar',
    logo: null,
    pinLabel: v.headline ?? deal.pinLabel,
    distanceMi: deal.distanceMi ?? 0,
    travel: deal.walk ?? '',
    startsAt,
    endsAt: v.ends_at ? new Date(v.ends_at) : new Date(startsAt.getTime() + 4 * 3_600_000),
    address: deal.address ?? deal.store,
    coords: deal.coords!,
    foundDaysEarly: Math.max(0, Math.round((startsAt.getTime() - v.first_seen_at) / 86_400_000)),
    post: deal.post,
    sourceName: SOURCE_NAME[v.source?.kind ?? 'website'],
  };
}

/** Split a feed into the Deals list and "Coming up". */
export function splitFeed(views: DealView[], here: LatLng | null) {
  const deals: Deal[] = [];
  const events: DealEvent[] = [];
  for (const v of views) {
    if (isEvent(v)) events.push(toEvent(v, here));
    else deals.push(toDeal(v, here));
  }
  events.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return { deals, events };
}
