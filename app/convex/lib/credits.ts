// Credit ledger rules (the doc's "rule to enforce"): only the first verified submission of a new, live deal earns
// credits; they start pending and post after 24 hours with no "ended" reports, or once 2 other users confirm the
// deal; an "ended" report before then reverses them. users.credit_balance counts posted entries only and changes in
// the same write.
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { checkBadges } from "./gamify";

export const SUBMISSION_CREDITS = 500;
export const REFERRAL_CREDITS = 500;
export const CREDITED_SUBMISSIONS_PER_DAY = 3;
export const CONFIRMATIONS_TO_POST = 2;

export async function postEntry(ctx: MutationCtx, entry: Doc<"credit_ledger">) {
  if (entry.status !== "pending") return;
  await ctx.db.patch("credit_ledger", entry._id, { status: "posted", posted_at: Date.now() });
  if (entry.user_id) {
    const user = await ctx.db.get("users", entry.user_id);
    if (user) await ctx.db.patch("users", user._id, { credit_balance: user.credit_balance + entry.amount });
  }
}

export async function reverseEntry(ctx: MutationCtx, entry: Doc<"credit_ledger">, reason: string) {
  if (entry.status === "reversed") return;
  const wasPosted = entry.status === "posted";
  await ctx.db.patch("credit_ledger", entry._id, { status: "reversed", reversal_reason: reason });
  if (wasPosted && entry.user_id) {
    const user = await ctx.db.get("users", entry.user_id);
    if (user) await ctx.db.patch("users", user._id, { credit_balance: user.credit_balance - entry.amount });
  }
}

export async function pendingForDeal(ctx: MutationCtx, dealId: Id<"deals">) {
  return ctx.db
    .query("credit_ledger")
    .withIndex("by_deal_status", (q) => q.eq("deal_id", dealId).eq("status", "pending"))
    .collect();
}

/** Both users get referral credits once the referred user has verified their email or phone. Posted right away. */
export async function grantReferral(ctx: MutationCtx, referred: Doc<"users">) {
  if (!referred.referred_by || referred.referral_rewarded_at) return;
  const now = Date.now();
  await ctx.db.patch("users", referred._id, { referral_rewarded_at: now });
  for (const userId of [referred._id, referred.referred_by]) {
    const id = await ctx.db.insert("credit_ledger", {
      user_id: userId,
      amount: REFERRAL_CREDITS,
      type: "referral",
      status: "pending",
      created_at: now,
    });
    await postEntry(ctx, (await ctx.db.get("credit_ledger", id))!);
  }
  await checkBadges(ctx, referred.referred_by, "referral");
}
