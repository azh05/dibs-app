// Earn credits: a user's photo of an in-store deal. Upload → submit → the API reads it (5 to 20 s) → finalize.
// The app subscribes to the submission, so the result screen updates as soon as it's done.
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { addConfirmation } from "./community";
import { getUser, requireAdmin, requireUser } from "./lib/auth";
import { type ApiDeal, type ApiSearchResponse, dibsApi } from "./lib/api";
import { CREDITED_SUBMISSIONS_PER_DAY, SUBMISSION_CREDITS } from "./lib/credits";
import { awardXp, bumpChallenges, checkBadges, XP } from "./lib/gamify";
import { rateLimiter } from "./lib/rateLimits";
import { isActive } from "./lib/status";
import { normalizeUrl } from "./lib/text";
import { DAY, DEFAULT_TIMEZONE, localDate } from "./lib/time";
import { ingestResponse } from "./scans";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return ctx.storage.generateUploadUrl();
  },
});

export const submit = mutation({
  args: {
    storageId: v.id("_storage"),
    photo_date: v.optional(v.string()), // YYYY-MM-DD from EXIF; default today
    timezone: v.optional(v.string()),
    shop_hint: v.optional(v.string()),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Id<"photo_submissions">> => {
    const user = await requireUser(ctx);
    const meta = await ctx.db.system.get("_storage", args.storageId);
    if (!meta) throw new Error("Upload not found");
    if (meta.size > MAX_IMAGE_BYTES) {
      await ctx.storage.delete(args.storageId);
      throw new Error("Photos must be under 5 MB");
    }
    const duplicate = await ctx.db
      .query("photo_submissions")
      .withIndex("by_sha256", (q) => q.eq("image_sha256", meta.sha256))
      .first();
    if (duplicate) {
      await ctx.storage.delete(args.storageId);
      throw new Error("This photo was already submitted");
    }
    await rateLimiter.limit(ctx, "photoSubmit", { key: user._id, throws: true });
    const timezone = args.timezone ?? DEFAULT_TIMEZONE;
    const id = await ctx.db.insert("photo_submissions", {
      user_id: user._id,
      image_id: args.storageId,
      image_sha256: meta.sha256,
      photo_date: args.photo_date ?? localDate(Date.now(), timezone),
      timezone,
      shop_hint: args.shop_hint?.trim() || undefined,
      lat: args.lat,
      lng: args.lng,
      state: "processing",
      created_deal: false,
      created_at: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.photos.processPhoto, { submissionId: id });
    return id;
  },
});

export const forProcessing = internalQuery({
  args: { submissionId: v.id("photo_submissions") },
  handler: async (ctx, { submissionId }) => {
    const sub = await ctx.db.get("photo_submissions", submissionId);
    if (!sub) return null;
    const primary = sub.user_id
      ? (
          await ctx.db
            .query("saved_locations")
            .withIndex("by_user", (q) => q.eq("user_id", sub.user_id!))
            .collect()
        ).find((l) => l.is_primary)
      : undefined;
    return { sub, scanAreaKey: primary?.scan_area_key };
  },
});

export const processPhoto = internalAction({
  args: { submissionId: v.id("photo_submissions") },
  handler: async (ctx, { submissionId }) => {
    const info = await ctx.runQuery(internal.photos.forProcessing, { submissionId });
    if (!info || info.sub.state !== "processing") return;
    const { sub, scanAreaKey } = info;
    try {
      const blob = await ctx.storage.get(sub.image_id);
      if (!blob) throw new Error("photo missing from storage");
      const form = new FormData();
      form.append("image", blob, "photo.jpg");
      form.append("photo_date", sub.photo_date);
      form.append("timezone", sub.timezone);
      if (sub.shop_hint) form.append("shop", sub.shop_hint);
      const resp = await dibsApi<ApiSearchResponse>("/extract/photo", { method: "POST", body: form });
      const runId = await ctx.runMutation(internal.ingest.startRun, {
        provider: "user_photo",
        trigger: "photo",
        queries: [],
        requested_by: sub.user_id,
      });
      // Alerts for a photo's deal go out in finalize, once it's confirmed.
      const { dealIds, created } = await ingestResponse(ctx, runId, resp, { scanAreaKey, timezone: sub.timezone, notify: false });
      const deal = resp.deals[0];
      await ctx.runMutation(internal.photos.finalize, {
        submissionId,
        transcript: resp.transcript ?? "",
        photoUrl: resp.sources[0]?.url,
        extracted: deal ?? null,
        dealId: deal?.id ? dealIds[deal.id] : undefined,
        createdDeal: Boolean(deal?.id && created.includes(dealIds[deal.id]!)),
        rejectReason: resp.rejected[0]?.reason,
      });
    } catch (err) {
      await ctx.runMutation(internal.photos.fail, { submissionId, error: String(err) });
    }
  },
});

export const fail = internalMutation({
  args: { submissionId: v.id("photo_submissions"), error: v.string() },
  handler: async (ctx, { submissionId, error }) => {
    await ctx.db.patch("photo_submissions", submissionId, { state: "failed", error: error.slice(0, 500) });
  },
});

/** The same test as the app's isEligible: live and not low confidence. */
function verdict(deal: ApiDeal | null): Doc<"photo_submissions">["result"] {
  if (!deal) return "no_deal";
  if (deal.status === "expired") return "expired";
  if (deal.status === "live" && !deal.flags.includes("low_confidence")) return "confirmed";
  return "needs_check";
}

/** Credits for a confirmed submission that created a new, live deal (3 a day at most), plus XP and alerts. */
async function reward(ctx: MutationCtx, sub: Doc<"photo_submissions">, deal: Doc<"deals">) {
  if (!sub.user_id) return;
  if (sub.created_deal && isActive(deal.status)) {
    const since = Date.now() - DAY;
    const today = await ctx.db
      .query("credit_ledger")
      .withIndex("by_user_created", (q) => q.eq("user_id", sub.user_id).gt("created_at", since))
      .collect();
    const credited = today.filter((e) => e.type === "submission" && e.status !== "reversed").length;
    if (credited < CREDITED_SUBMISSIONS_PER_DAY) {
      const entryId = await ctx.db.insert("credit_ledger", {
        user_id: sub.user_id,
        submission_id: sub._id,
        deal_id: deal._id,
        amount: SUBMISSION_CREDITS,
        type: "submission",
        status: "pending",
        created_at: Date.now(),
      });
      await ctx.scheduler.runAfter(DAY, internal.credits.settle, { entryId });
    }
    await ctx.scheduler.runAfter(0, internal.notify.fanout, { dealId: deal._id });
  } else {
    // Already known: the photo confirms it ("Confirmed by 3 dibs users").
    await addConfirmation(ctx, deal, sub.user_id, "photo", sub._id);
  }
  await awardXp(ctx, sub.user_id, XP.submission, "submission", sub._id);
  await bumpChallenges(ctx, sub.user_id, "submissions", deal.store_type);
  await checkBadges(ctx, sub.user_id, "submission");
}

export const finalize = internalMutation({
  args: {
    submissionId: v.id("photo_submissions"),
    transcript: v.string(),
    photoUrl: v.optional(v.string()),
    extracted: v.any(),
    dealId: v.optional(v.id("deals")),
    createdDeal: v.boolean(),
    rejectReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const sub = await ctx.db.get("photo_submissions", args.submissionId);
    if (!sub) return;
    const source = args.photoUrl
      ? await ctx.db
          .query("sources")
          .withIndex("by_url", (q) => q.eq("url", normalizeUrl(args.photoUrl!)))
          .unique()
      : null;
    const deal = args.dealId ? await ctx.db.get("deals", args.dealId) : null;
    let result = verdict(args.extracted as ApiDeal | null);
    if (result === "no_deal" && args.rejectReason) result = "rejected";
    await ctx.db.patch("photo_submissions", sub._id, {
      state: "done",
      transcript: args.transcript,
      source_id: source?._id,
      deal_id: deal?._id,
      store_id: deal?.store_id,
      created_deal: args.createdDeal,
      extracted: args.extracted ?? undefined,
      result,
      reject_reason: args.rejectReason,
    });
    if (result === "confirmed" && deal) await reward(ctx, (await ctx.db.get("photo_submissions", sub._id))!, deal);
  },
});

/** Admin review of "In review" (needs_check) submissions: approve as confirmed, or reject. */
export const review = mutation({
  args: { submissionId: v.id("photo_submissions"), approve: v.boolean(), reason: v.optional(v.string()) },
  handler: async (ctx, { submissionId, approve, reason }) => {
    await requireAdmin(ctx);
    const sub = await ctx.db.get("photo_submissions", submissionId);
    if (!sub || sub.result !== "needs_check") throw new Error("Only in-review submissions can be reviewed");
    if (!approve) {
      await ctx.db.patch("photo_submissions", submissionId, { result: "rejected", reject_reason: reason ?? "rejected in review" });
      return;
    }
    await ctx.db.patch("photo_submissions", submissionId, { result: "confirmed" });
    const deal = sub.deal_id ? await ctx.db.get("deals", sub.deal_id) : null;
    if (deal) await reward(ctx, (await ctx.db.get("photo_submissions", submissionId))!, deal);
  },
});

async function submissionView(ctx: Parameters<typeof getUser>[0], sub: Doc<"photo_submissions">) {
  const [deal, credit, imageUrl] = await Promise.all([
    sub.deal_id ? ctx.db.get("deals", sub.deal_id) : null,
    ctx.db
      .query("credit_ledger")
      .withIndex("by_submission", (q) => q.eq("submission_id", sub._id))
      .first(),
    ctx.storage.getUrl(sub.image_id),
  ]);
  const store = deal ? await ctx.db.get("stores", deal.store_id) : null;
  return {
    id: sub._id,
    state: sub.state,
    result: sub.result ?? null,
    error: sub.error ?? null,
    reject_reason: sub.reject_reason ?? null,
    transcript: sub.transcript ?? null,
    extracted: (sub.extracted as ApiDeal | undefined) ?? null,
    deal_id: sub.deal_id ?? null,
    store: store?.name ?? (sub.extracted as ApiDeal | undefined)?.shop_name ?? sub.shop_hint ?? null,
    store_type: store?.store_type ?? null,
    offer: deal?.title ?? deal?.offer ?? (sub.extracted as ApiDeal | undefined)?.offer ?? null,
    credit: credit ? { amount: credit.amount, status: credit.status } : null,
    image_url: imageUrl,
    created_at: sub.created_at,
  };
}

export const get = query({
  args: { id: v.id("photo_submissions") },
  handler: async (ctx, { id }) => {
    const user = await getUser(ctx);
    const sub = await ctx.db.get("photo_submissions", id);
    if (!user || !sub || sub.user_id !== user._id) return null;
    return submissionView(ctx, sub);
  },
});

/** "Your submissions" on the Earn tab. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const user = await getUser(ctx);
    if (!user) return [];
    const subs = await ctx.db
      .query("photo_submissions")
      .withIndex("by_user_created", (q) => q.eq("user_id", user._id))
      .order("desc")
      .take(50);
    return Promise.all(subs.map((s) => submissionView(ctx, s)));
  },
});
