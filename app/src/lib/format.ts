import type { Deal, DealEvent, SourceKind } from '@/lib/types';
import { colors } from '@/theme';

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "1 deal", "9 deals" */
export function plural(count: number, word: string) {
  return `${count} ${count === 1 ? word : `${word}s`}`;
}

/** "6 PM", "6:30 PM" */
export function clock(date: Date) {
  const h = date.getHours() % 12 || 12;
  const m = date.getMinutes();
  const suffix = date.getHours() < 12 ? 'AM' : 'PM';
  return m ? `${h}:${String(m).padStart(2, '0')} ${suffix}` : `${h} ${suffix}`;
}

export function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Expiry pill on deal cards: "Ends 6 PM", "Ends Oct 31", "Today only". */
export function expiryText(deal: Deal, now = new Date()) {
  if (deal.endsAt) {
    if (isSameDay(deal.endsAt, now)) return `Ends ${clock(deal.endsAt)}`;
    return `Ends ${MONTHS[deal.endsAt.getMonth()]} ${deal.endsAt.getDate()}`;
  }
  return deal.expiryLabel ?? 'Live';
}

/** "Ends in 2h 14m" on the deal detail screen. */
export function endsIn(endsAt: Date, now = new Date()) {
  const mins = Math.max(0, Math.round((endsAt.getTime() - now.getTime()) / 60000));
  if (mins === 0) return 'Ended';
  const days = Math.floor(mins / 1440);
  if (days >= 1) return `Ends in ${days}d ${Math.floor((mins % 1440) / 60)}h`;
  const h = Math.floor(mins / 60);
  return h ? `Ends in ${h}h ${mins % 60}m` : `Ends in ${mins}m`;
}

/** "2h", "35m", "3d", "2w" */
/** "Oct 24, 6 PM", or "Oct 24" when the time is the end of the day. */
export function dayAndTime(date: Date) {
  const day = `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  const endOfDay =
    (date.getHours() === 23 && date.getMinutes() === 59) || (date.getHours() === 0 && date.getMinutes() === 0);
  return endOfDay ? day : `${day}, ${clock(date)}`;
}

export function shortAgo(hours: number) {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 24) return `${Math.round(hours)}h`;
  if (hours < 24 * 7) return `${Math.round(hours / 24)}d`;
  return `${Math.round(hours / (24 * 7))}w`;
}

const SOURCE_NAMES: Record<SourceKind, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  facebook: 'Facebook',
  community: 'Community',
  website: 'Website',
};

export const SOURCE_ICONS = {
  instagram: 'instagram',
  tiktok: 'tiktok',
  facebook: 'facebook',
  community: 'users',
  website: 'globe',
} as const;

/** Source pill text: "Instagram · 2h ago", "Community · verified". */
export function sourceText(deal: Deal) {
  if (deal.source.kind === 'community') return 'Community · verified';
  return `${SOURCE_NAMES[deal.source.kind]} · ${shortAgo(deal.postedHoursAgo)} ago`;
}

/** "Boba · 0.3 mi" */
export function dealMeta(deal: Deal) {
  return deal.distanceMi == null ? deal.typeLabel : `${deal.typeLabel} · ${deal.distanceMi} mi`;
}

export type PinState = 'fresh' | 'day' | 'week' | 'selected' | 'upcoming';

/** Pin colour encodes how old the source post is. */
export function recency(hoursAgo: number): Exclude<PinState, 'selected' | 'upcoming'> {
  if (hoursAgo < 24) return 'fresh';
  if (hoursAgo < 24 * 7) return 'day';
  return 'week';
}

export const PIN_COLORS = { fresh: colors.pinFresh, day: colors.pinDay, week: colors.pinWeek } as const;

export function eventWeekday(event: DealEvent) {
  return WEEKDAYS[event.startsAt.getDay()];
}

/** "UPCOMING · 12 PM" */
export function eventWhen(event: DealEvent) {
  return `UPCOMING · ${clock(event.startsAt)}`;
}

/** "Sat, Oct 31 · 12 – 8 PM" */
export function eventRange(event: DealEvent) {
  const day = WEEKDAYS[event.startsAt.getDay()];
  const start = clock(event.startsAt);
  const end = clock(event.endsAt);
  const sameHalf = start.slice(-2) === end.slice(-2);
  const range = sameHalf ? `${start.slice(0, -3)} – ${end}` : `${start} – ${end}`;
  return `${day[0]}${day.slice(1).toLowerCase()}, ${MONTHS[event.startsAt.getMonth()]} ${event.startsAt.getDate()} · ${range}`;
}

/** Days / hours / minutes until a start time, floored at zero. */
export function countdown(to: Date, now = new Date()) {
  const mins = Math.max(0, Math.floor((to.getTime() - now.getTime()) / 60000));
  return { days: Math.floor(mins / 1440), hours: Math.floor((mins % 1440) / 60), minutes: mins % 60 };
}
