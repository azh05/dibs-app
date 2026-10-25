// Profile numbers: $ saved, deals used, streak, Deal DNA, badges and invites. All derived; nothing extra stored.
import { query } from "./_generated/server";
import { storeType } from "./catalog";
import { getUser } from "./lib/auth";
import { REFERRAL_CREDITS } from "./lib/credits";
import { BADGES, BADGE_TOTAL } from "./lib/gamify";
import { DEFAULT_TIMEZONE, localToEpoch, monthStart } from "./lib/time";
import { friendIds, publicProfile } from "./social";
import { DAY } from "./lib/time";

const WEEKS_SHOWN = 7;

/** "You're a certified boba fan. 15 boba deals this month." */
function dnaSummary(top: { label: string; count: number } | undefined): string {
  if (!top) return "Use a deal to start your Deal DNA.";
  return `Your top pick is ${top.label.toLowerCase()}: ${top.count} ${top.count === 1 ? "deal" : "deals"} this month.`;
}

export const stats = query({
  args: {},
  handler: async (ctx) => {
    const user = await getUser(ctx);
    if (!user) return null;
    const used = await ctx.db
      .query("saved_deals")
      .withIndex("by_user_used", (q) => q.eq("user_id", user._id).gt("used_at", 0))
      .collect();
    const since = localToEpoch(monthStart(Date.now()), "00:00", DEFAULT_TIMEZONE);
    const byType = new Map<string, number>();
    for (const row of used) {
      if (row.used_at! < since) continue;
      const deal = await ctx.db.get("deals", row.deal_id);
      const label = storeType(deal?.store_type)?.label ?? "Other";
      byType.set(label, (byType.get(label) ?? 0) + 1);
    }
    const monthTotal = [...byType.values()].reduce((a, b) => a + b, 0);
    const sorted = [...byType.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
    const top = sorted.filter((s) => s.label !== "Other").slice(0, 4);
    const otherCount = monthTotal - top.reduce((t, s) => t + s.count, 0);
    const slices = [...top, ...(otherCount ? [{ label: "Other", count: otherCount }] : [])].map((s) => ({
      label: s.label,
      percent: Math.round((100 * s.count) / monthTotal),
    }));

    const earned = await ctx.db
      .query("user_badges")
      .withIndex("by_user_badge", (q) => q.eq("user_id", user._id))
      .collect();
    const earnedIds = new Set(earned.map((b) => b.badge_id));
    const referred = await ctx.db
      .query("users")
      .withIndex("by_referred_by", (q) => q.eq("referred_by", user._id))
      .take(500);
    const joined = referred.filter((u) => u.referral_rewarded_at).length;

    // $ saved per week for the last 7 weeks, oldest first (the Profile bar chart); the last bar is this week.
    const now = Date.now();
    const weekly_saved_cents = Array.from({ length: WEEKS_SHOWN }, () => 0);
    for (const row of used) {
      const weeksAgo = Math.floor((now - row.used_at!) / (7 * DAY));
      if (weeksAgo < WEEKS_SHOWN) weekly_saved_cents[WEEKS_SHOWN - 1 - weeksAgo]! += row.saved_cents ?? 0;
    }
    const friendList = await friendIds(ctx, user._id);
    const friendRows = (await Promise.all(friendList.slice(0, 7).map((id) => ctx.db.get("users", id)))).filter(
      (u): u is NonNullable<typeof u> => Boolean(u && !u.deleted_at),
    );

    return {
      saved_cents: used.reduce((t, r) => t + (r.saved_cents ?? 0), 0),
      weekly_saved_cents,
      joined_at: user.created_at,
      deals_used: used.length,
      week_streak: user.streak_weeks,
      friends: friendList.length,
      friend_faces: friendRows.map(publicProfile),
      xp: user.xp,
      credit_balance: user.credit_balance,
      badges: BADGES.map((b) => ({ id: b.id, name: b.name, icon: b.icon, description: b.description, earned: earnedIds.has(b.id), featured: b.id === user.featured_badge_id })),
      badges_earned: earnedIds.size,
      badge_total: BADGE_TOTAL,
      deal_dna: { slices, summary: dnaSummary(top[0]) },
      invites: { code: user.referral_code, joined, earned: joined * REFERRAL_CREDITS, reward: REFERRAL_CREDITS },
    };
  },
});
