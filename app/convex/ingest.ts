// Writes an API SearchResponse into the tables, in batches (stores, then sources, then deals) so each mutation stays
// well under Convex's per-transaction limits. Called from scans.ts and photos.ts.
//
// Upsert keys: stores by external_id (Shop.id), else Instagram handle, else name within the scanned area; sources by
// normalized URL; deal_evidence by evidence_key (Deal.id: one post's evidence); deals by dedupe_key (the same offer
// seen in several posts). A re-run of the same scan changes nothing but last_verified_at.
import { v, type Infer } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { storeTypeFor } from "./catalog";
import { dealTimes, statusNow, syncDealGeo } from "./lib/deals";
import { isActive } from "./lib/status";
import { alnum, contentHash, namesMatch, normalizeUrl, normName } from "./lib/text";
import { DEFAULT_TIMEZONE } from "./lib/time";
import { confidence, dealType, provider, recurringWindow, sourceKind } from "./schema";

export const MAX_SOURCE_CHARS = 200_000;

export const storeIn = v.object({
  external_id: v.string(),
  name: v.string(),
  google_category: v.optional(v.string()),
  deal_category: v.optional(v.string()), // the first linked deal's category, for stores Maps didn't categorise
  address: v.optional(v.string()),
  lat: v.optional(v.number()),
  lng: v.optional(v.number()),
  website: v.optional(v.string()),
  instagram: v.optional(v.string()),
  tiktok: v.optional(v.string()),
  facebook: v.optional(v.string()),
  place_id: v.optional(v.string()),
  maps_url: v.optional(v.string()),
  found_via: v.union(v.literal("google_maps"), v.literal("named"), v.literal("mention"), v.literal("deal")),
  hours: v.optional(v.array(v.object({ day: v.string(), hours: v.string() }))),
});

export const sourceIn = v.object({
  url: v.string(),
  title: v.optional(v.string()),
  text: v.optional(v.string()),
  page_age: v.optional(v.string()),
  origin: v.optional(v.string()),
  handle: v.optional(v.string()),
  shop_external_id: v.optional(v.string()), // the store whose deal cites it
});

export const dealIn = v.object({
  evidence_key: v.string(), // Deal.id
  shop_external_id: v.string(), // Deal.shop_id
  category: v.string(),
  offer: v.string(),
  code: v.optional(v.string()),
  conditions: v.array(v.string()),
  start_date: v.optional(v.string()),
  end_date: v.optional(v.string()),
  start_time: v.optional(v.string()),
  end_time: v.optional(v.string()),
  source_url: v.string(),
  source_post_date: v.optional(v.string()),
  verbatim_quote: v.string(),
  confidence,
  flags: v.array(v.string()),
  headline: v.optional(v.string()),
  title: v.optional(v.string()),
  deal_types: v.array(dealType),
  kind: v.union(v.literal("deal"), v.literal("event")),
  student_only: v.boolean(),
  age_21: v.boolean(),
  est_savings_cents: v.optional(v.number()),
  recurring_window: v.optional(recurringWindow),
});

export type StoreIn = Infer<typeof storeIn>;
export type SourceIn = Infer<typeof sourceIn>;
export type DealIn = Infer<typeof dealIn>;

// ---------------------------------------------------------------- runs

export const startRun = internalMutation({
  args: {
    provider,
    trigger: v.union(v.literal("schedule"), v.literal("user_search"), v.literal("photo")),
    area: v.optional(
      v.object({
        scan_area_key: v.string(),
        neighborhood: v.optional(v.string()),
        city: v.optional(v.string()),
        region: v.optional(v.string()),
        timezone: v.optional(v.string()),
        lat: v.optional(v.number()),
        lng: v.optional(v.number()),
        radius_miles: v.optional(v.number()),
        saved_location_id: v.optional(v.id("saved_locations")),
      }),
    ),
    queries: v.array(v.string()),
    requested_by: v.optional(v.id("users")),
  },
  handler: async (ctx, args) =>
    ctx.db.insert("agent_runs", {
      ...args,
      status: "queued",
      poll_attempts: 0,
      search_errors: [],
      input_tokens: 0,
      output_tokens: 0,
      web_search_requests: 0,
      brightdata_requests: 0,
      apify_runs: 0,
      deals_found: 0,
      started_at: Date.now(),
    }),
});

