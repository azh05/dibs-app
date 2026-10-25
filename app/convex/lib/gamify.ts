// XP, streaks, badges and weekly challenges. Everything here runs inside the mutation that earned it, so users.xp,
// users.level and the ledgers always change in the same write.
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { storeType } from "../catalog";
import { levelFor } from "./levels";
import { DAY, localDate, localMinutes, weekStart } from "./time";

export type XpReason = Doc<"xp_ledger">["reason"];

export const XP = {
  deal_used: 50,
  submission: 100,
  line_check: 10,
} as const;

/** Line checks earn XP at most this many times a day. */
export const LINE_CHECK_DAILY_CAP = 5;

export async function awardXp(
  ctx: MutationCtx,
  userId: Id<"users">,
  amount: number,
  reason: XpReason,
  refId?: string,
): Promise<Id<"xp_ledger">> {
  const now = Date.now();
  const user = (await ctx.db.get("users", userId))!;
  const ledgerId = await ctx.db.insert("xp_ledger", { user_id: userId, amount, reason, ref_id: refId, created_at: now });
  const xp = Math.max(0, user.xp + amount);
  const patch: Partial<Doc<"users">> = { xp, level: levelFor(xp), last_active_at: now };
  if (amount > 0) {
    // Streak: weeks in a row with at least one XP-earning action.
    const week = weekStart(now);
    if (user.last_active_week !== week) {
      const lastWeek = weekStart(now - 7 * DAY);
      patch.streak_weeks = user.last_active_week === lastWeek ? user.streak_weeks + 1 : 1;
      patch.last_active_week = week;
    }
  }
  await ctx.db.patch("users", userId, patch);
  if (patch.streak_weeks !== undefined) await checkBadges(ctx, userId, "streak");
  return ledgerId;
}

/** Undo an XP entry (e.g. an undone line report): a negative reversal entry, never a delete. */
export async function reverseXp(ctx: MutationCtx, ledgerId: Id<"xp_ledger">) {
  const entry = await ctx.db.get("xp_ledger", ledgerId);
  if (!entry || entry.amount <= 0) return;
  await awardXp(ctx, entry.user_id, -entry.amount, "reversal", ledgerId);
}

// ---------------------------------------------------------------- weekly challenges

export type ChallengeMetric = Doc<"challenges">["metric"];

export async function bumpChallenges(
  ctx: MutationCtx,
  userId: Id<"users">,
  metric: ChallengeMetric,
  dealStoreType?: string,
) {
  const week = weekStart(Date.now());
  const challenges = await ctx.db
    .query("challenges")
    .withIndex("by_week", (q) => q.eq("week_start", week))
    .collect();
  for (const c of challenges) {
    if (c.metric !== metric || (c.store_type && c.store_type !== dealStoreType)) continue;
    const progress = await ctx.db
      .query("challenge_progress")
      .withIndex("by_user_challenge", (q) => q.eq("user_id", userId).eq("challenge_id", c._id))
      .unique();
    if (progress?.completed_at) continue;
    const count = (progress?.progress ?? 0) + 1;
    const completed = count >= c.target ? Date.now() : undefined;
    if (progress) await ctx.db.patch("challenge_progress", progress._id, { progress: count, completed_at: completed });
    else
      await ctx.db.insert("challenge_progress", {
        user_id: userId,
        challenge_id: c._id,
        progress: count,
        completed_at: completed,
      });
    if (completed) await awardXp(ctx, userId, c.xp_reward, "challenge", c._id);
  }
}

// ---------------------------------------------------------------- badges

type Trigger = "deal_used" | "line_check" | "submission" | "streak" | "friend" | "referral" | "save";

type Stats = {
  user: Doc<"users">;
  used: { deal: Doc<"deals"> | null; used_at: number; saved_cents: number }[];
};

export type BadgeDef = {
  id: string;
  name: string;
  icon: string; // app icon name
  description: string;
  trigger: Trigger;
  earned: (ctx: MutationCtx, s: Stats) => Promise<boolean> | boolean;
};

