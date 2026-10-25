// Rotating deal scans: every scannable store on each watched area's shop list (area_stores), a batch at a time.
//
// - scheduleBatches (hourly cron): for each watched area with a list, claimBatch picks the most overdue stores that
//   have something to scrape (lib/tiers.ts byScanPriority), leases them (next_scan_at = now + LEASE) and queues one
//   /extract/shops job with `stores`, so the API scrapes those stores' own channels without searching Google Maps.
//   A few stores with nothing to scrape ride along weekly for the API's account lookup. scans.pollShops polls the
//   job and calls finishBatch, which sets each store's tier and next scan from what the batch saw. A store a failed
//   run never reported comes back once its lease runs out.
// - scheduleSweeps (daily cron): one `sweep_only` job per area (keyword sweep and Google deal search) with the
//   area's handles, for creator posts and roundups about its shops.
// - Both stop for the day once the area's estimated spend (agent_runs.cost_usd, lib/cost.ts) reaches its budget.
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { scanLocation, scanTarget, watched } from "./areas";
import { insertRun } from "./ingest";
import { apiConfigured, dibsApi } from "./lib/api";
import { byScanPriority, nextScanAt, scannable, tierFor } from "./lib/tiers";
import { DAY, HOUR, localDate, localToEpoch, MINUTE } from "./lib/time";

const BATCH_SIZE = Number(process.env.DIBS_SCAN_BATCH ?? 20); // each Apify channel run must finish within 4 minutes
const LOOKUPS_PER_BATCH = 5;
const LOOKUP_EVERY = 7 * DAY;
const API_LOOKUPS_PER_RUN = 20; // google_lookup.MAX_LOOKUPS
const LEASE = HOUR; // longer than a batch takes (the poll gives up after 10 minutes)
const RUNNING_MAX = 35 * MINUTE;
const MAX_AREA_STORES = 500;
const MAX_AREAS_PER_TICK = 3; // caps Apify spend per cron tick
const STAGGER_MS = 60_000; // so the API's Apify memory gate isn't hit all at once
const POLL_EVERY_MS = 15_000;
const DEFAULT_BUDGET_USD = Number(process.env.DIBS_AREA_DAILY_BUDGET_USD ?? 5);

/** What an /extract/shops run was: a store batch, an area sweep, or the older Google Maps area scan. */
export function scanKind(request: unknown): "batch" | "sweep" | "area" {
  const r = request as { stores?: unknown; sweep_only?: boolean } | undefined;
  if (r?.sweep_only) return "sweep";
  return Array.isArray(r?.stores) ? "batch" : "area";
}

/** A ShopsRequest `stores` entry (the API's KnownShop). Fields left undefined are dropped by JSON. */
type KnownShop = {
  id: string;
  name: string;
  category?: string;
  lat?: number;
  lng?: number;
  website?: string;
  instagram?: string;
  tiktok?: string;
  facebook?: string;
  found_via: Doc<"stores">["found_via"];
  since?: string;
  lookup?: boolean;
};

/** Due a Google account lookup: a Maps or named shop (the only kinds the API looks up) missing a social account,
 * not checked this week. */
function lookupDue(s: Doc<"stores">, now: number): boolean {
  const missing = !(s.instagram_handle && s.tiktok_handle && s.facebook_url);
  const kind = s.found_via === "google_maps" || s.found_via === "named";
  return kind && missing && (s.accounts_checked_at ?? 0) <= now - LOOKUP_EVERY;
}

function knownShop(s: Doc<"stores">, opts: { since: boolean; lookup: boolean }): KnownShop {
  const shop: KnownShop = {
    id: s.external_id,
    name: s.name,
    category: s.google_category,
    lat: s.lat,
    lng: s.lng,
    website: s.website,
    instagram: s.instagram_handle,
    tiktok: s.tiktok_handle,
    facebook: s.facebook_url,
    found_via: s.found_via,
    // Incremental: only posts since the last scan (the API adds a day of overlap).
    since: opts.since && s.last_scanned_at > 0 ? localDate(s.last_scanned_at, s.timezone) : undefined,
    lookup: opts.lookup || undefined,
  };
  return Object.fromEntries(Object.entries(shop).filter(([, val]) => val !== undefined)) as KnownShop;
}

const channelsOf = (k: KnownShop) => ({
  instagram_handle: k.instagram,
  tiktok_handle: k.tiktok,
  facebook_url: k.facebook,
  website: k.website,
});

/** The area's runs since local midnight, newest first. */
async function runsToday(ctx: MutationCtx, area: Doc<"scan_areas">, now: number) {
  const midnight = localToEpoch(localDate(now, area.timezone), "00:00", area.timezone);
  return ctx.db
    .query("agent_runs")
    .withIndex("by_area_and_started_at", (q) => q.eq("area.scan_area_key", area.key).gte("started_at", midnight))
    .order("desc")
    .take(500);
}

