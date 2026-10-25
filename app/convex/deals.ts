import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, query } from "./_generated/server";
import { getUser } from "./lib/auth";
import { refreshStatus } from "./lib/deals";
import { dealGeo, METERS_PER_MILE } from "./lib/geo";
import { ACTIVE_STATUSES } from "./lib/status";
import { dealView, hiddenFor } from "./lib/views";

const FEED_LIMIT = 200;

/** Deals and events near a point: the Deals list, the Map and "Coming up". Active deals only (live, needs_check,
 * upcoming). Deals whose store has no coordinates come along for the area they were scanned in. */
export const feed = query({
  args: {
    lat: v.number(),
    lng: v.number(),
    radius_miles: v.number(),
    scan_area_key: v.optional(v.string()),
  },
  handler: async (ctx, { lat, lng, radius_miles, scan_area_key }) => {
    const viewer = await getUser(ctx);
    const nearby = await dealGeo.nearest(ctx, {
      point: { latitude: lat, longitude: lng },
      maxDistance: Math.min(radius_miles, 25) * METERS_PER_MILE,
      limit: FEED_LIMIT,
    });
    const seen = new Set<Id<"deals">>();
    const rows: { deal: Doc<"deals">; distance: number | null }[] = [];
    for (const hit of nearby) {
      const deal = await ctx.db.get("deals", hit.key);
      if (!deal || seen.has(deal._id)) continue;
      seen.add(deal._id);
      rows.push({ deal, distance: hit.distance });
    }
    if (scan_area_key) {
      for (const status of ACTIVE_STATUSES) {
        const extra = await ctx.db
          .query("deals")
          .withIndex("by_area_status", (q) => q.eq("scan_area_key", scan_area_key).eq("status", status))
          .take(50);
        for (const deal of extra) {
          if (deal.has_coords || seen.has(deal._id)) continue;
          seen.add(deal._id);
          rows.push({ deal, distance: null });
        }
      }
    }
    const visible = rows.filter(({ deal }) => ACTIVE_STATUSES.includes(deal.status) && !hiddenFor(deal, viewer));
    return Promise.all(visible.map(({ deal, distance }) => dealView(ctx, deal, viewer, distance)));
  },
});

/** Deals the Elastic index returned (search, Ask dibs), by the API's Deal.id, as feed views, so the app can save
 * and open them like any feed deal. Keys with no deal here (not stored yet, hidden, inactive) are skipped. */
export const byEvidenceKeys = query({
  args: { keys: v.array(v.string()) },
  handler: async (ctx, { keys }) => {
    const viewer = await getUser(ctx);
    const seen = new Set<Id<"deals">>();
    const views = [];
    for (const key of keys.slice(0, 50)) {
      const evidence = await ctx.db
        .query("deal_evidence")
        .withIndex("by_evidence_key", (q) => q.eq("evidence_key", key))
        .first();
      if (!evidence || seen.has(evidence.deal_id)) continue;
      seen.add(evidence.deal_id);
      const deal = await ctx.db.get("deals", evidence.deal_id);
      if (!deal || !ACTIVE_STATUSES.includes(deal.status) || hiddenFor(deal, viewer)) continue;
      views.push(await dealView(ctx, deal, viewer, null));
    }
    return views;
  },
});

/** One deal for the detail screen, with every piece of evidence behind it. */
export const get = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const dealId = ctx.db.normalizeId("deals", id);
    if (!dealId) return null;
    const deal = await ctx.db.get("deals", dealId);
    if (!deal) return null;
    const viewer = await getUser(ctx);
    if (hiddenFor(deal, viewer)) return null;
    const evidence = await ctx.db
      .query("deal_evidence")
      .withIndex("by_deal", (q) => q.eq("deal_id", dealId))
      .collect();
    const sources = await Promise.all(
      evidence.map(async (e) => {
        const s = await ctx.db.get("sources", e.source_id);
        return {
          kind: s?.kind ?? "website",
          url: s && s.kind !== "photo" ? s.original_url : null,
          handle: s?.author_handle ?? null,
          quote: e.verbatim_quote,
          posted_at: e.source_post_date ?? null,
          second_hand: e.second_hand,
        };
      }),
    );
    return { ...(await dealView(ctx, deal, viewer)), sources };
  },
});

/** Active deals at one store (Saved → Stores, store pages). */
export const atStore = query({
  args: { storeId: v.id("stores") },
  handler: async (ctx, { storeId }) => {
    const viewer = await getUser(ctx);
    const deals = await ctx.db
      .query("deals")
      .withIndex("by_store", (q) => q.eq("store_id", storeId))
      .collect();
    return Promise.all(
      deals
        .filter((d) => ACTIVE_STATUSES.includes(d.status) && !hiddenFor(d, viewer))
        .map((d) => dealView(ctx, d, viewer)),
    );
  },
});

/** "Watching N spots near you": stores the agents know in the area. */
export const spotsWatched = query({
  args: { scan_area_key: v.string() },
  handler: async (ctx, { scan_area_key }) =>
    (
      await ctx.db
        .query("stores")
        .withIndex("by_area_name", (q) => q.eq("scan_area_key", scan_area_key))
        .take(10_000)
    ).length,
});

/** Hourly: dates pass, so live deals expire, recent posts go stale and upcoming deals start. */
export const recomputeStatus = internalMutation({
  args: {},
  handler: async (ctx) => {
    let changed = 0;
    for (const status of ["live", "needs_check", "upcoming", "stale"] as const) {
      const deals = await ctx.db
        .query("deals")
        .withIndex("by_status_end_date", (q) => q.eq("status", status))
        .take(2000);
      for (const deal of deals) if ((await refreshStatus(ctx, deal)) !== deal.status) changed++;
    }
    return changed;
  },
});
