// Deal status, recomputed as days pass. Steps 5 and 6 of api/app/verify.py, plus the two statuses only the
// backend knows: upcoming (starts later) and hidden (community says it ended).
import { daysBetween } from "./time";

export const STALE_AFTER_DAYS = 14;
export const HIDE_AFTER_ENDED_REPORTS = 3;

export type DealStatus = "live" | "needs_check" | "stale" | "expired" | "upcoming" | "hidden";

/** Statuses that show in the feed and on the map. */
export const ACTIVE_STATUSES: DealStatus[] = ["live", "needs_check", "upcoming"];

export function isActive(status: DealStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

export function computeStatus(
  deal: {
    start_date?: string;
    end_date?: string;
    source_post_date?: string;
    confidence: "high" | "medium" | "low";
    ended_count: number;
  },
  today: string,
): DealStatus {
  if (deal.ended_count >= HIDE_AFTER_ENDED_REPORTS) return "hidden";
  let status: DealStatus;
  if (deal.end_date && deal.end_date < today) status = "expired";
  else if (deal.end_date) status = "live";
  else if (deal.source_post_date && daysBetween(deal.source_post_date, today) > STALE_AFTER_DAYS) status = "stale";
  else if (deal.source_post_date) status = "live";
  else status = "needs_check";
  // Low confidence never shows as live without a human check.
  if (deal.confidence === "low" && status === "live") status = "needs_check";
  if ((status === "live" || status === "needs_check") && deal.start_date && deal.start_date > today) status = "upcoming";
  return status;
}
