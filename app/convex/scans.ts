// The 24/7 agents: Convex calls the Dibs API and writes what it returns.
//
// - Scheduled scans (crons.ts → scheduleAreas): one /extract/shops job per area that has saved locations. The API
//   runs it as a background job (1 to 5 min); pollShops checks it every 15 s by rescheduling itself, because
//   actions aren't retried and shouldn't sit waiting.
// - User searches (requestSearch): /extract/search for the user's area, rate-limited and cached.
// Every run is an agent_runs row; scan_cache stops paying twice for the same query within CACHE_TTL.
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import type { DealIn, SourceIn, StoreIn } from "./ingest";
import { requireUser } from "./lib/auth";
import { type ApiJobStatus, type ApiSearchResponse, apiConfigured, dibsApi, DibsApiError } from "./lib/api";
import { rateLimiter } from "./lib/rateLimits";
import { normalizeUrl, sha256Hex } from "./lib/text";
import { HOUR } from "./lib/time";
import { area as areaValidator, dealType } from "./schema";

export const CACHE_TTL = 6 * HOUR;
const POLL_EVERY_MS = 15_000;
const MAX_POLLS = 40; // 10 minutes
const MAX_AREAS_PER_TICK = 3; // caps Apify spend per cron tick
const SCAN_SHOPS = Number(process.env.DIBS_SCAN_MAX_SHOPS ?? 8);

type Area = typeof areaValidator.type;

const DEAL_TYPES = new Set<string>(dealType.members.map((m) => m.value));

// ---------------------------------------------------------------- API response → ingest batches

const orUndef = <T>(x: T | null | undefined): T | undefined => (x === null ? undefined : x);
const hhmm = (t?: string | null) => (t ? t.slice(0, 5) : undefined);

export function toBatches(resp: ApiSearchResponse) {
  const dealCategory = new Map<string, string>();
  const shopOfSource = new Map<string, string>();
  for (const d of resp.deals) {
    if (!d.shop_id) continue;
    if (!dealCategory.has(d.shop_id)) dealCategory.set(d.shop_id, d.category);
    shopOfSource.set(normalizeUrl(d.source_url), d.shop_id);
  }
  const stores: StoreIn[] = resp.shops.map((s) => ({
    external_id: s.id,
    name: s.name,
    google_category: orUndef(s.category),
    deal_category: dealCategory.get(s.id),
    address: orUndef(s.address),
    lat: orUndef(s.lat),
    lng: orUndef(s.lng),
    website: orUndef(s.website),
    instagram: orUndef(s.instagram),
    tiktok: orUndef(s.tiktok),
    facebook: orUndef(s.facebook),
    place_id: orUndef(s.place_id),
    maps_url: orUndef(s.maps_url),
    found_via: s.found_via,
    hours: orUndef(s.hours),
  }));
  // Only sources a deal cites: the rest were read but led nowhere, and full page text is big.
  const cited = new Set(resp.deals.map((d) => normalizeUrl(d.source_url)));
  const sources: SourceIn[] = resp.sources
    .filter((s) => cited.has(normalizeUrl(s.url)))
    .map((s) => ({
      url: s.url,
      title: orUndef(s.title),
      text: orUndef(s.text),
      page_age: orUndef(s.page_age),
      origin: orUndef(s.origin),
      handle: orUndef(s.handle),
      shop_external_id: shopOfSource.get(normalizeUrl(s.url)),
    }));
  const deals: DealIn[] = resp.deals
    .filter((d) => d.id && d.shop_id)
    .map((d) => ({
      evidence_key: d.id!,
      shop_external_id: d.shop_id!,
      category: d.category,
      offer: d.offer,
      code: orUndef(d.code),
      conditions: d.conditions,
      start_date: orUndef(d.start_date),
      end_date: orUndef(d.end_date),
      start_time: hhmm(d.start_time),
      end_time: hhmm(d.end_time),
      source_url: d.source_url,
      source_post_date: orUndef(d.source_post_date),
      verbatim_quote: d.verbatim_quote,
      confidence: d.confidence,
      flags: d.flags,
      headline: orUndef(d.headline),
      title: orUndef(d.title),
      deal_types: (d.deal_types ?? []).filter((t) => DEAL_TYPES.has(t)) as DealIn["deal_types"],
      kind: d.kind ?? "deal",
      student_only: d.student_only ?? false,
      age_21: d.age_21 ?? false,
      est_savings_cents: orUndef(d.est_savings_cents),
      recurring_window: d.recurring_window
        ? {
            days: d.recurring_window.days,
            start_time: hhmm(d.recurring_window.start_time),
            end_time: hhmm(d.recurring_window.end_time),
          }
        : undefined,
    }));
  const rejected = resp.rejected.map((r) => ({ raw_deal: r.deal, reason: r.reason, source_url: r.deal?.source_url ?? undefined }));
  return { stores, sources, deals, rejected };
}

