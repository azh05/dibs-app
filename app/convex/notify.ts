// Deal alerts, reminders and the Alerts inbox. Pushes go straight to Expo's push service (one request per 100
// messages) for every device a user has; Expo delivers to APNs and FCM.
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { isAdultStoreType } from "./catalog";
import { getUser, requireUser } from "./lib/auth";
import { haversineMeters, locationGeo, METERS_PER_MILE } from "./lib/geo";
import { isActive } from "./lib/status";
import { dayAndTime } from "./lib/time";

/** The app registers this category with Get Directions / Save / Remind Me buttons. */
export const DEAL_ALERT_CATEGORY = "deal-alert";
const MAX_ALERT_RADIUS_MILES = 5;
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

type Push = { to: string; title: string; body: string; data: Record<string, string>; categoryId?: string };

const SOURCE_NAMES: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
  website: "website",
  google: "Google",
  photo: "the dibs community",
};

/** Figma "6 · Notifications": the store, then the deal over "Ends Oct 24, 6 PM". Without an end, the second
 * line says where it was found (and how far away, added by the caller). */
async function alertText(ctx: MutationCtx, deal: Doc<"deals">, store: Doc<"stores">) {
  const source = await ctx.db.get("sources", deal.primary_source_id);
  const offer = deal.title ?? deal.offer;
  return {
    title: store.name,
    body: offer,
    when: deal.ends_at !== undefined ? `Ends ${dayAndTime(deal.ends_at, deal.timezone)}` : null,
    via: `via ${SOURCE_NAMES[source?.kind ?? "website"]}`,
  };
}

function eligible(user: Doc<"users"> | null, deal: Doc<"deals">): user is Doc<"users"> {
  if (!user || user.deleted_at) return false;
  if ((deal.age_21 || isAdultStoreType(deal.store_type)) && !user.age_21_verified_at) return false;
  if (deal.student_only && !user.edu_verified_at) return false;
  return true;
}

async function devicesOf(ctx: MutationCtx, userId: Id<"users">) {
  return ctx.db
    .query("devices")
    .withIndex("by_user", (q) => q.eq("user_id", userId))
    .collect();
}

/** Who hears about a new deal: everyone following the store, plus users with a saved location in range (alerts on)
 * who follow its store type or one of its deal types. One notification per user and deal. */
export const planFanout = internalMutation({
  args: { dealId: v.id("deals") },
  handler: async (ctx, { dealId }): Promise<Push[]> => {
    const deal = await ctx.db.get("deals", dealId);
    if (!deal || !isActive(deal.status)) return [];
    const store = (await ctx.db.get("stores", deal.store_id))!;
    const { title, body: offer, when, via } = await alertText(ctx, deal, store);
    const recipients = new Map<Id<"users">, { reason: Doc<"notifications">["reason"]; locationId?: Id<"saved_locations"> }>();

    for (const f of await ctx.db.query("store_follows").withIndex("by_store", (q) => q.eq("store_id", store._id)).collect()) {
      recipients.set(f.user_id, { reason: "followed_store" });
    }

    if (store.lat !== undefined && store.lng !== undefined) {
      const nearby = await locationGeo.nearest(ctx, {
        point: { latitude: store.lat, longitude: store.lng },
        maxDistance: MAX_ALERT_RADIUS_MILES * METERS_PER_MILE,
        limit: 1000,
      });
      for (const hit of nearby) {
        const loc = await ctx.db.get("saved_locations", hit.key);
        if (!loc || !loc.notify || recipients.has(loc.user_id)) continue;
        if (hit.distance > loc.radius_miles * METERS_PER_MILE) continue;
        const followsType =
          deal.store_type &&
          (await ctx.db
            .query("category_follows")
            .withIndex("by_user_type", (q) => q.eq("user_id", loc.user_id).eq("store_type", deal.store_type!))
            .unique());
        let followsDealType = false;
        for (const t of deal.kind === "event" ? [...deal.deal_types, "event" as const] : deal.deal_types) {
          if (
            await ctx.db
              .query("deal_type_follows")
              .withIndex("by_user_type", (q) => q.eq("user_id", loc.user_id).eq("deal_type", t))
              .unique()
          ) {
            followsDealType = true;
            break;
          }
        }
        if (followsType || followsDealType) recipients.set(loc.user_id, { reason: "saved_location", locationId: loc._id });
      }
    }

    const pushes: Push[] = [];
    const now = Date.now();
    for (const [userId, { reason, locationId }] of recipients) {
      const user = await ctx.db.get("users", userId);
      if (!eligible(user, deal)) continue;
      const already = await ctx.db
        .query("notifications")
        .withIndex("by_user_deal_reason", (q) => q.eq("user_id", userId).eq("deal_id", dealId).eq("reason", reason))
        .unique();
      if (already) continue;
      let distance = "";
      if (locationId && store.lat !== undefined) {
        const loc = (await ctx.db.get("saved_locations", locationId))!;
        distance = ` · ${(haversineMeters(loc, { lat: store.lat, lng: store.lng! }) / METERS_PER_MILE).toFixed(1)} mi`;
      }
      await ctx.db.insert("notifications", {
        user_id: userId,
        deal_id: dealId,
        reason,
        saved_location_id: locationId,
        channel: "push",
        title,
        body: `${offer}\n${when ?? via + distance}`,
        sent_at: now,
      });
      for (const device of await devicesOf(ctx, userId)) {
        pushes.push({
          to: device.push_token,
          title,
          body: `${offer}\n${when ?? via + distance}`,
          data: { dealId },
          categoryId: DEAL_ALERT_CATEGORY,
        });
      }
    }
    return pushes;
  },
});

