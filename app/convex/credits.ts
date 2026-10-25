// Credit settlement and history. The rules live in lib/credits.ts.
import { v } from "convex/values";

import { internalMutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { getUser } from "./lib/auth";
import { postEntry, reverseEntry } from "./lib/credits";
import { DAY } from "./lib/time";

async function endedSince(ctx: MutationCtx, entry: Doc<"credit_ledger">) {
  if (!entry.deal_id) return false;
  const ended = await ctx.db
    .query("deal_confirmations")
    .withIndex("by_deal", (q) => q.eq("deal_id", entry.deal_id!))
    .filter((q) => q.and(q.eq(q.field("kind"), "ended"), q.gte(q.field("created_at"), entry.created_at)))
    .first();
  return Boolean(ended);
}

/** 24 hours after a credited submission: post it, unless someone reported the deal ended. */
export const settle = internalMutation({
  args: { entryId: v.id("credit_ledger") },
  handler: async (ctx, { entryId }) => {
    const entry = await ctx.db.get("credit_ledger", entryId);
    if (!entry || entry.status !== "pending") return;
    if (await endedSince(ctx, entry)) await reverseEntry(ctx, entry, "deal reported ended");
    else await postEntry(ctx, entry);
  },
});

/** Daily safety net for settle jobs that didn't run. */
export const settleDue = internalMutation({
  args: {},
  handler: async (ctx) => {
    const due = await ctx.db
      .query("credit_ledger")
      .withIndex("by_status_created", (q) => q.eq("status", "pending").lt("created_at", Date.now() - DAY))
      .take(500);
    for (const entry of due) {
      if (await endedSince(ctx, entry)) await reverseEntry(ctx, entry, "deal reported ended");
      else await postEntry(ctx, entry);
    }
  },
});

/** Balance (posted only), pending total and the ledger, newest first. */
export const history = query({
  args: {},
  handler: async (ctx) => {
    const user = await getUser(ctx);
    if (!user) return null;
    const entries = await ctx.db
      .query("credit_ledger")
      .withIndex("by_user_created", (q) => q.eq("user_id", user._id))
      .order("desc")
      .take(200);
    return {
      balance: user.credit_balance,
      pending: entries.filter((e) => e.status === "pending").reduce((t, e) => t + e.amount, 0),
      entries: entries.map((e) => ({
        id: e._id,
        amount: e.amount,
        type: e.type,
        status: e.status,
        reversal_reason: e.reversal_reason ?? null,
        created_at: e.created_at,
        posted_at: e.posted_at ?? null,
        submission_id: e.submission_id ?? null,
      })),
    };
  },
});
