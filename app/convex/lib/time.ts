// Dates in deals are local to the store ("2026-10-31", "18:00"); the feed sorts and schedules on epoch ms.

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export const DEFAULT_TIMEZONE = "America/Los_Angeles";

function parts(ms: number, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(ms))) out[p.type] = p.value;
  return out;
}

/** YYYY-MM-DD in the given timezone. */
export function localDate(ms: number, timeZone = DEFAULT_TIMEZONE): string {
  const p = parts(ms, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** "mon" … "sun" in the given timezone. */
export function localWeekday(ms: number, timeZone = DEFAULT_TIMEZONE): string {
  return parts(ms, timeZone).weekday!.toLowerCase().slice(0, 3);
}

/** Minutes since local midnight. */
export function localMinutes(ms: number, timeZone = DEFAULT_TIMEZONE): number {
  const p = parts(ms, timeZone);
  return Number(p.hour) * 60 + Number(p.minute);
}

/** Epoch ms of a local date and time ("HH:MM" or "HH:MM:SS") in a timezone, handling DST. */
export function localToEpoch(date: string, time: string, timeZone = DEFAULT_TIMEZONE): number {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi, s] = time.split(":").map(Number);
  const asUtc = Date.UTC(y!, mo! - 1, d!, h ?? 0, mi ?? 0, s ?? 0);
  // Guess, then correct by the zone's offset at that instant (twice, for DST edges).
  let guess = asUtc;
  for (let i = 0; i < 2; i++) {
    const p = parts(guess, timeZone);
    const shown = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!);
    guess += asUtc - shown;
  }
  return guess;
}

/** Days between two YYYY-MM-DD dates (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
}

/** Monday of the week containing ms, as YYYY-MM-DD (local). Weekly challenges and streaks key on it. */
export function weekStart(ms: number, timeZone = DEFAULT_TIMEZONE): string {
  const today = localDate(ms, timeZone);
  const dow = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].indexOf(localWeekday(ms, timeZone));
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/** First day of the month containing ms, as YYYY-MM-01 (local). Leaderboards reset on it. */
export function monthStart(ms: number, timeZone = DEFAULT_TIMEZONE): string {
  return `${localDate(ms, timeZone).slice(0, 7)}-01`;
}
