// Saved deals and events, "Used it", and lists ("Want to try", "Cheap eats").
import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { getUser, requireUser } from "./lib/auth";
import { awardXp, bumpChallenges, checkBadges, XP } from "./lib/gamify";
import { dealView, hiddenFor } from "./lib/views";
import { cancelReminder, setReminder } from "./reminders";

export const toggleSave = mutation({
  args: { dealId: v.id("deals") },
  handler: async (ctx, { dealId }): Promise<boolean> => {
    const user = await requireUser(ctx);
    const deal = await ctx.db.get("deals", dealId);
    if (!deal) throw new Error("Unknown deal");
    const existing = await ctx.db
      .query("saved_deals")
      .withIndex("by_user_deal", (q) => q.eq("user_id", user._id).eq("deal_id", dealId))
      .unique();
    const auto = await ctx.db
      .query("reminders")
      .withIndex("by_user_deal_reason", (q) => q.eq("user_id", user._id).eq("deal_id", dealId).eq("reason", "ending_soon"))
      .unique();
    if (existing) {
      if (existing.used_at) return true; // used deals stay in the history
      await ctx.db.delete("saved_deals", existing._id);
      if (auto) await cancelReminder(ctx, auto);
      return false;
    }
    await ctx.db.insert("saved_deals", { user_id: user._id, deal_id: dealId, created_at: Date.now() });
    // Saved deals that end get an "ending soon" reminder ("We'll remind you" on Saved).
    if (deal.kind === "deal" && deal.ends_at && deal.ends_at > Date.now()) await setReminder(ctx, user._id, deal, "ending_soon");
    if (deal.kind === "event" || deal.status === "upcoming")
      await ctx.db.insert("activity", { user_id: user._id, type: "saved_event", deal_id: dealId, created_at: Date.now() });
    await checkBadges(ctx, user._id, "save");
    return true;
  },
});

/** "Used it": records what it saved (defaults to Claude's estimate), earns XP, counts toward challenges. */
export const markUsed = mutation({
  args: { dealId: v.id("deals"), saved_cents: v.optional(v.number()) },
  handler: async (ctx, { dealId, saved_cents }) => {
    const user = await requireUser(ctx);
    const deal = await ctx.db.get("deals", dealId);
    if (!deal) throw new Error("Unknown deal");
    const cents = Math.max(0, Math.round(saved_cents ?? deal.est_savings_cents ?? 0));
    const existing = await ctx.db
      .query("saved_deals")
      .withIndex("by_user_deal", (q) => q.eq("user_id", user._id).eq("deal_id", dealId))
      .unique();
    if (existing?.used_at) {
      if (saved_cents !== undefined) await ctx.db.patch("saved_deals", existing._id, { saved_cents: cents });
      return;
    }
    const now = Date.now();
    if (existing) await ctx.db.patch("saved_deals", existing._id, { used_at: now, saved_cents: cents });
    else await ctx.db.insert("saved_deals", { user_id: user._id, deal_id: dealId, created_at: now, used_at: now, saved_cents: cents });
    await awardXp(ctx, user._id, XP.deal_used, "deal_used", dealId);
    await ctx.db.insert("activity", { user_id: user._id, type: "used_deal", deal_id: dealId, created_at: now });
    await bumpChallenges(ctx, user._id, "deals_used", deal.store_type);
    await checkBadges(ctx, user._id, "deal_used");
  },
});

/** The Saved tab: every saved deal and event, newest first, with when it was used. */
export const saved = query({
  args: {},
  handler: async (ctx) => {
    const user = await getUser(ctx);
    if (!user) return [];
    const rows = await ctx.db
      .query("saved_deals")
      .withIndex("by_user_deal", (q) => q.eq("user_id", user._id))
      .collect();
    const out = [];
    for (const row of rows.sort((a, b) => b.created_at - a.created_at)) {
      const deal = await ctx.db.get("deals", row.deal_id);
      if (!deal || hiddenFor(deal, user)) continue;
      out.push({ ...(await dealView(ctx, deal, user)), saved_at: row.created_at, used_at: row.used_at ?? null, saved_cents: row.saved_cents ?? null });
    }
    return out;
  },
});

