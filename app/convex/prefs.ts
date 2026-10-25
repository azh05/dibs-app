// Saved locations, "Notify me about" chips, deal-type chips, the Instant toggle, store follows and push devices.
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { getUser, requireUser } from "./lib/auth";
import { locationGeo } from "./lib/geo";
import { ACTIVE_STATUSES } from "./lib/status";
import { areaKey } from "./lib/text";
import { DEFAULT_TIMEZONE } from "./lib/time";
import { dealType } from "./schema";
import { CACHE_TTL } from "./scans";

async function syncLocationGeo(ctx: MutationCtx, loc: Doc<"saved_locations">) {
  if (loc.notify) await locationGeo.insert(ctx, loc._id, { latitude: loc.lat, longitude: loc.lng }, {});
  else await locationGeo.remove(ctx, loc._id);
}

/** Kick off a scan for an area nobody has scanned lately, so a new user's feed fills in. */
async function scanIfNew(ctx: MutationCtx, loc: Doc<"saved_locations">) {
  if (!loc.neighborhood) return;
  const last = await ctx.db
    .query("agent_runs")
    .withIndex("by_area", (q) => q.eq("area.scan_area_key", loc.scan_area_key))
    .order("desc")
    .first();
  if (last && last.status !== "failed" && last.started_at > Date.now() - CACHE_TTL) return;
  await ctx.scheduler.runAfter(0, internal.scans.startShops, {
    trigger: "schedule",
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

export const savedLocations = query({
  args: {},
  handler: async (ctx) => {
    const user = await getUser(ctx);
    if (!user) return [];
    const rows = await ctx.db
      .query("saved_locations")
      .withIndex("by_user", (q) => q.eq("user_id", user._id))
      .collect();
    return rows.sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.created_at - b.created_at);
  },
});

export const saveLocation = mutation({
  args: {
    id: v.optional(v.id("saved_locations")),
    label: v.string(),
    lat: v.number(),
    lng: v.number(),
    neighborhood: v.optional(v.string()),
    city: v.optional(v.string()),
    region: v.optional(v.string()),
    timezone: v.optional(v.string()),
    radius_miles: v.optional(v.number()),
    notify: v.optional(v.boolean()),
    is_primary: v.optional(v.boolean()),
  },
  handler: async (ctx, { id, ...args }) => {
    const user = await requireUser(ctx);
    const mine = await ctx.db
      .query("saved_locations")
      .withIndex("by_user", (q) => q.eq("user_id", user._id))
      .collect();
    const existing = id ? mine.find((l) => l._id === id) : undefined;
    if (id && !existing) throw new Error("Not your location");
    const isPrimary = args.is_primary ?? (existing?.is_primary || mine.length === 0);
    const fields = {
      label: args.label.trim().slice(0, 40) || "Saved place",
      lat: args.lat,
      lng: args.lng,
      neighborhood: args.neighborhood,
      city: args.city,
      region: args.region,
      timezone: args.timezone ?? existing?.timezone ?? DEFAULT_TIMEZONE,
      radius_miles: Math.min(Math.max(args.radius_miles ?? existing?.radius_miles ?? 1, 0.25), 5),
      notify: args.notify ?? existing?.notify ?? true,
      is_primary: isPrimary,
      scan_area_key: areaKey(args),
    };
    const locId = existing
      ? (await ctx.db.patch("saved_locations", existing._id, fields), existing._id)
      : await ctx.db.insert("saved_locations", { ...fields, user_id: user._id, created_at: Date.now() });
    if (isPrimary) {
      for (const other of mine) if (other._id !== locId && other.is_primary) await ctx.db.patch("saved_locations", other._id, { is_primary: false });
      if (args.neighborhood && !user.home_neighborhood) await ctx.db.patch("users", user._id, { home_neighborhood: args.neighborhood });
    }
    const loc = (await ctx.db.get("saved_locations", locId))!;
    await syncLocationGeo(ctx, loc);
    await scanIfNew(ctx, loc);
    return locId;
  },
});

/** The Alerts tab slider and on/off, for the primary location. */
export const setAlertRadius = mutation({
  args: { radius_miles: v.number() },
  handler: async (ctx, { radius_miles }) => {
    const user = await requireUser(ctx);
    const loc = (
      await ctx.db
        .query("saved_locations")
        .withIndex("by_user", (q) => q.eq("user_id", user._id))
        .collect()
    ).find((l) => l.is_primary);
    if (loc) await ctx.db.patch("saved_locations", loc._id, { radius_miles: Math.min(Math.max(radius_miles, 0.25), 5) });
  },
});

export const deleteLocation = mutation({
  args: { id: v.id("saved_locations") },
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx);
    const loc = await ctx.db.get("saved_locations", id);
    if (!loc || loc.user_id !== user._id) return;
    await locationGeo.remove(ctx, id);
    await ctx.db.delete("saved_locations", id);
    if (loc.is_primary) {
      const next = await ctx.db
        .query("saved_locations")
        .withIndex("by_user", (q) => q.eq("user_id", user._id))
        .first();
      if (next) await ctx.db.patch("saved_locations", next._id, { is_primary: true });
    }
  },
});

