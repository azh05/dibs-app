// How often a store's own channels are scraped by the rotating batch scans (batches.ts). Hot shops post deals or
// have followers, warm ones post but no deals lately, cold ones are quiet or have nothing to scrape. Pure, so tests
// can import it without the Convex runtime.
import { STORE_TYPES } from "../catalog";
import { DAY } from "./time";

export type ScanTier = "hot" | "warm" | "cold";

export const TIER_INTERVAL: Record<ScanTier, number> = { hot: DAY, warm: 3 * DAY, cold: 7 * DAY };

const NEW_STORE = 7 * DAY; // a new food or drink store starts hot for its first week
const RECENT_DEAL = 30 * DAY;
const POSTS_WEEKLY = 7 * DAY;
const POSTS_GONE_QUIET = 30 * DAY;
const QUIET_SCANS_TO_COLD = 2;
const SOCIAL_HOSTS = ["instagram.com", "facebook.com", "tiktok.com", "fb.com"];
const FOOD_AND_DRINK = new Set(STORE_TYPES.filter((t) => t.section === "Food & drink").map((t) => t.key));

type Channels = {
  instagram_handle?: string;
  tiktok_handle?: string;
  facebook_url?: string;
  website?: string;
};

export type TierInput = Channels & {
  store_type?: string;
  created_at: number;
  last_post_at?: number;
  last_deal_at?: number;
  quiet_scans?: number;
};

function siteHost(url: string): string {
  try {
    return new URL(url.includes("//") ? url : `https://${url}`).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** Has something the API can scrape: a social account, or a website that isn't one. */
export function scannable(s: Channels): boolean {
  if (s.instagram_handle || s.tiktok_handle || s.facebook_url) return true;
  if (!s.website) return false;
  const host = siteHost(s.website);
  return host !== "" && !SOCIAL_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

export function tierFor(s: TierInput, { followed, now }: { followed: boolean; now: number }): ScanTier {
  const within = (at: number | undefined, span: number) => at !== undefined && now - at <= span;
  if (!scannable(s)) return "cold";
  if (followed || within(s.last_deal_at, RECENT_DEAL)) return "hot";
  if ((s.quiet_scans ?? 0) >= QUIET_SCANS_TO_COLD) return "cold";
  // Non-food stores (the weekly retail, beauty and fitness discovery) start cold unless they post deals.
  if (within(s.created_at, NEW_STORE)) return s.store_type && FOOD_AND_DRINK.has(s.store_type) ? "hot" : "cold";
  if (within(s.last_post_at, POSTS_WEEKLY)) return "warm";
  if (s.last_post_at !== undefined && !within(s.last_post_at, POSTS_GONE_QUIET)) return "cold";
  return "warm";
}

export function nextScanAt(tier: ScanTier, now: number): number {
  return now + TIER_INTERVAL[tier];
}

const TIER_RANK: Record<ScanTier, number> = { hot: 0, warm: 1, cold: 2 };

/** Batch order: most overdue first (never scheduled before anything), hot before warm before cold on a tie. */
export function byScanPriority(a: { next_scan_at?: number; scan_tier?: ScanTier }, b: typeof a): number {
  return (
    (a.next_scan_at ?? 0) - (b.next_scan_at ?? 0) || TIER_RANK[a.scan_tier ?? "hot"] - TIER_RANK[b.scan_tier ?? "hot"]
  );
}