export async function sendPushes(pushes: Push[]): Promise<string[]> {
  const dead: string[] = [];
  for (let i = 0; i < pushes.length; i += 100) {
    const batch = pushes.slice(i, i + 100);
    const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
    if (process.env.EXPO_ACCESS_TOKEN) headers.authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
    try {
      const resp = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(batch.map((p) => ({ ...p, sound: "default" }))),
      });
      const json = (await resp.json()) as { data?: { status: string; details?: { error?: string } }[] };
      json.data?.forEach((ticket, j) => {
        const to = batch[j]?.to;
        if (to && ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered") dead.push(to);
      });
    } catch (err) {
      console.warn(`push batch failed: ${String(err)}`);
    }
  }
  return dead;
}

export const removeTokens = internalMutation({
  args: { tokens: v.array(v.string()) },
  handler: async (ctx, { tokens }) => {
    for (const token of tokens) {
      const device = await ctx.db
        .query("devices")
        .withIndex("by_push_token", (q) => q.eq("push_token", token))
        .unique();
      if (device) await ctx.db.delete("devices", device._id);
    }
  },
});

export const fanout = internalAction({
  args: { dealId: v.id("deals") },
  handler: async (ctx, { dealId }) => {
    const pushes = await ctx.runMutation(internal.notify.planFanout, { dealId });
    const dead = await sendPushes(pushes);
    if (dead.length) await ctx.runMutation(internal.notify.removeTokens, { tokens: dead });
  },
});

// ---------------------------------------------------------------- reminders (scheduled by reminders.ts)

export const planReminder = internalMutation({
  args: { reminderId: v.id("reminders") },
  handler: async (ctx, { reminderId }): Promise<Push[]> => {
    const reminder = await ctx.db.get("reminders", reminderId);
    if (!reminder || reminder.sent_at || reminder.canceled_at) return [];
    const deal = await ctx.db.get("deals", reminder.deal_id);
    if (!deal || deal.status === "expired" || deal.status === "hidden") {
      await ctx.db.patch("reminders", reminderId, { canceled_at: Date.now() });
      return [];
    }
    const store = (await ctx.db.get("stores", deal.store_id))!;
    const name = deal.title ?? deal.offer;
    const { title, body } =
      reminder.reason === "event_start"
        ? { title: `${name} starts in an hour`, body: store.name }
        : { title: `Reminder · ${store.name}`, body: `${name}. Don't miss it.` };
    const now = Date.now();
    await ctx.db.patch("reminders", reminderId, { sent_at: now });
    const reason = reminder.reason === "event_start" ? "event_reminder" : reminder.reason === "ending_soon" ? "ending_soon" : "reminder";
    const already = await ctx.db
      .query("notifications")
      .withIndex("by_user_deal_reason", (q) => q.eq("user_id", reminder.user_id).eq("deal_id", deal._id).eq("reason", reason))
      .unique();
    if (!already)
      await ctx.db.insert("notifications", {
        user_id: reminder.user_id,
        deal_id: deal._id,
        reason,
        channel: "push",
        title,
        body,
        sent_at: now,
      });
    return (await devicesOf(ctx, reminder.user_id)).map((d) => ({ to: d.push_token, title, body, data: { dealId: deal._id } }));
  },
});

export const sendReminder = internalAction({
  args: { reminderId: v.id("reminders") },
  handler: async (ctx, { reminderId }) => {
    const pushes = await ctx.runMutation(internal.notify.planReminder, { reminderId });
    const dead = await sendPushes(pushes);
    if (dead.length) await ctx.runMutation(internal.notify.removeTokens, { tokens: dead });
  },
});

// ---------------------------------------------------------------- the Alerts inbox

export const inbox = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const user = await getUser(ctx);
    if (!user) return [];
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_user_sent", (q) => q.eq("user_id", user._id))
      .order("desc")
      .take(Math.min(limit ?? 50, 200));
    return Promise.all(
      rows.map(async (n) => {
        const deal = await ctx.db.get("deals", n.deal_id);
        return {
          id: n._id,
          deal_id: n.deal_id,
          title: deal?.title ?? n.title,
          // Pushes put the end time on a second line; the inbox row has one.
          subtitle: n.body.replace("\n", " · "),
          store_type: deal?.store_type ?? null,
          reason: n.reason,
          sent_at: n.sent_at,
          unread: n.opened_at === undefined,
        };
      }),
    );
  },
});

export const markOpened = mutation({
  args: { id: v.id("notifications") },
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx);
    const n = await ctx.db.get("notifications", id);
    if (n && n.user_id === user._id && !n.opened_at) await ctx.db.patch("notifications", id, { opened_at: Date.now() });
  },
});
