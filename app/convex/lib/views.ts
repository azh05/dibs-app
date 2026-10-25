// The deal shape the app renders (mapped onto app/src/lib/types.ts Deal / DealEvent by app/src/lib/feed.ts).
// Viewer-specific bits (saved, used, my vote) are filled when a user is signed in; distance comes from the caller.
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { isAdultStoreType } from "../catalog";
import { HOUR } from "./time";

export const LINE_WINDOW_MS = HOUR;

export async function dealView(
  ctx: QueryCtx,
  deal: Doc<"deals">,
  viewer: Doc<"users"> | null,
  distanceMeters: number | null = null,
) {
  const [store, source, line] = await Promise.all([
    ctx.db.get("stores", deal.store_id),
    ctx.db.get("sources", deal.primary_source_id),
    ctx.db
      .query("line_estimates")
      .withIndex("by_store", (q) => q.eq("store_id", deal.store_id))
      .unique(),
  ]);
  const evidence = await ctx.db
    .query("deal_evidence")
    .withIndex("by_deal_source", (q) => q.eq("deal_id", deal._id).eq("source_id", deal.primary_source_id))
    .first();
  let saved: Doc<"saved_deals"> | null = null;
  let vote: Doc<"votes"> | null = null;
  let following = false;
  if (viewer) {
    [saved, vote] = await Promise.all([
      ctx.db
        .query("saved_deals")
        .withIndex("by_user_deal", (q) => q.eq("user_id", viewer._id).eq("deal_id", deal._id))
        .unique(),
      ctx.db
        .query("votes")
        .withIndex("by_user_target", (q) => q.eq("user_id", viewer._id).eq("target_type", "deal").eq("target_id", deal._id))
        .unique(),
    ]);
    following = Boolean(
      await ctx.db
        .query("store_follows")
        .withIndex("by_user_store", (q) => q.eq("user_id", viewer._id).eq("store_id", deal.store_id))
        .unique(),
    );
  }
  const fresh = line && Date.now() - line.computed_at < LINE_WINDOW_MS && line.report_count > 0;
  return {
    id: deal._id,
    kind: deal.kind,
    status: deal.status,
    flags: deal.flags,
    confidence: deal.confidence,
    offer: deal.offer,
    title: deal.title ?? null,
    headline: deal.headline ?? null,
    deal_types: deal.deal_types,
    code: deal.code ?? null,
    conditions: deal.conditions,
    start_date: deal.start_date ?? null,
    end_date: deal.end_date ?? null,
    start_time: deal.start_time ?? null,
    end_time: deal.end_time ?? null,
    starts_at: deal.starts_at ?? null,
    ends_at: deal.ends_at ?? null,
    recurring_window: deal.recurring_window ?? null,
    student_only: deal.student_only,
    locked: deal.student_only && !viewer?.edu_verified_at,
    age_21: deal.age_21 || isAdultStoreType(deal.store_type),
    second_hand: deal.second_hand,
    est_savings_cents: deal.est_savings_cents ?? null,
    first_seen_at: deal.first_seen_at,
    last_verified_at: deal.last_verified_at,
    confirmations: deal.confirmation_count,
    last_confirmed_at: deal.last_confirmed_at ?? null,
    upvotes: deal.upvotes,
    downvotes: deal.downvotes,
    distance_m: distanceMeters,
    store: store && {
      id: store._id,
      name: store.name,
      store_type: store.store_type ?? null,
      address: store.address ?? null,
      lat: store.lat ?? null,
      lng: store.lng ?? null,
      hours: store.hours ?? null,
      timezone: store.timezone,
      instagram_handle: store.instagram_handle ?? null,
      maps_url: store.maps_url ?? null,
      geofence_m: store.geofence_m,
    },
    source: source && {
      kind: source.kind,
      url: source.kind === "photo" ? null : source.original_url,
      handle: source.author_handle ?? null,
      posted_at: deal.source_post_date ?? source.posted_at ?? null,
      quote: evidence?.verbatim_quote ?? null,
      caption: source.full_text.slice(0, 400),
    },
    line: fresh ? { minutes: line!.estimate_minutes, reports: line!.report_count } : null,
    saved: Boolean(saved),
    used: Boolean(saved?.used_at),
    my_vote: vote?.value ?? 0,
    following,
  };
}

export type DealView = Awaited<ReturnType<typeof dealView>>;

export function hiddenFor(deal: Doc<"deals">, viewer: Doc<"users"> | null): boolean {
  return (deal.age_21 || isAdultStoreType(deal.store_type)) && !viewer?.age_21_verified_at;
}

export type DealId = Id<"deals">;
