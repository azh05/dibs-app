// Upvotes/downvotes and "Still running? / Ended" confirmations.
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireUser } from "./lib/auth";
import { CONFIRMATIONS_TO_POST, pendingForDeal, postEntry, reverseEntry } from "./lib/credits";
import { refreshStatus } from "./lib/deals";
import { rateLimiter } from "./lib/rateLimits";
import { localDate } from "./lib/time";

async function applyVote(ctx: MutationCtx, userId: Id<"users">, targetType: "deal" | "store", targetId: string, value: 1 | -1 | 0) {
  const existing = await ctx.db
    .query("votes")
    .withIndex("by_user_target", (q) => q.eq("user_id", userId).eq("target_type", targetType).eq("target_id", targetId))
    .unique();
  let up = 0;
  let down = 0;
  if (existing) {
    if (existing.value === 1) up--;
    else down--;
    await ctx.db.delete("votes", existing._id);
  }
  if (value !== 0) {
    await ctx.db.insert("votes", { user_id: userId, target_type: targetType, target_id: targetId, value, created_at: Date.now() });
    if (value === 1) up++;
    else down++;
  }
  return { up, down };
}

export const vote = mutation({
  args: {
    targetType: v.union(v.literal("store"), v.literal("deal")),
    targetId: v.string(),
    value: v.union(v.literal(1), v.literal(-1), v.literal(0)), // 0 clears the vote
  },
  handler: async (ctx, { targetType, targetId, value }) => {
    const user = await requireUser(ctx);
    await rateLimiter.limit(ctx, "vote", { key: user._id, throws: true });
    if (targetType === "deal") {
      const id = ctx.db.normalizeId("deals", targetId);
      const deal = id && (await ctx.db.get("deals", id));
      if (!deal) throw new Error("Unknown deal");
      const { up, down } = await applyVote(ctx, user._id, "deal", deal._id, value);
      await ctx.db.patch("deals", deal._id, { upvotes: Math.max(0, deal.upvotes + up), downvotes: Math.max(0, deal.downvotes + down) });
    } else {
      const id = ctx.db.normalizeId("stores", targetId);
      const store = id && (await ctx.db.get("stores", id));
      if (!store) throw new Error("Unknown store");
      const { up, down } = await applyVote(ctx, user._id, "store", store._id, value);
      await ctx.db.patch("stores", store._id, { upvotes: Math.max(0, store.upvotes + up), downvotes: Math.max(0, store.downvotes + down) });
    }
  },
});

/** Pending credits on this deal post once 2 users other than the submitter have confirmed it. */
async function maybePostCredits(ctx: MutationCtx, dealId: Id<"deals">) {
  const pending = await pendingForDeal(ctx, dealId);
  if (!pending.length) return;
  const confirmations = await ctx.db
    .query("deal_confirmations")
    .withIndex("by_deal", (q) => q.eq("deal_id", dealId))
    .collect();
  for (const entry of pending) {
    const others = new Set(
      confirmations
        .filter((c) => c.kind !== "ended" && c.user_id && c.user_id !== entry.user_id && c.created_at >= entry.created_at)
        .map((c) => c.user_id),
    );
    if (others.size >= CONFIRMATIONS_TO_POST) await postEntry(ctx, entry);
  }
}

export async function addConfirmation(
  ctx: MutationCtx,
  deal: Doc<"deals">,
  userId: Id<"users"> | undefined,
  kind: Doc<"deal_confirmations">["kind"],
  submissionId?: Id<"photo_submissions">,
): Promise<boolean> {
  const now = Date.now();
  const day = localDate(now, deal.timezone);
  const existing = await ctx.db
    .query("deal_confirmations")
    .withIndex("by_deal_user_day", (q) => q.eq("deal_id", deal._id).eq("user_id", userId).eq("day", day))
    .unique();
  if (existing) {
    if (existing.kind === kind) return false;
    // Changed their mind today: undo the old count.
    await ctx.db.patch("deals", deal._id, existing.kind === "ended" ? { ended_count: Math.max(0, deal.ended_count - 1) } : { confirmation_count: Math.max(0, deal.confirmation_count - 1) });
    await ctx.db.delete("deal_confirmations", existing._id);
    deal = (await ctx.db.get("deals", deal._id))!;
  }
  await ctx.db.insert("deal_confirmations", { deal_id: deal._id, user_id: userId, kind, submission_id: submissionId, day, created_at: now });
  if (kind === "ended") {
    await ctx.db.patch("deals", deal._id, { ended_count: deal.ended_count + 1 });
    for (const entry of await pendingForDeal(ctx, deal._id)) {
      if (entry.user_id !== userId) await reverseEntry(ctx, entry, "deal reported ended");
    }
  } else {
    await ctx.db.patch("deals", deal._id, { confirmation_count: deal.confirmation_count + 1, last_confirmed_at: now });
    await maybePostCredits(ctx, deal._id);
  }
  await refreshStatus(ctx, (await ctx.db.get("deals", deal._id))!);
  return true;
}

export const confirm = mutation({
  args: { dealId: v.id("deals"), kind: v.union(v.literal("still_running"), v.literal("ended")) },
  handler: async (ctx, { dealId, kind }) => {
    const user = await requireUser(ctx);
    const deal = await ctx.db.get("deals", dealId);
    if (!deal) throw new Error("Unknown deal");
    return addConfirmation(ctx, deal, user._id, kind);
  },
});