export const updateRun = internalMutation({
  args: {
    runId: v.id("agent_runs"),
    status: v.optional(v.union(v.literal("queued"), v.literal("running"), v.literal("done"), v.literal("failed"))),
    error: v.optional(v.string()),
    api_job_id: v.optional(v.string()),
    poll_attempts: v.optional(v.number()),
    search_errors: v.optional(v.array(v.string())),
    input_tokens: v.optional(v.number()),
    output_tokens: v.optional(v.number()),
    web_search_requests: v.optional(v.number()),
    brightdata_requests: v.optional(v.number()),
    apify_runs: v.optional(v.number()),
    deals_found: v.optional(v.number()),
  },
  handler: async (ctx, { runId, ...patch }) => {
    const finished = patch.status === "done" || patch.status === "failed" ? { finished_at: Date.now() } : {};
    const clean = Object.fromEntries(Object.entries(patch).filter(([, val]) => val !== undefined));
    await ctx.db.patch("agent_runs", runId, { ...clean, ...finished });
  },
});

// ---------------------------------------------------------------- stores

async function findStore(ctx: MutationCtx, s: StoreIn, scanAreaKey?: string): Promise<Doc<"stores"> | null> {
  const byId = await ctx.db
    .query("stores")
    .withIndex("by_external_id", (q) => q.eq("external_id", s.external_id))
    .unique();
  if (byId) return byId;
  if (s.instagram) {
    const byHandle = await ctx.db
      .query("stores")
      .withIndex("by_instagram_handle", (q) => q.eq("instagram_handle", s.instagram!.toLowerCase()))
      .first();
    if (byHandle) return byHandle;
  }
  if (scanAreaKey) {
    const name = normName(s.name);
    const exact = await ctx.db
      .query("stores")
      .withIndex("by_area_name", (q) => q.eq("scan_area_key", scanAreaKey).eq("normalized_name", name))
      .first();
    if (exact) return exact;
    // "Milksha" from a creator post = "Milksha Westwood" from Maps, but only within the same area.
    const nearby = await ctx.db
      .query("stores")
      .withIndex("by_area_name", (q) => q.eq("scan_area_key", scanAreaKey))
      .take(400);
    return nearby.find((st) => namesMatch(st.name, s.name)) ?? null;
  }
  return null;
}