// ---------------------------------------------------------------- lists

async function ownList(ctx: Parameters<typeof requireUser>[0], listId: Doc<"lists">["_id"]) {
  const user = await requireUser(ctx);
  const list = await ctx.db.get("lists", listId);
  if (!list || list.user_id !== user._id) throw new Error("Not your list");
  return list;
}

export const lists = query({
  args: {},
  handler: async (ctx) => {
    const user = await getUser(ctx);
    if (!user) return [];
    const rows = await ctx.db
      .query("lists")
      .withIndex("by_user", (q) => q.eq("user_id", user._id))
      .collect();
    return Promise.all(
      rows.map(async (l) => ({
        id: l._id,
        name: l.name,
        icon: l.icon ?? null,
        spots: (await ctx.db.query("list_items").withIndex("by_list", (q) => q.eq("list_id", l._id)).collect()).length,
      })),
    );
  },
});

export const createList = mutation({
  args: { name: v.string(), icon: v.optional(v.string()) },
  handler: async (ctx, { name, icon }) => {
    const user = await requireUser(ctx);
    const clean = name.trim().slice(0, 40);
    if (!clean) throw new Error("Lists need a name");
    return ctx.db.insert("lists", { user_id: user._id, name: clean, icon, created_at: Date.now() });
  },
});

export const deleteList = mutation({
  args: { listId: v.id("lists") },
  handler: async (ctx, { listId }) => {
    await ownList(ctx, listId);
    for (const item of await ctx.db.query("list_items").withIndex("by_list", (q) => q.eq("list_id", listId)).collect())
      await ctx.db.delete("list_items", item._id);
    await ctx.db.delete("lists", listId);
  },
});

export const addToList = mutation({
  args: { listId: v.id("lists"), dealId: v.optional(v.id("deals")), storeId: v.optional(v.id("stores")) },
  handler: async (ctx, { listId, dealId, storeId }) => {
    await ownList(ctx, listId);
    if (!dealId === !storeId) throw new Error("Add a deal or a store");
    const items = await ctx.db.query("list_items").withIndex("by_list", (q) => q.eq("list_id", listId)).collect();
    if (items.some((i) => (dealId && i.deal_id === dealId) || (storeId && i.store_id === storeId))) return;
    await ctx.db.insert("list_items", { list_id: listId, deal_id: dealId, store_id: storeId, added_at: Date.now() });
  },
});

export const removeFromList = mutation({
  args: { itemId: v.id("list_items") },
  handler: async (ctx, { itemId }) => {
    const item = await ctx.db.get("list_items", itemId);
    if (!item) return;
    await ownList(ctx, item.list_id);
    await ctx.db.delete("list_items", itemId);
  },
});

export const listItems = query({
  args: { listId: v.id("lists") },
  handler: async (ctx, { listId }) => {
    const user = await getUser(ctx);
    const list = await ctx.db.get("lists", listId);
    if (!user || !list || list.user_id !== user._id) return null;
    const items = await ctx.db.query("list_items").withIndex("by_list", (q) => q.eq("list_id", listId)).collect();
    return {
      name: list.name,
      items: await Promise.all(
        items.map(async (i) => {
          const deal = i.deal_id ? await ctx.db.get("deals", i.deal_id) : null;
          const store = i.store_id ? await ctx.db.get("stores", i.store_id) : null;
          return {
            id: i._id,
            deal: deal && !hiddenFor(deal, user) ? await dealView(ctx, deal, user) : null,
            store: store ? { id: store._id, name: store.name, store_type: store.store_type ?? null } : null,
          };
        }),
      ),
    };
  },
});
