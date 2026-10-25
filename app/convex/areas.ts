// Scan areas: the circles the agents cover, and each one's shop list (area_stores).
//
// - assignArea (prefs.ts): a saved location joins an enabled area whose circle covers it, else widens one centred
//   close by, else starts a new area centred on it. People in the same circle share one area and one shop list.
// - Discovery: /discover/shops lists every shop in the circle from Google Maps (no posts, no deals). Each watched
//   area is refreshed every DISCOVERY_TTL by the cron (scheduleDiscovery), or straight away when a saved place
//   creates or widens it. claimDiscovery skips areas that are fresh or already running, so nothing is fetched twice.
//   scans.pollShops writes the result: stores through ingest, then recordDiscovery.
// - Deal scans add the stores they find (linkScanStores), so shops tagged in creator posts join the list too.
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { insertRun } from "./ingest";
import { apiConfigured, dibsApi } from "./lib/api";
import { areaGeo, haversineMeters, METERS_PER_MILE } from "./lib/geo";
import { areaKey } from "./lib/text";
import { DAY, HOUR, MINUTE } from "./lib/time";

/** An area's shop list is fresh this long: shops open and close slowly, and Google Maps is billed per place. */
export const DISCOVERY_TTL = 7 * DAY;
/** A store's deals are fresh this long (used by the per-store deal scans). */
export const DEAL_SCAN_TTL = 24 * HOUR;
/** A discovery still queued or running after this is presumed lost (the API keeps jobs in memory). */
const DISCOVERY_RUNNING_MAX = 35 * MINUTE;
const MIN_RADIUS_MILES = 1;
const MAX_RADIUS_MILES = 5;
const COVER_SLACK_MILES = 0.1;
const GROW_WITHIN_MILES = 0.5; // a location this close to an area's center widens it instead of starting another
const MAX_DISCOVERIES_PER_TICK = 2;
const DISCOVERY_STAGGER_MS = 5 * MINUTE; // each discovery is up to 7 Maps runs; leave Apify memory for deal scans
const DEFAULT_CATEGORIES = ["food", "drink"];
const MAX_SHOPS = Number(process.env.DIBS_DISCOVER_MAX_SHOPS ?? 250);

const miles = (meters: number) => meters / METERS_PER_MILE;

export function discoveryDue(area: Doc<"scan_areas">, now: number): boolean {
  if (!area.enabled) return false;
  if (area.last_discovered_at === undefined) return true;
  if ((area.discovered_radius_miles ?? 0) < area.radius_miles) return true;
  return area.last_discovered_at < now - DISCOVERY_TTL;
}

/** What the area-wide deal scan (scans.startShops) is sent for this area. */
export function scanTarget(area: Doc<"scan_areas">) {
  return {
    scan_area_key: area.key,
    neighborhood: area.neighborhood,
    city: area.city,
    region: area.region,
    timezone: area.timezone,
    lat: area.lat,
    lng: area.lng,
    radius_miles: area.radius_miles,
  };
}

async function uniqueKey(ctx: MutationCtx, base: string): Promise<string> {
  for (let n = 1; ; n++) {
    const key = n === 1 ? base : `${base}#${n}`;
    const taken = await ctx.db
      .query("scan_areas")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();
    if (!taken) return key;
  }
}

