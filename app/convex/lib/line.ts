import { MINUTE } from "./time";

const HALF_LIFE = 20 * MINUTE;

/** Last hour of in-geofence reports: newer ones count more, each weighted by the reporter's reliability, and
 * reports far from the median (over 2× it, plus 5 min of slack) are dropped. */
export function blend(
  reports: { wait_minutes: number; reported_at: number; score: number }[],
  now = Date.now(),
): { minutes: number; count: number } | null {
  if (!reports.length) return null;
  const sorted = reports.map((r) => r.wait_minutes).sort((a, b) => a - b);
  const median = sorted[Math.floor((sorted.length - 1) / 2)]!;
  const kept = reports.filter((r) => r.wait_minutes <= 2 * median + 5 && r.wait_minutes >= median / 2 - 5);
  let total = 0;
  let weights = 0;
  for (const r of kept) {
    const w = Math.pow(0.5, (now - r.reported_at) / HALF_LIFE) * r.score;
    total += w * r.wait_minutes;
    weights += w;
  }
  if (!weights) return null;
  return { minutes: Math.round(total / weights), count: kept.length };
}