function chunk<T>(items: T[], size: number, weight: (t: T) => number = () => 1): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let w = 0;
  for (const item of items) {
    const iw = weight(item);
    if (cur.length && w + iw > size) {
      out.push(cur);
      cur = [];
      w = 0;
    }
    cur.push(item);
    w += iw;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Write a whole API response: stores, sources, deals, rejected, usage. Shared with photos.ts. */
export async function ingestResponse(
  ctx: ActionCtx,
  runId: Id<"agent_runs">,
  resp: ApiSearchResponse,
  opts: { scanAreaKey?: string; timezone?: string; notify: boolean },
) {
  const { stores, sources, deals, rejected } = toBatches(resp);
  const storeIds: Record<string, Id<"stores">> = {};
  for (const batch of chunk(stores, 25)) {
    Object.assign(
      storeIds,
      await ctx.runMutation(internal.ingest.upsertStores, { stores: batch, scanAreaKey: opts.scanAreaKey, timezone: opts.timezone }),
    );
  }
  const sourceIds: Record<string, Id<"sources">> = {};
  // About 2 MB of text per mutation (sources are capped at 200k chars each).
  for (const batch of chunk(sources, 2_000_000, (s) => Math.min(s.text?.length ?? 0, 200_000) + 500)) {
    Object.assign(sourceIds, await ctx.runMutation(internal.ingest.upsertSources, { runId, provider: resp.provider, sources: batch, storeIds }));
  }
  const dealIds: Record<string, Id<"deals">> = {};
  const created: Id<"deals">[] = [];
  const errors = [...resp.search_errors];
  for (const batch of chunk(deals, 20)) {
    const out = await ctx.runMutation(internal.ingest.upsertDeals, { runId, deals: batch, storeIds, sourceIds, notify: opts.notify });
    Object.assign(dealIds, out.dealIds);
    created.push(...out.created);
    errors.push(...out.errors);
  }
  for (const batch of chunk(rejected, 50)) await ctx.runMutation(internal.ingest.recordRejected, { runId, rejected: batch });
  await ctx.runMutation(internal.ingest.updateRun, {
    runId,
    status: "done",
    search_errors: errors.slice(0, 200),
    input_tokens: resp.usage.input_tokens,
    output_tokens: resp.usage.output_tokens,
    web_search_requests: resp.usage.web_search_requests,
    brightdata_requests: resp.brightdata_requests,
    apify_runs: resp.apify_runs,
    deals_found: deals.length,
  });
  return { dealIds, created, storeIds };
}

// ---------------------------------------------------------------- cache

export const cachedRun = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const hit = await ctx.db
      .query("scan_cache")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (!hit || hit.expires_at < Date.now()) return null;
    const run = await ctx.db.get("agent_runs", hit.run_id);
    return run && run.status !== "failed" ? run._id : null;
  },
});

export const putCache = internalMutation({
  args: { key: v.string(), runId: v.id("agent_runs") },
  handler: async (ctx, { key, runId }) => {
    const existing = await ctx.db
      .query("scan_cache")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    const expires_at = Date.now() + CACHE_TTL;
    if (existing) await ctx.db.patch("scan_cache", existing._id, { run_id: runId, expires_at });
    else await ctx.db.insert("scan_cache", { key, run_id: runId, expires_at });
  },
});

async function cacheKey(provider: string, body: unknown, areaKey: string) {
  return sha256Hex(`${provider}|${areaKey}|${JSON.stringify(body)}`);
}