/** Returns external_id → stores row id, for every incoming shop. */
export const upsertStores = internalMutation({
  args: { stores: v.array(storeIn), scanAreaKey: v.optional(v.string()), timezone: v.optional(v.string()) },
  handler: async (ctx, { stores, scanAreaKey, timezone }): Promise<Record<string, Id<"stores">>> => {
    const now = Date.now();
    const out: Record<string, Id<"stores">> = {};
    for (const s of stores) {
      const existing = await findStore(ctx, s, scanAreaKey);
      const storeType = storeTypeFor(s.google_category, s.deal_category);
      const fields = {
        name: s.name,
        normalized_name: normName(s.name),
        google_category: s.google_category,
        store_type: storeType,
        address: s.address,
        lat: s.lat,
        lng: s.lng,
        website: s.website,
        instagram_handle: s.instagram?.toLowerCase(),
        tiktok_handle: s.tiktok?.toLowerCase(),
        facebook_url: s.facebook,
        google_place_id: s.place_id,
        maps_url: s.maps_url,
        hours: s.hours,
      };
      if (!existing) {
        out[s.external_id] = await ctx.db.insert("stores", {
          ...fields,
          external_id: s.external_id,
          found_via: s.found_via,
          timezone: timezone ?? DEFAULT_TIMEZONE,
          scan_area_key: scanAreaKey,
          is_chain: false,
          geofence_m: 75,
          upvotes: 0,
          downvotes: 0,
          last_scanned_at: now,
          created_at: now,
        });
        continue;
      }
      // Fill what we didn't know; Google Maps data wins over a name-only record.
      const patch: Partial<Doc<"stores">> = { last_scanned_at: now };
      for (const [key, value] of Object.entries(fields) as [keyof typeof fields, unknown][]) {
        if (value === undefined) continue;
        if (existing[key] === undefined || s.found_via === "google_maps") (patch as Record<string, unknown>)[key] = value;
      }
      if (s.found_via === "google_maps" && !existing.external_id.startsWith("gmaps:")) {
        patch.external_id = s.external_id;
        patch.found_via = "google_maps";
      }
      if (!existing.scan_area_key && scanAreaKey) patch.scan_area_key = scanAreaKey;
      const gainedCoords = existing.lat === undefined && patch.lat !== undefined;
      const typeChanged = patch.store_type !== undefined && patch.store_type !== existing.store_type;
      await ctx.db.patch("stores", existing._id, patch);
      if (gainedCoords || typeChanged) {
        for (const deal of await ctx.db.query("deals").withIndex("by_store", (q) => q.eq("store_id", existing._id)).collect()) {
          if (typeChanged) await ctx.db.patch("deals", deal._id, { store_type: patch.store_type });
          await syncDealGeo(ctx, deal._id, { force: typeChanged });
        }
      }
      out[s.external_id] = existing._id;
    }
    return out;
  },
});

// ---------------------------------------------------------------- sources

function sourceKindFor(origin: string | undefined, url: string, prov: Doc<"sources">["provider"]): Infer<typeof sourceKind> {
  if (origin === "photo" || prov === "user_photo") return "photo";
  if (origin === "serp") return "google";
  if (origin === "instagram" || origin === "tiktok" || origin === "facebook" || origin === "website") return origin;
  const host = normalizeUrl(url).split("/")[0] ?? "";
  if (host.endsWith("instagram.com")) return "instagram";
  if (host.endsWith("tiktok.com")) return "tiktok";
  if (host.endsWith("facebook.com")) return "facebook";
  return "website";
}

/** Returns normalized URL → sources row id. */
export const upsertSources = internalMutation({
  args: {
    runId: v.id("agent_runs"),
    provider,
    sources: v.array(sourceIn),
    storeIds: v.record(v.string(), v.id("stores")),
  },
  handler: async (ctx, { runId, provider: prov, sources, storeIds }): Promise<Record<string, Id<"sources">>> => {
    const now = Date.now();
    const out: Record<string, Id<"sources">> = {};
    for (const s of sources) {
      const url = normalizeUrl(s.url);
      const text = (s.text ?? "").slice(0, MAX_SOURCE_CHARS);
      const hash = contentHash(text);
      const storeId = s.shop_external_id ? storeIds[s.shop_external_id] : undefined;
      const postedAt = s.page_age && /^\d{4}-\d{2}-\d{2}$/.test(s.page_age) ? s.page_age : undefined;
      const existing = await ctx.db
        .query("sources")
        .withIndex("by_url", (q) => q.eq("url", url))
        .unique();
      if (existing) {
        const patch: Partial<Doc<"sources">> = { fetched_at: now };
        if (text && hash !== existing.content_hash) Object.assign(patch, { full_text: text, content_hash: hash });
        if (!existing.store_id && storeId) patch.store_id = storeId;
        if (!existing.posted_at && postedAt) patch.posted_at = postedAt;
        await ctx.db.patch("sources", existing._id, patch);
        out[url] = existing._id;
        continue;
      }
      out[url] = await ctx.db.insert("sources", {
        store_id: storeId,
        provider: prov,
        kind: sourceKindFor(s.origin, s.url, prov),
        url,
        original_url: s.url,
        author_handle: s.handle?.replace(/^@/, "").toLowerCase(),
        title: s.title,
        full_text: text,
        posted_at: postedAt,
        page_age: s.page_age,
        content_hash: hash,
        fetched_at: now,
        first_seen_run_id: runId,
      });
    }
    return out;
  },
});