/** Put a saved location in an area (reuse, widen or create one) and point the location at it. */
export async function assignArea(
  ctx: MutationCtx,
  loc: Doc<"saved_locations">,
): Promise<{ area: Doc<"scan_areas">; needsDiscovery: boolean }> {
  const want = Math.min(loc.radius_miles, MAX_RADIUS_MILES); // the circle the location's alerts cover
  const hits = await areaGeo.nearest(ctx, {
    point: { latitude: loc.lat, longitude: loc.lng },
    maxDistance: (MAX_RADIUS_MILES + COVER_SLACK_MILES) * METERS_PER_MILE,
    limit: 20,
  });
  let area: Doc<"scan_areas"> | null = null;
  let widen: { area: Doc<"scan_areas">; radius: number } | null = null;
  for (const hit of hits) {
    const candidate = await ctx.db.get("scan_areas", hit.key);
    if (!candidate?.enabled) continue;
    const d = miles(hit.distance);
    if (d + want <= candidate.radius_miles + COVER_SLACK_MILES) {
      area = candidate;
      break;
    }
    if (!widen && d <= GROW_WITHIN_MILES && d + want <= MAX_RADIUS_MILES) widen = { area: candidate, radius: d + want };
  }
  if (!area && widen) {
    const radius = Math.ceil(widen.radius * 20) / 20; // to 0.05 mi
    await ctx.db.patch("scan_areas", widen.area._id, { radius_miles: radius });
    area = { ...widen.area, radius_miles: radius };
  }
  if (!area) {
    const id = await ctx.db.insert("scan_areas", {
      key: await uniqueKey(ctx, areaKey(loc)),
      name: loc.neighborhood ?? loc.city ?? loc.label,
      lat: loc.lat,
      lng: loc.lng,
      radius_miles: Math.max(want, MIN_RADIUS_MILES),
      neighborhood: loc.neighborhood,
      city: loc.city,
      region: loc.region,
      timezone: loc.timezone,
      categories: DEFAULT_CATEGORIES,
      enabled: true,
      store_count: 0,
      created_at: Date.now(),
    });
    await areaGeo.insert(ctx, id, { latitude: loc.lat, longitude: loc.lng }, {});
    area = (await ctx.db.get("scan_areas", id))!;
  }
  if (loc.scan_area_id !== area._id || loc.scan_area_key !== area.key) {
    await ctx.db.patch("saved_locations", loc._id, { scan_area_id: area._id, scan_area_key: area.key });
  }
  return { area, needsDiscovery: discoveryDue(area, Date.now()) };
}

/** One-off for locations saved before scan areas existed: `npx convex run areas:backfill`. Pages through itself. */
export const backfill = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("saved_locations").paginate({ numItems: 50, cursor: cursor ?? null });
    for (const loc of page.page) await assignArea(ctx, loc);
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.areas.backfill, { cursor: page.continueCursor });
    return { assigned: page.page.length, done: page.isDone };
  },
});

// ---------------------------------------------------------------- discovery

/** Enabled areas someone has a saved place in whose shop list is missing, stale or too small. Oldest first. */
export const areasToDiscover = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    const areas = await ctx.db
      .query("scan_areas")
      .withIndex("by_enabled_and_last_discovered_at", (q) => q.eq("enabled", true))
      .take(500);
    const due: Id<"scan_areas">[] = [];
    for (const area of areas) {
      if (!discoveryDue(area, now)) continue;
      const watched = await ctx.db
        .query("saved_locations")
        .withIndex("by_area", (q) => q.eq("scan_area_key", area.key))
        .first();
      if (watched) due.push(area._id);
    }
    return due;
  },
});

export const scheduleDiscovery = internalAction({
  args: {},
  handler: async (ctx) => {
    const due = await ctx.runQuery(internal.areas.areasToDiscover, { now: Date.now() });
    for (const [i, areaId] of due.slice(0, MAX_DISCOVERIES_PER_TICK).entries()) {
      await ctx.scheduler.runAfter(i * DISCOVERY_STAGGER_MS, internal.areas.startDiscovery, { areaId });
    }
  },
});

/** Check and start in one transaction, so two triggers can't both pay for the same area. Null: nothing to do. */
export const claimDiscovery = internalMutation({
  args: { areaId: v.id("scan_areas"), force: v.boolean() },
  handler: async (ctx, { areaId, force }) => {
    const area = await ctx.db.get("scan_areas", areaId);
    if (!area?.enabled) return null;
    const now = Date.now();
    if (!force && !discoveryDue(area, now)) return null;
    const last = await ctx.db
      .query("agent_runs")
      .withIndex("by_scan_area", (q) => q.eq("scan_area_id", areaId))
      .order("desc")
      .first();
    if (last && (last.status === "queued" || last.status === "running") && last.started_at > now - DISCOVERY_RUNNING_MAX) return null;
    const request = {
      location: {
        neighborhood: area.neighborhood,
        city: area.city ?? "Los Angeles",
        region: area.region ?? "California",
        country: "US",
        timezone: area.timezone,
      },
      lat: area.lat,
      lng: area.lng,
      radius_miles: area.radius_miles,
      categories: area.categories,
      search_terms: area.search_terms ?? [],
      max_shops: MAX_SHOPS,
    };
    const runId = await insertRun(ctx, {
      provider: "apify_maps",
      trigger: "schedule",
      scan_area_id: areaId,
      request,
      queries: area.search_terms ?? area.categories,
    });
    return { runId, request };
  },
});