function overBudget(area: Doc<"scan_areas">, today: Doc<"agent_runs">[]): boolean {
  const spent = today.reduce((sum, r) => sum + (r.cost_usd ?? 0), 0);
  return spent >= (area.daily_budget_usd ?? DEFAULT_BUDGET_USD);
}

async function areaStores(ctx: MutationCtx, areaId: Id<"scan_areas">): Promise<Doc<"stores">[]> {
  const rows = await ctx.db
    .query("area_stores")
    .withIndex("by_area_and_last_seen_at", (q) => q.eq("area_id", areaId))
    .take(MAX_AREA_STORES);
  const stores = await Promise.all(rows.map((r) => ctx.db.get("stores", r.store_id)));
  return stores.filter((s): s is Doc<"stores"> => s !== null);
}

// ---------------------------------------------------------------- store batches

/** Pick and lease the next batch, in one transaction so two ticks can't take the same stores. Null: nothing to do. */
export const claimBatch = internalMutation({
  args: { areaId: v.id("scan_areas") },
  handler: async (ctx, { areaId }): Promise<Id<"agent_runs"> | null> => {
    const area = await ctx.db.get("scan_areas", areaId);
    if (!area?.enabled) return null;
    const now = Date.now();
    const today = await runsToday(ctx, area, now);
    const running = today.some(
      (r) =>
        scanKind(r.request) === "batch" &&
        (r.status === "queued" || r.status === "running") &&
        r.started_at > now - RUNNING_MAX,
    );
    if (running || overBudget(area, today)) return null;

    const due = (await areaStores(ctx, areaId)).filter((s) => (s.next_scan_at ?? 0) <= now);
    const scan = due.filter(scannable).sort(byScanPriority).slice(0, BATCH_SIZE);
    // Nothing to scrape yet: the API's Google lookup may find an account.
    const lookups = due.filter((s) => !scannable(s) && lookupDue(s, now)).slice(0, LOOKUPS_PER_BATCH);
    // Lookup-only stores first, so they're inside the API's per-run lookup cap; scannable stores missing an account
    // are looked up too, at most weekly.
    const picked = [...lookups, ...scan];
    if (!picked.length) return null;

    for (const s of picked) await ctx.db.patch("stores", s._id, { next_scan_at: now + LEASE });
    let lookupsLeft = API_LOOKUPS_PER_RUN;
    const stores = picked.map((s) => {
      const lookup = lookupsLeft > 0 && lookupDue(s, now);
      if (lookup) lookupsLeft--;
      return knownShop(s, { since: true, lookup });
    });
    const target = scanTarget(area);
    return insertRun(ctx, {
      provider: "apify_shops",
      trigger: "schedule",
      area: target,
      request: { location: scanLocation(target), radius_miles: area.radius_miles, stores },
      queries: [],
    });
  },
});

/** POST a queued run's request to /extract/shops and start polling it. Also re-sends a run the API lost. */
export const send = internalAction({
  args: { runId: v.id("agent_runs") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.runQuery(internal.scans.getRun, { runId });
    if (!run?.request || run.status !== "queued") return;
    try {
      const job = await dibsApi<{ job_id: string; status_url: string }>("/extract/shops", {
        method: "POST",
        body: JSON.stringify(run.request),
      });
      await ctx.runMutation(internal.ingest.updateRun, { runId, status: "running", api_job_id: job.job_id });
      await ctx.scheduler.runAfter(POLL_EVERY_MS, internal.scans.pollShops, { runId });
    } catch (err) {
      await ctx.runMutation(internal.ingest.updateRun, { runId, status: "failed", error: String(err) });
    }
  },
});

/** Watched areas with a shop list, the one batched longest ago first (so no area waits behind the others). */
export const areasToBatch = internalQuery({
  args: {},
  handler: async (ctx) => {
    const areas = await ctx.db
      .query("scan_areas")
      .withIndex("by_enabled_and_last_discovered_at", (q) => q.eq("enabled", true))
      .take(500);
    const out: { areaId: Id<"scan_areas">; last: number }[] = [];
    for (const area of areas) {
      if (area.store_count === 0 || !(await watched(ctx, area))) continue;
      const last = await ctx.db
        .query("agent_runs")
        .withIndex("by_area_and_started_at", (q) => q.eq("area.scan_area_key", area.key))
        .order("desc")
        .first();
      out.push({ areaId: area._id, last: last?.started_at ?? 0 });
    }
    return out.sort((a, b) => a.last - b.last).map((a) => a.areaId);
  },
});

export const scheduleBatches = internalAction({
  args: {},
  handler: async (ctx) => {
    if (!apiConfigured()) return;
    let started = 0;
    for (const areaId of await ctx.runQuery(internal.batches.areasToBatch, {})) {
      if (started >= MAX_AREAS_PER_TICK) break;
      const runId = await ctx.runMutation(internal.batches.claimBatch, { areaId });
      if (!runId) continue;
      await ctx.scheduler.runAfter(started * STAGGER_MS, internal.batches.send, { runId });
      started++;
    }
  },
});