const usedCount = (n: number) => (_: MutationCtx, s: Stats) => s.used.length >= n;

const usedInTypes = (keys: string[] | ((key: string) => boolean), n: number) => (_: MutationCtx, s: Stats) =>
  s.used.filter((u) => {
    const key = u.deal?.store_type;
    if (!key) return false;
    return Array.isArray(keys) ? keys.includes(key) : keys(key);
  }).length >= n;

const inSection = (section: string) => (key: string) => storeType(key)?.section === section;

const ledgerCount = (reason: XpReason, n: number) => async (ctx: MutationCtx, s: Stats) => {
  const rows = await ctx.db
    .query("xp_ledger")
    .withIndex("by_user_reason_time", (q) => q.eq("user_id", s.user._id).eq("reason", reason))
    .take(n);
  return rows.length >= n;
};

const usedAtLocalTime = (test: (minutes: number) => boolean) => (_: MutationCtx, s: Stats) =>
  s.used.some((u) => test(localMinutes(u.used_at, u.deal?.timezone)));

/** 24 badges. The app shows "N of 24". */
export const BADGES: BadgeDef[] = [
  { id: "first_dibs", name: "First Dibs", icon: "tag", description: "Use your first deal", trigger: "deal_used", earned: usedCount(1) },
  { id: "regular", name: "Regular", icon: "store", description: "Use 10 deals", trigger: "deal_used", earned: usedCount(10) },
  { id: "deal_hunter", name: "Deal Hunter", icon: "zap", description: "Use 50 deals", trigger: "deal_used", earned: usedCount(50) },
  { id: "century_club", name: "Century Club", icon: "verified", description: "Use 100 deals", trigger: "deal_used", earned: usedCount(100) },
  { id: "boba_boss", name: "Boba Boss", icon: "boba", description: "Use 5 boba deals", trigger: "deal_used", earned: usedInTypes(["boba_tea"], 5) },
  { id: "caffeine_fiend", name: "Caffeine Fiend", icon: "coffee", description: "Use 5 cafe deals", trigger: "deal_used", earned: usedInTypes(["cafes"], 5) },
  { id: "glow_getter", name: "Glow Getter", icon: "nails", description: "Use 3 beauty deals", trigger: "deal_used", earned: usedInTypes(inSection("Beauty & self-care"), 3) },
  { id: "gym_rat", name: "Gym Rat", icon: "dumbbell", description: "Use 3 fitness deals", trigger: "deal_used", earned: usedInTypes(inSection("Fitness"), 3) },
  { id: "foodie", name: "Foodie", icon: "food", description: "Use 10 restaurant deals", trigger: "deal_used", earned: usedInTypes(["restaurants", "fast_food", "food_trucks"], 10) },
  { id: "sweet_tooth", name: "Sweet Tooth", icon: "icecream", description: "Use 5 dessert deals", trigger: "deal_used", earned: usedInTypes(["desserts_bakeries"], 5) },
  { id: "thrifter", name: "Thrifter", icon: "shirt", description: "Use 3 shopping deals", trigger: "deal_used", earned: usedInTypes(inSection("Shopping"), 3) },
  { id: "early_bird", name: "Early Bird", icon: "zap", description: "Use a deal before 10 AM", trigger: "deal_used", earned: usedAtLocalTime((m) => m < 10 * 60) },
  { id: "night_owl", name: "Night Owl", icon: "moon", description: "Use a deal after 10 PM", trigger: "deal_used", earned: usedAtLocalTime((m) => m >= 22 * 60) },
  { id: "big_saver", name: "Big Saver", icon: "gift", description: "Save $100 with dibs", trigger: "deal_used", earned: (_, s) => s.used.reduce((t, u) => t + u.saved_cents, 0) >= 10_000 },
  { id: "line_spotter", name: "Line Spotter", icon: "clock", description: "Report your first line", trigger: "line_check", earned: ledgerCount("line_check", 1) },
  { id: "line_legend", name: "Line Legend", icon: "clock", description: "Report 25 lines", trigger: "line_check", earned: ledgerCount("line_check", 25) },
  { id: "scout", name: "Scout", icon: "camera", description: "Get a photo verified", trigger: "submission", earned: ledgerCount("submission", 1) },
  { id: "paparazzi", name: "Paparazzi", icon: "camera", description: "Get 10 photos verified", trigger: "submission", earned: ledgerCount("submission", 10) },
  { id: "on_a_roll", name: "On a Roll", icon: "flame", description: "4-week streak", trigger: "streak", earned: (_, s) => s.user.streak_weeks >= 4 },
  { id: "unstoppable", name: "Unstoppable", icon: "flame", description: "12-week streak", trigger: "streak", earned: (_, s) => s.user.streak_weeks >= 12 },
  {
    id: "social_butterfly",
    name: "Social Butterfly",
    icon: "users",
    description: "Add 5 friends",
    trigger: "friend",
    earned: async (ctx, s) =>
      (
        await ctx.db
          .query("friendships")
          .withIndex("by_user_status", (q) => q.eq("user_id", s.user._id).eq("status", "accepted"))
          .take(5)
      ).length >= 5,
  },
  {
    id: "recruiter",
    name: "Recruiter",
    icon: "gift",
    description: "Invite a friend who joins",
    trigger: "referral",
    earned: async (ctx, s) =>
      (await ctx.db.query("users").withIndex("by_referred_by", (q) => q.eq("referred_by", s.user._id)).take(50)).some(
        (u) => u.referral_rewarded_at,
      ),
  },
  {
    id: "collector",
    name: "Collector",
    icon: "bookmark",
    description: "Save 25 deals",
    trigger: "save",
    earned: async (ctx, s) =>
      (await ctx.db.query("saved_deals").withIndex("by_user_deal", (q) => q.eq("user_id", s.user._id)).take(25)).length >= 25,
  },
  {
    id: "scene_kid",
    name: "Scene Kid",
    icon: "calendar",
    description: "Save 3 events",
    trigger: "save",
    earned: async (ctx, s) =>
      (
        await ctx.db
          .query("activity")
          .withIndex("by_user_created", (q) => q.eq("user_id", s.user._id))
          .filter((q) => q.eq(q.field("type"), "saved_event"))
          .take(3)
      ).length >= 3,
  },
];

