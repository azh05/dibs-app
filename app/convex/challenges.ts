// One weekly challenge, rotated from a fixed list by a weekly cron.
import { query, internalMutation } from "./_generated/server";
import { getUser } from "./lib/auth";
import { weekStart } from "./lib/time";

const TEMPLATES = [
  { title: "Use 3 boba deals", metric: "deals_used", store_type: "boba_tea", target: 3, xp_reward: 150 },
  { title: "Report 5 lines", metric: "line_checks", target: 5, xp_reward: 100 },
  { title: "Use 2 deals anywhere", metric: "deals_used", target: 2, xp_reward: 100 },
  { title: "Get a photo verified", metric: "submissions", target: 1, xp_reward: 200 },
  { title: "Use 2 cafe deals", metric: "deals_used", store_type: "cafes", target: 2, xp_reward: 120 },
] as const;

export const rollover = internalMutation({
  args: {},
  handler: async (ctx) => {
    const week = weekStart(Date.now());
    const existing = await ctx.db
      .query("challenges")
      .withIndex("by_week", (q) => q.eq("week_start", week))
      .first();
    if (existing) return existing._id;
    const index = Math.floor(Date.parse(`${week}T00:00:00Z`) / (7 * 86_400_000)) % TEMPLATES.length;
    const t = TEMPLATES[index]!;
    return ctx.db.insert("challenges", { week_start: week, ...t });
  },
});

export const current = query({
  args: {},
  handler: async (ctx) => {
    const user = await getUser(ctx);
    const week = weekStart(Date.now());
    const challenges = await ctx.db
      .query("challenges")
      .withIndex("by_week", (q) => q.eq("week_start", week))
      .collect();
    return Promise.all(
      challenges.map(async (c) => {
        const progress = user
          ? await ctx.db
              .query("challenge_progress")
              .withIndex("by_user_challenge", (q) => q.eq("user_id", user._id).eq("challenge_id", c._id))
              .unique()
          : null;
        return { id: c._id, title: c.title, reward: c.xp_reward, goal: c.target, done: Math.min(progress?.progress ?? 0, c.target), completed: Boolean(progress?.completed_at) };
      }),
    );
  },
});