export const startDiscovery = internalAction({
  args: { areaId: v.id("scan_areas"), force: v.optional(v.boolean()) },
  handler: async (ctx, { areaId, force }): Promise<Id<"agent_runs"> | null> => {
    if (!apiConfigured()) return null;
    const claim = await ctx.runMutation(internal.areas.claimDiscovery, { areaId, force: force ?? false });
    if (!claim) return null;
    try {
      const job = await dibsApi<{ job_id: string; status_url: string }>("/discover/shops", {
        method: "POST",
        body: JSON.stringify(claim.request),
      });
      await ctx.runMutation(internal.ingest.updateRun, { runId: claim.runId, status: "running", api_job_id: job.job_id });
      await ctx.scheduler.runAfter(15_000, internal.scans.pollShops, { runId: claim.runId });
    } catch (err) {
      await ctx.runMutation(internal.ingest.updateRun, { runId: claim.runId, status: "failed", error: String(err) });
    }
    return claim.runId;
  },
});

export const get = internalQuery({
  args: { areaId: v.id("scan_areas") },
  handler: (ctx, { areaId }) => ctx.db.get("scan_areas", areaId),
});

async function link(
  ctx: MutationCtx,
  area: Doc<"scan_areas">,
  storeIds: Id<"stores">[],
  via: Doc<"area_stores">["via"],
  now: number,
): Promise<number> {
  let linked = 0;
  for (const storeId of new Set(storeIds)) {
    const store = await ctx.db.get("stores", storeId);
    if (!store) continue;
    const distance_m =
      store.lat !== undefined && store.lng !== undefined ? Math.round(haversineMeters(area, { lat: store.lat, lng: store.lng })) : undefined;
    // A deal scan also returns shops far away (a creator mentioned them); only those inside the circle, or of unknown
    // whereabouts (handle only), belong on the list.
    if (via === "scan" && distance_m !== undefined && distance_m > area.radius_miles * METERS_PER_MILE) continue;
    const existing = await ctx.db
      .query("area_stores")
      .withIndex("by_area_and_store", (q) => q.eq("area_id", area._id).eq("store_id", storeId))
      .unique();
    if (!existing) {
      await ctx.db.insert("area_stores", { area_id: area._id, store_id: storeId, distance_m, via, first_seen_at: now, last_seen_at: now });
    } else if (via === "maps") {
      // last_seen_at on a maps row means "still on Google Maps", so only discovery bumps it.
      await ctx.db.patch("area_stores", existing._id, { via, distance_m, last_seen_at: now });
    }
    linked++;
  }
  return linked;
}

/** A finished discovery: link its stores to the area and mark the list fresh. */
export const recordDiscovery = internalMutation({
  args: { runId: v.id("agent_runs"), storeIds: v.array(v.id("stores")) },
  handler: async (ctx, { runId, storeIds }) => {
    const run = await ctx.db.get("agent_runs", runId);
    const area = run?.scan_area_id ? await ctx.db.get("scan_areas", run.scan_area_id) : null;
    if (!run || !area) return;
    const now = Date.now();
    const linked = await link(ctx, area, storeIds, "maps", now);
    const radius = (run.request as { radius_miles?: number } | undefined)?.radius_miles ?? area.radius_miles;
    await ctx.db.patch("scan_areas", area._id, { store_count: linked, last_discovered_at: now, discovered_radius_miles: radius });
  },
});

/** Stores an area-wide deal scan found, added to that area's list. */
export const linkScanStores = internalMutation({
  args: { scanAreaKey: v.string(), storeIds: v.array(v.id("stores")) },
  handler: async (ctx, { scanAreaKey, storeIds }) => {
    const area = await ctx.db
      .query("scan_areas")
      .withIndex("by_key", (q) => q.eq("key", scanAreaKey))
      .unique();
    if (area) await link(ctx, area, storeIds, "scan", Date.now());
  },
});

/** An area's shop list, most recently seen first: `npx convex run areas:storesInArea '{"areaId": ..., ...}'`. */
export const storesInArea = internalQuery({
  args: { areaId: v.id("scan_areas"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { areaId, paginationOpts }) => {
    const page = await ctx.db
      .query("area_stores")
      .withIndex("by_area_and_last_seen_at", (q) => q.eq("area_id", areaId))
      .order("desc")
      .paginate(paginationOpts);
    return {
      ...page,
      page: await Promise.all(
        page.page.map(async (row) => ({ ...row, store: await ctx.db.get("stores", row.store_id) })),
      ),
    };
  },
});