export const BADGE_TOTAL = BADGES.length;

/** Award any badges the trigger may have unlocked. Each new badge also goes to the friends feed. */
export async function checkBadges(ctx: MutationCtx, userId: Id<"users">, trigger: Trigger) {
  const candidates = BADGES.filter((b) => b.trigger === trigger);
  if (!candidates.length) return;
  const owned = new Set(
    (await ctx.db.query("user_badges").withIndex("by_user_badge", (q) => q.eq("user_id", userId)).collect()).map(
      (b) => b.badge_id,
    ),
  );
  const todo = candidates.filter((b) => !owned.has(b.id));
  if (!todo.length) return;
  const user = (await ctx.db.get("users", userId))!;
  const used =
    trigger === "deal_used"
      ? await Promise.all(
          (
            await ctx.db
              .query("saved_deals")
              .withIndex("by_user_used", (q) => q.eq("user_id", userId).gt("used_at", 0))
              .take(500)
          ).map(async (s) => ({ deal: await ctx.db.get("deals", s.deal_id), used_at: s.used_at!, saved_cents: s.saved_cents ?? 0 })),
        )
      : [];
  const stats: Stats = { user, used };
  const now = Date.now();
  for (const badge of todo) {
    if (!(await badge.earned(ctx, stats))) continue;
    await ctx.db.insert("user_badges", { user_id: userId, badge_id: badge.id, earned_at: now });
    await ctx.db.insert("activity", { user_id: userId, type: "earned_badge", badge_id: badge.id, created_at: now });
    if (!user.featured_badge_id) await ctx.db.patch("users", userId, { featured_badge_id: badge.id });
  }
}

export function todayLocal(timezone?: string) {
  return localDate(Date.now(), timezone);
}
