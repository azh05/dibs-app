// Friends, the friends feed and cheers. Accepted friendships are stored in both directions so each user's list is
// one index lookup.
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { getUser, requireUser } from "./lib/auth";
import { checkBadges, BADGES } from "./lib/gamify";
import { rateLimiter } from "./lib/rateLimits";
import { initials } from "./lib/text";

export function publicProfile(u: Doc<"users">) {
  const name = u.display_name ?? u.username ?? "dibs user";
  return { id: u._id, name, username: u.username ?? null, initials: initials(name), avatar_url: u.avatar_url ?? null };
}

export const findByUsername = query({
  args: { prefix: v.string() },
  handler: async (ctx, { prefix }) => {
    const me = await getUser(ctx);
    const p = prefix.toLowerCase().replace(/^@/, "").trim();
    if (!me || p.length < 2) return [];
    const rows = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.gte("username", p).lt("username", p + "￿"))
      .take(20);
    return rows.filter((u) => u._id !== me._id && !u.deleted_at).map(publicProfile);
  },
});

async function pair(ctx: QueryCtx, a: Id<"users">, b: Id<"users">) {
  return ctx.db
    .query("friendships")
    .withIndex("by_user_friend", (q) => q.eq("user_id", a).eq("friend_id", b))
    .unique();
}

export const request = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const me = await requireUser(ctx);
    if (userId === me._id) throw new Error("That's you");
    await rateLimiter.limit(ctx, "friendRequest", { key: me._id, throws: true });
    const other = await ctx.db.get("users", userId);
    if (!other || other.deleted_at) throw new Error("Unknown user");
    const mine = await pair(ctx, me._id, userId);
    const theirs = await pair(ctx, userId, me._id);
    // They already asked me: asking back accepts.
    if (theirs?.status === "pending" && theirs.requested_by === userId) {
      await ctx.db.patch("friendships", theirs._id, { status: "accepted" });
      if (mine) await ctx.db.patch("friendships", mine._id, { status: "accepted" });
      await checkBadges(ctx, me._id, "friend");
      await checkBadges(ctx, userId, "friend");
      return "accepted";
    }
    if (mine) return mine.status;
    const now = Date.now();
    await ctx.db.insert("friendships", { user_id: me._id, friend_id: userId, status: "pending", requested_by: me._id, created_at: now });
    await ctx.db.insert("friendships", { user_id: userId, friend_id: me._id, status: "pending", requested_by: me._id, created_at: now });
    return "pending";
  },
});

export const respond = mutation({
  args: { userId: v.id("users"), accept: v.boolean() },
  handler: async (ctx, { userId, accept }) => {
    const me = await requireUser(ctx);
    const mine = await pair(ctx, me._id, userId);
    const theirs = await pair(ctx, userId, me._id);
    if (!mine || !theirs) return;
    if (accept && mine.status === "pending" && mine.requested_by === userId) {
      await ctx.db.patch("friendships", mine._id, { status: "accepted" });
      await ctx.db.patch("friendships", theirs._id, { status: "accepted" });
      await checkBadges(ctx, me._id, "friend");
      await checkBadges(ctx, userId, "friend");
    } else if (!accept) {
      // Decline a request, cancel mine, or unfriend.
      await ctx.db.delete("friendships", mine._id);
      await ctx.db.delete("friendships", theirs._id);
    }
  },
});

export async function friendIds(ctx: QueryCtx, userId: Id<"users">) {
  return (
    await ctx.db
      .query("friendships")
      .withIndex("by_user_status", (q) => q.eq("user_id", userId).eq("status", "accepted"))
      .collect()
  ).map((f) => f.friend_id);
}

export const friends = query({
  args: {},
  handler: async (ctx) => {
    const me = await getUser(ctx);
    if (!me) return { friends: [], incoming: [], outgoing: [] };
    const rows = await ctx.db
      .query("friendships")
      .withIndex("by_user_friend", (q) => q.eq("user_id", me._id))
      .collect();
    const withUser = await Promise.all(
      rows.map(async (f) => ({ f, user: await ctx.db.get("users", f.friend_id) })),
    );
    const live = withUser.filter((x) => x.user && !x.user.deleted_at);
    return {
      friends: live.filter((x) => x.f.status === "accepted").map((x) => publicProfile(x.user!)),
      incoming: live.filter((x) => x.f.status === "pending" && x.f.requested_by !== me._id).map((x) => publicProfile(x.user!)),
      outgoing: live.filter((x) => x.f.status === "pending" && x.f.requested_by === me._id).map((x) => publicProfile(x.user!)),
    };
  },
});

/** What friends did lately: used a deal, saved an event, earned a badge. */
export const feed = query({
  args: {},
  handler: async (ctx) => {
    const me = await getUser(ctx);
    if (!me) return [];
    const items: (Doc<"activity"> & { who: Doc<"users"> })[] = [];
    for (const id of await friendIds(ctx, me._id)) {
      const who = await ctx.db.get("users", id);
      if (!who || who.deleted_at) continue;
      const rows = await ctx.db
        .query("activity")
        .withIndex("by_user_created", (q) => q.eq("user_id", id))
        .order("desc")
        .take(10);
      items.push(...rows.map((r) => ({ ...r, who })));
    }
    items.sort((a, b) => b.created_at - a.created_at);
    return Promise.all(
      items.slice(0, 30).map(async (a) => {
        const deal = a.deal_id ? await ctx.db.get("deals", a.deal_id) : null;
        const store = deal ? await ctx.db.get("stores", deal.store_id) : null;
        const cheered = await ctx.db
          .query("activity_reactions")
          .withIndex("by_activity_user_kind", (q) => q.eq("activity_id", a._id).eq("user_id", me._id).eq("kind", "cheer"))
          .unique();
        const badge = a.badge_id ? BADGES.find((b) => b.id === a.badge_id) : undefined;
        return {
          id: a._id,
          friend: publicProfile(a.who),
          type: a.type,
          verb: a.type === "used_deal" ? "used" : a.type === "saved_event" ? "saved" : "unlocked",
          subject: badge?.name ?? deal?.title ?? deal?.offer ?? "",
          place: store?.name ?? null,
          deal_id: a.deal_id ?? null,
          created_at: a.created_at,
          cheered: Boolean(cheered),
        };
      }),
    );
  },
});

export const react = mutation({
  args: { activityId: v.id("activity"), kind: v.union(v.literal("cheer"), v.literal("save")) },
  handler: async (ctx, { activityId, kind }) => {
    const me = await requireUser(ctx);
    const existing = await ctx.db
      .query("activity_reactions")
      .withIndex("by_activity_user_kind", (q) => q.eq("activity_id", activityId).eq("user_id", me._id).eq("kind", kind))
      .unique();
    if (existing) await ctx.db.delete("activity_reactions", existing._id);
    else await ctx.db.insert("activity_reactions", { activity_id: activityId, user_id: me._id, kind });
    return !existing;
  },
});