// ---------------------------------------------------------------- interests

export const topics = query({
  args: {},
  handler: async (ctx) => {
    const user = await getUser(ctx);
    if (!user) return null;
    const [storeTypes, dealTypes] = await Promise.all([
      ctx.db.query("category_follows").withIndex("by_user_type", (q) => q.eq("user_id", user._id)).collect(),
      ctx.db.query("deal_type_follows").withIndex("by_user_type", (q) => q.eq("user_id", user._id)).collect(),
    ]);
    return { store_types: storeTypes.map((r) => r.store_type), deal_types: dealTypes.map((r) => r.deal_type) };
  },
});

/** Replace the user's picks ("Pick interests" and its edits). */
export const setTopics = mutation({
  args: { store_types: v.array(v.string()), deal_types: v.array(dealType) },
  handler: async (ctx, { store_types, deal_types }) => {
    const user = await requireUser(ctx);
    const wantTypes = new Set(store_types);
    for (const row of await ctx.db.query("category_follows").withIndex("by_user_type", (q) => q.eq("user_id", user._id)).collect()) {
      if (wantTypes.has(row.store_type)) wantTypes.delete(row.store_type);
      else await ctx.db.delete("category_follows", row._id);
    }
    for (const store_type of wantTypes) await ctx.db.insert("category_follows", { user_id: user._id, store_type });
    const wantDeals = new Set(deal_types);
    for (const row of await ctx.db.query("deal_type_follows").withIndex("by_user_type", (q) => q.eq("user_id", user._id)).collect()) {
      if (wantDeals.has(row.deal_type)) wantDeals.delete(row.deal_type);
      else await ctx.db.delete("deal_type_follows", row._id);
    }
    for (const deal_type of wantDeals) await ctx.db.insert("deal_type_follows", { user_id: user._id, deal_type });
  },
});

export const setInstantAlerts = mutation({
  args: { on: v.boolean() },
  handler: async (ctx, { on }) => {
    const user = await requireUser(ctx);
    await ctx.db.patch("users", user._id, { instant_alerts: on });
  },
});

// ---------------------------------------------------------------- store follows

export const setFollow = mutation({
  args: { storeId: v.id("stores"), on: v.boolean() },
  handler: async (ctx, { storeId, on }) => {
    const user = await requireUser(ctx);
    const existing = await ctx.db
      .query("store_follows")
      .withIndex("by_user_store", (q) => q.eq("user_id", user._id).eq("store_id", storeId))
      .unique();
    if (on && !existing) {
      if (!(await ctx.db.get("stores", storeId))) throw new Error("Unknown store");
      await ctx.db.insert("store_follows", { user_id: user._id, store_id: storeId, created_at: Date.now() });
    } else if (!on && existing) await ctx.db.delete("store_follows", existing._id);
  },
});

export const followedStores = query({
  args: {},
  handler: async (ctx) => {
    const user = await getUser(ctx);
    if (!user) return [];
    const follows = await ctx.db
      .query("store_follows")
      .withIndex("by_user_store", (q) => q.eq("user_id", user._id))
      .collect();
    return Promise.all(
      follows.map(async (f) => {
        const store = (await ctx.db.get("stores", f.store_id))!;
        const deals = await ctx.db
          .query("deals")
          .withIndex("by_store", (q) => q.eq("store_id", f.store_id))
          .collect();
        return {
          id: store._id,
          name: store.name,
          store_type: store.store_type ?? null,
          lat: store.lat ?? null,
          lng: store.lng ?? null,
          address: store.address ?? null,
          active_deals: deals.filter((d) => ACTIVE_STATUSES.includes(d.status)).length,
          followed_at: f.created_at,
        };
      }),
    );
  },
});

// ---------------------------------------------------------------- push devices

export const registerDevice = mutation({
  args: { push_token: v.string(), platform: v.union(v.literal("ios"), v.literal("android"), v.literal("web")) },
  handler: async (ctx, { push_token, platform }) => {
    const user = await requireUser(ctx);
    const existing = await ctx.db
      .query("devices")
      .withIndex("by_push_token", (q) => q.eq("push_token", push_token))
      .unique();
    const now = Date.now();
    if (existing) await ctx.db.patch("devices", existing._id, { user_id: user._id, platform, last_seen_at: now });
    else await ctx.db.insert("devices", { user_id: user._id, platform, push_token, last_seen_at: now });
  },
});

export const unregisterDevice = mutation({
  args: { push_token: v.string() },
  handler: async (ctx, { push_token }) => {
    const user = await requireUser(ctx);
    const existing = await ctx.db
      .query("devices")
      .withIndex("by_push_token", (q) => q.eq("push_token", push_token))
      .unique();
    if (existing && existing.user_id === user._id) await ctx.db.delete("devices", existing._id);
  },
});