function location(area: Area) {
  return {
    neighborhood: area.neighborhood,
    city: area.city ?? "Los Angeles",
    region: area.region ?? "California",
    country: "US",
    timezone: area.timezone ?? "America/Los_Angeles",
  };
}

// ---------------------------------------------------------------- /extract/shops (scheduled)

export const startShops = internalAction({
  args: {
    area: areaValidator,
    trigger: v.union(v.literal("schedule"), v.literal("user_search")),
    force: v.optional(v.boolean()),
    request: v.optional(v.any()), // extra ShopsRequest fields, e.g. {search_terms: ["boba"]}
  },
  handler: async (ctx, { area, trigger, force, request }): Promise<Id<"agent_runs"> | null> => {
    if (!apiConfigured()) return null;
    const body = {
      location: location(area),
      radius_miles: area.radius_miles ?? 1,
      max_shops: SCAN_SHOPS,
      ...(request ?? {}),
    };
    const key = await cacheKey("apify_shops", body, area.scan_area_key);
    if (!force) {
      const cached = await ctx.runQuery(internal.scans.cachedRun, { key });
      if (cached) return cached;
    }
    const runId = await ctx.runMutation(internal.ingest.startRun, {
      provider: "apify_shops",
      trigger,
      area,
      queries: (body as { search_terms?: string[] }).search_terms ?? [],
    });
    await ctx.runMutation(internal.scans.putCache, { key, runId });
    try {
      const job = await dibsApi<{ job_id: string; status_url: string }>("/extract/shops", {
        method: "POST",
        body: JSON.stringify(body),
      });
      await ctx.runMutation(internal.ingest.updateRun, { runId, status: "running", api_job_id: job.job_id });
      await ctx.scheduler.runAfter(POLL_EVERY_MS, internal.scans.pollShops, { runId });
    } catch (err) {
      await ctx.runMutation(internal.ingest.updateRun, { runId, status: "failed", error: String(err) });
    }
    return runId;
  },
});

export const getRun = internalQuery({
  args: { runId: v.id("agent_runs") },
  handler: (ctx, { runId }) => ctx.db.get("agent_runs", runId),
});

export const pollShops = internalAction({
  args: { runId: v.id("agent_runs") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.runQuery(internal.scans.getRun, { runId });
    if (!run || run.status !== "running" || !run.api_job_id) return;
    const attempts = run.poll_attempts + 1;
    let job: ApiJobStatus;
    try {
      job = await dibsApi<ApiJobStatus>(`/extract/shops/${run.api_job_id}`);
    } catch (err) {
      // 404: the API restarted and lost the job. Other errors: try again until the cap.
      const fatal = err instanceof DibsApiError && err.status === 404;
      if (fatal || attempts >= MAX_POLLS) {
        await ctx.runMutation(internal.ingest.updateRun, { runId, status: "failed", error: String(err), poll_attempts: attempts });
      } else {
        await ctx.runMutation(internal.ingest.updateRun, { runId, poll_attempts: attempts });
        await ctx.scheduler.runAfter(POLL_EVERY_MS, internal.scans.pollShops, { runId });
      }
      return;
    }
    if (job.status === "done" && job.result) {
      await ingestResponse(ctx, runId, job.result, {
        scanAreaKey: run.area?.scan_area_key,
        timezone: run.area?.timezone,
        notify: true,
      });
    } else if (job.status === "failed") {
      await ctx.runMutation(internal.ingest.updateRun, {
        runId,
        status: "failed",
        error: job.error ? `${job.error.status_code}: ${job.error.detail}` : "job failed",
        poll_attempts: attempts,
      });
    } else if (attempts >= MAX_POLLS) {
      await ctx.runMutation(internal.ingest.updateRun, { runId, status: "failed", error: "gave up polling after 10 minutes", poll_attempts: attempts });
    } else {
      await ctx.runMutation(internal.ingest.updateRun, { runId, poll_attempts: attempts });
      await ctx.scheduler.runAfter(POLL_EVERY_MS, internal.scans.pollShops, { runId });
    }
  },
});