/** One area's next batch now: `npx convex run batches:startBatch '{"areaId": "..."}'`. */
export const startBatch = internalAction({
  args: { areaId: v.id("scan_areas") },
  handler: async (ctx, { areaId }): Promise<Id<"agent_runs"> | null> => {
    if (!apiConfigured()) return null;
    const runId = await ctx.runMutation(internal.batches.claimBatch, { areaId });
    if (runId) await ctx.runAction(internal.batches.send, { runId });
    return runId;
  },
});

/** A finished batch (after ingest): each store's tier and next scan, from what its own channels showed. */
export const finishBatch = internalMutation({
  args: {
    runId: v.id("agent_runs"),
    storeIds: v.record(v.string(), v.id("stores")),
    scanned: v.array(
      v.object({ id: v.string(), posts: v.number(), deals: v.number(), latest_post_date: v.optional(v.string()) }),
    ),
  },
  handler: async (ctx, { runId, storeIds, scanned }) => {
    const run = await ctx.db.get("agent_runs", runId);
    const sent = ((run?.request as { stores?: KnownShop[] } | undefined)?.stores ?? []) as KnownShop[];
    const seen = new Map(scanned.map((s) => [s.id, s]));
    const now = Date.now();
    for (const k of sent) {
      const stat = seen.get(k.id);
      if (!stat) continue; // keeps its lease, so it's picked again within the hour
      const byId = storeIds[k.id];
      const store = byId
        ? await ctx.db.get("stores", byId)
        : await ctx.db
            .query("stores")
            .withIndex("by_external_id", (q) => q.eq("external_id", k.id))
            .unique();
      if (!store) continue;
      const followed =
        (await ctx.db
          .query("store_follows")
          .withIndex("by_store", (q) => q.eq("store_id", store._id))
          .first()) !== null;
      const postAt = stat.latest_post_date ? localToEpoch(stat.latest_post_date, "12:00", store.timezone) : undefined;
      const last_post_at = postAt !== undefined ? Math.max(store.last_post_at ?? 0, postAt) : store.last_post_at;
      const last_deal_at = stat.deals > 0 ? now : store.last_deal_at;
      const quiet_scans = stat.posts > 0 || stat.deals > 0 ? 0 : (store.quiet_scans ?? 0) + 1;
      const scan_tier = tierFor({ ...store, last_post_at, last_deal_at, quiet_scans }, { followed, now });
      const hadChannels = scannable(channelsOf(k));
      // A store the account lookup just gave a channel is scraped next tick, not in a week.
      const next_scan_at = !hadChannels && scannable(store) ? now : nextScanAt(scan_tier, now);
      await ctx.db.patch("stores", store._id, {
        scan_tier,
        next_scan_at,
        last_post_at,
        last_deal_at,
        quiet_scans,
        ...(k.lookup ? { accounts_checked_at: now } : {}),
      });
    }
  },
});

// ---------------------------------------------------------------- area sweeps

/** Queue today's sweep for the area, unless one already ran (or is running) today or the budget is spent. */
export const claimSweep = internalMutation({
  args: { areaId: v.id("scan_areas") },
  handler: async (ctx, { areaId }): Promise<Id<"agent_runs"> | null> => {
    const area = await ctx.db.get("scan_areas", areaId);
    if (!area?.enabled) return null;
    const now = Date.now();
    const today = await runsToday(ctx, area, now);
    if (today.some((r) => scanKind(r.request) === "sweep" && r.status !== "failed") || overBudget(area, today))
      return null;
    // The area's accounts, so posts by its shops count as their own (attribution only; their channels aren't scraped).
    const stores = (await areaStores(ctx, areaId))
      .filter((s) => s.instagram_handle || s.tiktok_handle || s.facebook_url)
      .map((s) => knownShop(s, { since: false, lookup: false }));
    const target = scanTarget(area);
    return insertRun(ctx, {
      provider: "apify_shops",
      trigger: "schedule",
      area: target,
      request: {
        location: scanLocation(target),
        radius_miles: area.radius_miles,
        sweep_only: true,
        stores,
        categories: area.categories,
        search_terms: area.search_terms ?? [],
      },
      queries: [],
    });
  },
});

export const scheduleSweeps = internalAction({
  args: {},
  handler: async (ctx) => {
    if (!apiConfigured()) return;
    let started = 0;
    for (const areaId of await ctx.runQuery(internal.batches.areasToBatch, {})) {
      const runId = await ctx.runMutation(internal.batches.claimSweep, { areaId });
      if (!runId) continue;
      await ctx.scheduler.runAfter(started * STAGGER_MS, internal.batches.send, { runId });
      started++;
    }
  },
});
