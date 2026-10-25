// "Remind me" on deals and events. Each reminder is a scheduled function; turning it off cancels it.
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { getUser, requireUser } from "./lib/auth";
import { HOUR, MINUTE } from "./lib/time";
import { reminderReason } from "./schema";

/** Event: an hour before it starts. Deal: half an hour before it ends, else an hour from now (as the app did). */
export function remindAt(deal: Doc<"deals">, reason: Doc<"reminders">["reason"], now = Date.now()): number {
  if (reason === "event_start" && deal.starts_at && deal.starts_at - HOUR > now) return deal.starts_at - HOUR;
  if (deal.ends_at && deal.ends_at - 30 * MINUTE > now) return deal.ends_at - 30 * MINUTE;
  return now + HOUR;
}

export async function setReminder(
  ctx: MutationCtx,
  userId: Id<"users">,
  deal: Doc<"deals">,
  reason: Doc<"reminders">["reason"],
): Promise<Id<"reminders">> {
  const existing = await ctx.db
    .query("reminders")
    .withIndex("by_user_deal_reason", (q) => q.eq("user_id", userId).eq("deal_id", deal._id).eq("reason", reason))
    .unique();
  const at = remindAt(deal, reason);
  if (existing && !existing.sent_at && !existing.canceled_at) return existing._id;
  const id = existing
    ? (await ctx.db.patch("reminders", existing._id, { remind_at: at, sent_at: undefined, canceled_at: undefined }), existing._id)
    : await ctx.db.insert("reminders", { user_id: userId, deal_id: deal._id, remind_at: at, reason });
  const job = await ctx.scheduler.runAt(at, internal.notify.sendReminder, { reminderId: id });
  await ctx.db.patch("reminders", id, { job_id: job });
  return id;
}

export async function cancelReminder(ctx: MutationCtx, reminder: Doc<"reminders">) {
  if (reminder.sent_at || reminder.canceled_at) return;
  if (reminder.job_id) await ctx.scheduler.cancel(reminder.job_id);
  await ctx.db.patch("reminders", reminder._id, { canceled_at: Date.now() });
}

export const set = mutation({
  args: { dealId: v.id("deals"), reason: v.optional(reminderReason) },
  handler: async (ctx, { dealId, reason }) => {
    const user = await requireUser(ctx);
    const deal = await ctx.db.get("deals", dealId);
    if (!deal) throw new Error("Unknown deal");
    return setReminder(ctx, user._id, deal, reason ?? (deal.kind === "event" ? "event_start" : "user_chosen"));
  },
});

export const cancel = mutation({
  args: { dealId: v.id("deals") },
  handler: async (ctx, { dealId }) => {
    const user = await requireUser(ctx);
    const rows = await ctx.db
      .query("reminders")
      .withIndex("by_user_deal_reason", (q) => q.eq("user_id", user._id).eq("deal_id", dealId))
      .collect();
    for (const r of rows) await cancelReminder(ctx, r);
  },
});

/** Deal ids with a pending reminder ("Reminder on"). */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const user = await getUser(ctx);
    if (!user) return [];
    const rows = await ctx.db
      .query("reminders")
      .withIndex("by_user", (q) => q.eq("user_id", user._id))
      .collect();
    return rows.filter((r) => !r.sent_at && !r.canceled_at).map((r) => ({ deal_id: r.deal_id, remind_at: r.remind_at, reason: r.reason }));
  },
});
