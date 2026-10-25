// "How long is the line?": reports from users standing at the store, blended into one estimate per store.
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireUser } from "./lib/auth";
import { awardXp, bumpChallenges, checkBadges, LINE_CHECK_DAILY_CAP, reverseXp, XP } from "./lib/gamify";
import { haversineMeters } from "./lib/geo";
import { blend } from "./lib/line";
import { rateLimiter } from "./lib/rateLimits";
import { DAY, HOUR, MINUTE } from "./lib/time";

const WINDOW = HOUR;
const UNDO_WINDOW = 2 * MINUTE;

async function recompute(ctx: MutationCtx, storeId: Id<"stores">) {
  const now = Date.now();
  const recent = await ctx.db
    .query("line_reports")
    .withIndex("by_store_time", (q) => q.eq("store_id", storeId).gt("reported_at", now - WINDOW))
    .collect();
  const inFence = recent.filter((r) => r.in_geofence);
  const withScores = await Promise.all(
    inFence.map(async (r) => ({ ...r, score: (await ctx.db.get("users", r.user_id))?.reporter_score ?? 1 })),
  );
  const result = blend(withScores, now);
  const existing = await ctx.db
    .query("line_estimates")
    .withIndex("by_store", (q) => q.eq("store_id", storeId))
    .unique();
  const fields = { estimate_minutes: result?.minutes ?? 0, report_count: result?.count ?? 0, computed_at: now };
  if (existing) await ctx.db.patch("line_estimates", existing._id, fields);
  else await ctx.db.insert("line_estimates", { store_id: storeId, ...fields });
}

export const report = mutation({
  args: { storeId: v.id("stores"), wait_minutes: v.number(), lat: v.number(), lng: v.number() },
  handler: async (ctx, { storeId, wait_minutes, lat, lng }) => {
    const user = await requireUser(ctx);
    await rateLimiter.limit(ctx, "lineReport", { key: user._id, throws: true });
    const store = await ctx.db.get("stores", storeId);
    if (!store) throw new Error("Unknown store");
    const minutes = Math.min(Math.max(Math.round(wait_minutes), 0), 180);
    const inGeofence =
      store.lat !== undefined && store.lng !== undefined && haversineMeters({ lat, lng }, { lat: store.lat, lng: store.lng }) <= store.geofence_m;
    const now = Date.now();
    let xpId: Id<"xp_ledger"> | undefined;
    if (inGeofence) {
      const today = await ctx.db
        .query("xp_ledger")
        .withIndex("by_user_reason_time", (q) => q.eq("user_id", user._id).eq("reason", "line_check").gt("created_at", now - DAY))
        .collect();
      if (today.length < LINE_CHECK_DAILY_CAP) xpId = await awardXp(ctx, user._id, XP.line_check, "line_check", storeId);
    }
    const reportId = await ctx.db.insert("line_reports", {
      store_id: storeId,
      user_id: user._id,
      wait_minutes: minutes,
      reported_at: now,
      lat,
      lng,
      in_geofence: inGeofence,
      xp_ledger_id: xpId,
    });
    await recompute(ctx, storeId);
    if (inGeofence) {
      await bumpChallenges(ctx, user._id, "line_checks", store.store_type);
      await checkBadges(ctx, user._id, "line_check");
    }
    return { reportId, in_geofence: inGeofence, xp: xpId ? XP.line_check : 0 };
  },
});

export const undo = mutation({
  args: { reportId: v.id("line_reports") },
  handler: async (ctx, { reportId }) => {
    const user = await requireUser(ctx);
    const r = await ctx.db.get("line_reports", reportId);
    if (!r || r.user_id !== user._id) return;
    if (Date.now() - r.reported_at > UNDO_WINDOW) throw new Error("Too late to undo");
    if (r.xp_ledger_id) await reverseXp(ctx, r.xp_ledger_id);
    await ctx.db.delete("line_reports", reportId);
    await recompute(ctx, r.store_id);
  },
});

export const estimate = query({
  args: { storeId: v.id("stores") },
  handler: async (ctx, { storeId }) => {
    const e = await ctx.db
      .query("line_estimates")
      .withIndex("by_store", (q) => q.eq("store_id", storeId))
      .unique();
    if (!e || !e.report_count || Date.now() - e.computed_at > WINDOW) return null;
    return { minutes: e.estimate_minutes, reports: e.report_count, computed_at: e.computed_at };
  },
});

export type LineReport = Doc<"line_reports">;
