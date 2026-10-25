// "Ranked by $ saved this month": neighbourhood and school boards are rebuilt hourly into leaderboard_snapshots;
// the friends board is computed live. Boards reset on the 1st (the app's "Resets in Nd").
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { getUser } from "./lib/auth";
import { DAY, DEFAULT_TIMEZONE, localToEpoch, monthStart } from "./lib/time";
import { friendIds, publicProfile } from "./social";

function periodStartMs(period: string) {
  return localToEpoch(period, "00:00", DEFAULT_TIMEZONE);
}

async function savedThisMonth(ctx: QueryCtx, userId: Id<"users">, since: number) {
  const rows = await ctx.db
    .query("saved_deals")
    .withIndex("by_user_used", (q) => q.eq("user_id", userId).gte("used_at", since))
    .collect();
  return rows.reduce((t, r) => t + (r.saved_cents ?? 0), 0);
}

export const rebuild = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const period = monthStart(now);
    const since = periodStartMs(period);
    const used = await ctx.db
      .query("saved_deals")
      .withIndex("by_used", (q) => q.gte("used_at", since))
      .take(50_000);
    const totals = new Map<Id<"users">, number>();
    for (const r of used) totals.set(r.user_id, (totals.get(r.user_id) ?? 0) + (r.saved_cents ?? 0));

    const boards = new Map<string, { scope: "neighborhood" | "school"; key: string; rows: { user: Doc<"users">; cents: number }[] }>();
    for (const [userId, cents] of totals) {
      const user = await ctx.db.get("users", userId);
      if (!user || user.deleted_at) continue;
      for (const [scope, key] of [
        ["neighborhood", user.home_neighborhood],
        ["school", user.school],
      ] as const) {
        if (!key) continue;
        const id = `${scope}|${key}`;
        if (!boards.has(id)) boards.set(id, { scope, key, rows: [] });
        boards.get(id)!.rows.push({ user, cents });
      }
    }
    for (const { scope, key, rows } of boards.values()) {
      rows.sort((a, b) => b.cents - a.cents);
      for (const [i, { user, cents }] of rows.entries()) {
        const rank = i + 1;
        const existing = await ctx.db
          .query("leaderboard_snapshots")
          .withIndex("by_board_user", (q) => q.eq("scope", scope).eq("scope_key", key).eq("period_start", period).eq("user_id", user._id))
          .unique();
        if (!existing) {
          await ctx.db.insert("leaderboard_snapshots", {
            scope,
            scope_key: key,
            period_start: period,
            user_id: user._id,
            saved_cents: cents,
            rank,
            week_marked_at: now,
            snapshot_at: now,
          });
          continue;
        }
        // Once a week, remember the rank, so "▲ n this week" compares against it.
        const weekly = now - existing.week_marked_at >= 7 * DAY;
        await ctx.db.patch("leaderboard_snapshots", existing._id, {
          saved_cents: cents,
          rank,
          snapshot_at: now,
          ...(weekly ? { rank_week_ago: existing.rank, week_marked_at: now } : {}),
        });
      }
    }
  },
});

export const board = query({
  args: { scope: v.union(v.literal("friends"), v.literal("neighborhood"), v.literal("school")) },
  handler: async (ctx, { scope }) => {
    const me = await getUser(ctx);
    if (!me) return null;
    const period = monthStart(Date.now());
    if (scope === "friends") {
      const since = periodStartMs(period);
      const ids = [me._id, ...(await friendIds(ctx, me._id))];
      const rows = await Promise.all(
        ids.map(async (id) => ({ user: (await ctx.db.get("users", id))!, cents: await savedThisMonth(ctx, id, since) })),
      );
      rows.sort((a, b) => b.cents - a.cents);
      const ranked = rows.map((r, i) => ({ ...publicProfile(r.user), saved_cents: r.cents, rank: i + 1, change: 0 }));
      const you = ranked.find((r) => r.id === me._id)!;
      const above = ranked[you.rank - 2];
      return {
        label: "Friends",
        period,
        ranked: ranked.slice(0, 50),
        you: {
          ...you,
          percentile: Math.round((100 * you.rank) / ranked.length),
          to_next_cents: above ? Math.max(0, above.saved_cents - you.saved_cents) : 0,
        },
      };
    }
    const key = scope === "neighborhood" ? me.home_neighborhood : me.school;
    if (!key) return { label: null, period, ranked: [], you: null };
    const rows = await ctx.db
      .query("leaderboard_snapshots")
      .withIndex("by_board_rank", (q) => q.eq("scope", scope).eq("scope_key", key).eq("period_start", period))
      .take(50);
    const ranked = await Promise.all(
      rows.map(async (r) => ({
        ...publicProfile((await ctx.db.get("users", r.user_id))!),
        saved_cents: r.saved_cents,
        rank: r.rank,
        change: r.rank_week_ago ? r.rank_week_ago - r.rank : 0,
      })),
    );
    const mine = await ctx.db
      .query("leaderboard_snapshots")
      .withIndex("by_board_user", (q) => q.eq("scope", scope).eq("scope_key", key).eq("period_start", period).eq("user_id", me._id))
      .unique();
    const size = (
      await ctx.db
        .query("leaderboard_snapshots")
        .withIndex("by_board_rank", (q) => q.eq("scope", scope).eq("scope_key", key).eq("period_start", period))
        .collect()
    ).length;
    const above = mine
      ? await ctx.db
          .query("leaderboard_snapshots")
          .withIndex("by_board_rank", (q) =>
            q.eq("scope", scope).eq("scope_key", key).eq("period_start", period).eq("rank", mine.rank - 1),
          )
          .first()
      : null;
    return {
      label: key,
      period,
      ranked,
      you: mine
        ? {
            ...publicProfile(me),
            saved_cents: mine.saved_cents,
            rank: mine.rank,
            change: mine.rank_week_ago ? mine.rank_week_ago - mine.rank : 0,
            percentile: Math.max(1, Math.round((100 * mine.rank) / size)),
            to_next_cents: above ? Math.max(0, above.saved_cents - mine.saved_cents) : 0,
          }
        : null,
    };
  },
});

/** Your friends (and you) with each one's rank on the neighbourhood or school board: the Friends tab list. */
export const friendRanks = query({
  args: { scope: v.union(v.literal("neighborhood"), v.literal("school")) },
  handler: async (ctx, { scope }) => {
    const me = await getUser(ctx);
    if (!me) return [];
    const key = scope === "neighborhood" ? me.home_neighborhood : me.school;
    if (!key) return [];
    const period = monthStart(Date.now());
    const rows = [];
    for (const id of [me._id, ...(await friendIds(ctx, me._id))]) {
      const user = await ctx.db.get("users", id);
      if (!user || user.deleted_at) continue;
      const snap = await ctx.db
        .query("leaderboard_snapshots")
        .withIndex("by_board_user", (q) => q.eq("scope", scope).eq("scope_key", key).eq("period_start", period).eq("user_id", id))
        .unique();
      if (snap) rows.push({ ...publicProfile(user), rank: snap.rank, saved_cents: snap.saved_cents, you: id === me._id });
    }
    return rows.sort((a, b) => a.rank - b.rank);
  },
});