/** One representative area per scan_area_key among saved locations, most-watched first. */
export const areasToScan = internalQuery({
  args: {},
  handler: async (ctx) => {
    const locations = await ctx.db.query("saved_locations").take(5000);
    const byArea = new Map<string, { area: Area; watchers: number }>();
    for (const loc of locations) {
      const entry = byArea.get(loc.scan_area_key);
      if (entry) entry.watchers++;
      else
        byArea.set(loc.scan_area_key, {
          watchers: 1,
          area: {
            scan_area_key: loc.scan_area_key,
            neighborhood: loc.neighborhood,
            city: loc.city,
            region: loc.region,
            timezone: loc.timezone,
            lat: loc.lat,
            lng: loc.lng,
            radius_miles: Math.max(1, loc.radius_miles),
            saved_location_id: loc._id,
          },
        });
    }
    const recent = new Set<string>();
    for (const { area } of byArea.values()) {
      const last = await ctx.db
        .query("agent_runs")
        .withIndex("by_area", (q) => q.eq("area.scan_area_key", area.scan_area_key))
        .order("desc")
        .first();
      if (last && last.status !== "failed" && last.started_at > Date.now() - CACHE_TTL) recent.add(area.scan_area_key);
    }
    return [...byArea.values()]
      .filter(({ area }) => !recent.has(area.scan_area_key) && area.neighborhood)
      .sort((a, b) => b.watchers - a.watchers)
      .map(({ area }) => area);
  },
});

export const scheduleAreas = internalAction({
  args: {},
  handler: async (ctx) => {
    const areas = await ctx.runQuery(internal.scans.areasToScan, {});
    // Staggered so the API's Apify memory gate isn't hit all at once.
    for (const [i, area] of areas.slice(0, MAX_AREAS_PER_TICK).entries()) {
      await ctx.scheduler.runAfter(i * 60_000, internal.scans.startShops, { area, trigger: "schedule" });
    }
  },
});

// ---------------------------------------------------------------- /extract/search (user-triggered)

/** "Search this area": rate-limited per user, cached per area. Returns the run to watch with scans.run. */
export const requestSearch = mutation({
  args: { area: areaValidator, query: v.optional(v.string()) },
  handler: async (ctx, { area, query: q }): Promise<Id<"agent_runs">> => {
    const user = await requireUser(ctx);
    await rateLimiter.limit(ctx, "userSearch", { key: user._id, throws: true });
    const runId = await ctx.db.insert("agent_runs", {
      provider: "claude_web_search",
      trigger: "user_search",
      status: "queued",
      area,
      queries: q ? [q] : [],
      poll_attempts: 0,
      requested_by: user._id,
      search_errors: [],
      input_tokens: 0,
      output_tokens: 0,
      web_search_requests: 0,
      brightdata_requests: 0,
      apify_runs: 0,
      deals_found: 0,
      started_at: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.scans.runSearch, { runId });
    return runId;
  },
});

export const runSearch = internalAction({
  args: { runId: v.id("agent_runs") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.runQuery(internal.scans.getRun, { runId });
    if (!run?.area) return;
    const body = {
      location: location(run.area),
      radius_miles: run.area.radius_miles ?? 1,
      query: run.queries[0],
      max_searches: 5,
    };
    const key = await cacheKey("claude_web_search", body, run.area.scan_area_key);
    if (await ctx.runQuery(internal.scans.cachedRun, { key })) {
      await ctx.runMutation(internal.ingest.updateRun, { runId, status: "done", search_errors: ["served from cache"] });
      return;
    }
    await ctx.runMutation(internal.ingest.updateRun, { runId, status: "running" });
    try {
      const resp = await dibsApi<ApiSearchResponse>("/extract/search", { method: "POST", body: JSON.stringify(body) });
      await ingestResponse(ctx, runId, resp, { scanAreaKey: run.area.scan_area_key, timezone: run.area.timezone, notify: true });
      await ctx.runMutation(internal.scans.putCache, { key, runId });
    } catch (err) {
      await ctx.runMutation(internal.ingest.updateRun, { runId, status: "failed", error: String(err) });
    }
  },
});

/** Status of a run the user started (for a spinner). */
export const run = query({
  args: { runId: v.id("agent_runs") },
  handler: async (ctx, { runId }) => {
    const r = await ctx.db.get("agent_runs", runId);
    return r ? { status: r.status, deals_found: r.deals_found, error: r.error ?? null } : null;
  },
});