// ---------------------------------------------------------------- deals

const CONFIDENCE_RANK = { low: 0, medium: 1, high: 2 } as const;

export const upsertDeals = internalMutation({
  args: {
    runId: v.id("agent_runs"),
    deals: v.array(dealIn),
    storeIds: v.record(v.string(), v.id("stores")),
    sourceIds: v.record(v.string(), v.id("sources")),
    notify: v.boolean(), // false for a user photo: alerts go out once it's confirmed
  },
  handler: async (
    ctx,
    { runId, deals, storeIds, sourceIds, notify },
  ): Promise<{ dealIds: Record<string, Id<"deals">>; created: Id<"deals">[]; errors: string[] }> => {
    const now = Date.now();
    const dealIds: Record<string, Id<"deals">> = {};
    const created: Id<"deals">[] = [];
    const errors: string[] = [];

    for (const d of deals) {
      const storeId = storeIds[d.shop_external_id];
      const sourceId = sourceIds[normalizeUrl(d.source_url)];
      const store = storeId ? await ctx.db.get("stores", storeId) : null;
      if (!store || !sourceId) {
        errors.push(`skipped a deal at ${d.shop_external_id}: unknown ${store ? "source" : "shop"}`);
        continue;
      }
      const source = (await ctx.db.get("sources", sourceId))!;
      const secondHand = d.flags.includes("second_hand");
      // Claude's web search returns no page text, so the quote is the text we keep.
      if (!source.full_text.includes(d.verbatim_quote)) {
        const full_text = `${source.full_text}${source.full_text ? "\n\n" : ""}${d.verbatim_quote}`.slice(0, MAX_SOURCE_CHARS);
        await ctx.db.patch("sources", sourceId, { full_text, store_id: source.store_id ?? storeId });
      }

      const evidence = await ctx.db
        .query("deal_evidence")
        .withIndex("by_evidence_key", (q) => q.eq("evidence_key", d.evidence_key))
        .unique();
      const dedupeKey = `${storeId}|${alnum(d.offer)}|${alnum(d.code ?? "")}`;
      let deal = evidence
        ? await ctx.db.get("deals", evidence.deal_id)
        : await ctx.db
            .query("deals")
            .withIndex("by_dedupe_key", (q) => q.eq("dedupe_key", dedupeKey))
            .unique();

      const timezone = store.timezone;
      const dates = {
        start_date: d.start_date,
        end_date: d.end_date,
        start_time: d.start_time,
        end_time: d.end_time,
      };

      let reindex = false;
      if (!deal) {
        const base = {
          ...dates,
          timezone,
          source_post_date: d.source_post_date,
          confidence: d.confidence,
          ended_count: 0,
        };
        const id = await ctx.db.insert("deals", {
          store_id: storeId,
          offer: d.offer,
          category: d.category,
          code: d.code,
          conditions: d.conditions,
          ...base,
          ...dealTimes(base),
          kind: d.kind,
          status: statusNow(base),
          flags: d.flags,
          dedupe_key: dedupeKey,
          second_hand: secondHand,
          first_seen_at: now,
          last_verified_at: now,
          primary_source_id: sourceId,
          upvotes: 0,
          downvotes: 0,
          confirmation_count: 0,
          headline: d.headline,
          title: d.title,
          deal_types: d.deal_types,
          student_only: d.student_only,
          age_21: d.age_21,
          recurring_window: d.recurring_window,
          est_savings_cents: d.est_savings_cents,
          store_type: store.store_type,
          scan_area_key: store.scan_area_key,
          has_coords: store.lat !== undefined && store.lng !== undefined,
          geo_indexed: false,
        });
        deal = (await ctx.db.get("deals", id))!;
        created.push(id);
      } else {
        // Newer extraction: take any dates it states, keep the best confidence, merge types, refresh status.
        const merged = {
          start_date: d.start_date ?? deal.start_date,
          end_date: d.end_date ?? deal.end_date,
          start_time: d.start_time ?? deal.start_time,
          end_time: d.end_time ?? deal.end_time,
          timezone,
          source_post_date:
            d.source_post_date && (!deal.source_post_date || d.source_post_date > deal.source_post_date)
              ? d.source_post_date
              : deal.source_post_date,
          confidence: CONFIDENCE_RANK[d.confidence] > CONFIDENCE_RANK[deal.confidence] ? d.confidence : deal.confidence,
          ended_count: deal.ended_count,
        };
        const dealTypes = Array.from(new Set([...deal.deal_types, ...d.deal_types]));
        reindex = dealTypes.length !== deal.deal_types.length;
        const flags = Array.from(new Set([...deal.flags, ...d.flags]));
        await ctx.db.patch("deals", deal._id, {
          ...merged,
          ...dealTimes(merged),
          status: statusNow(merged),
          flags,
          code: deal.code ?? d.code,
          headline: deal.headline ?? d.headline,
          title: deal.title ?? d.title,
          deal_types: dealTypes,
          kind: deal.kind === "event" || d.kind === "event" ? "event" : "deal",
          student_only: deal.student_only || d.student_only,
          age_21: deal.age_21 || d.age_21,
          est_savings_cents: deal.est_savings_cents ?? d.est_savings_cents,
          recurring_window: deal.recurring_window ?? d.recurring_window,
          last_verified_at: now,
          // A shop's own post beats a creator's as the primary source.
          primary_source_id: deal.second_hand && !secondHand ? sourceId : deal.primary_source_id,
        });
        deal = (await ctx.db.get("deals", deal._id))!;
      }

      if (!evidence) {
        const sameSource = await ctx.db
          .query("deal_evidence")
          .withIndex("by_deal_source", (q) => q.eq("deal_id", deal!._id).eq("source_id", sourceId))
          .unique();
        if (!sameSource)
          await ctx.db.insert("deal_evidence", {
            evidence_key: d.evidence_key,
            deal_id: deal._id,
            source_id: sourceId,
            verbatim_quote: d.verbatim_quote,
            source_post_date: d.source_post_date,
            second_hand: secondHand,
            extracted_run_id: runId,
          });
      }
      // second_hand only while every piece of evidence is second-hand.
      const allEvidence = await ctx.db
        .query("deal_evidence")
        .withIndex("by_deal", (q) => q.eq("deal_id", deal!._id))
        .collect();
      const allSecondHand = allEvidence.every((e) => e.second_hand);
      const flags = deal.flags.filter((f) => f !== "second_hand");
      if (allSecondHand) flags.push("second_hand");
      if (allSecondHand !== deal.second_hand || flags.join() !== deal.flags.join())
        await ctx.db.patch("deals", deal._id, { second_hand: allSecondHand, flags });

      await syncDealGeo(ctx, deal._id, { force: reindex });
      dealIds[d.evidence_key] = deal._id;
      if (notify && created.includes(deal._id) && isActive(deal.status))
        await ctx.scheduler.runAfter(0, internal.notify.fanout, { dealId: deal._id });
    }
    return { dealIds, created, errors };
  },
});

export const recordRejected = internalMutation({
  args: {
    runId: v.id("agent_runs"),
    rejected: v.array(v.object({ raw_deal: v.any(), reason: v.string(), source_url: v.optional(v.string()) })),
  },
  handler: async (ctx, { runId, rejected }) => {
    for (const r of rejected) {
      const source = r.source_url
        ? await ctx.db
            .query("sources")
            .withIndex("by_url", (q) => q.eq("url", normalizeUrl(r.source_url!)))
            .unique()
        : null;
      await ctx.db.insert("rejected_extractions", { run_id: runId, source_id: source?._id, raw_deal: r.raw_deal, reason: r.reason });
    }
  },
});
