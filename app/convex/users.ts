import { v } from "convex/values";

import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getUser, requireUser } from "./lib/auth";
import { grantReferral } from "./lib/credits";
import { locationGeo } from "./lib/geo";
import { DAY } from "./lib/time";

const USERNAME = /^[a-z0-9_.]{3,20}$/;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

async function newReferralCode(ctx: MutationCtx): Promise<string> {
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    const code = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
    const taken = await ctx.db
      .query("users")
      .withIndex("by_referral_code", (q) => q.eq("referral_code", code))
      .unique();
    if (!taken) return code;
  }
}

function newUser(clerkId: string, tokenIdentifier: string, now: number, code: string): Omit<Doc<"users">, "_id" | "_creationTime"> {
  return {
    clerk_user_id: clerkId,
    token_identifier: tokenIdentifier,
    role: "user",
    is_student: false,
    credit_balance: 0,
    instant_alerts: true,
    referral_code: code,
    xp: 0,
    level: 1,
    streak_weeks: 0,
    reporter_score: 1,
    created_at: now,
    last_active_at: now,
  };
}

/** Called by the app right after sign-in (useStoreUserEffect): creates the users row from the Clerk token. */
export const store = mutation({
  args: {},
  handler: async (ctx): Promise<Id<"users">> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");
    const now = Date.now();
    const existing =
      (await ctx.db
        .query("users")
        .withIndex("by_token", (q) => q.eq("token_identifier", identity.tokenIdentifier))
        .unique()) ??
      // The Clerk webhook may have created the row first.
      (await ctx.db
        .query("users")
        .withIndex("by_clerk_id", (q) => q.eq("clerk_user_id", identity.subject))
        .unique());
    const fromToken = {
      email: identity.email ?? undefined,
      display_name: identity.name ?? undefined,
      avatar_url: identity.pictureUrl ?? undefined,
    };
    if (existing) {
      if (existing.deleted_at) throw new Error("This account was deleted");
      await ctx.db.patch("users", existing._id, {
        token_identifier: identity.tokenIdentifier,
        last_active_at: now,
        email: existing.email ?? fromToken.email,
        display_name: existing.display_name ?? fromToken.display_name,
        avatar_url: existing.avatar_url ?? fromToken.avatar_url,
      });
      return existing._id;
    }
    return ctx.db.insert("users", {
      ...newUser(identity.subject, identity.tokenIdentifier, now, await newReferralCode(ctx)),
      ...fromToken,
      username: typeof identity.nickname === "string" && USERNAME.test(identity.nickname) ? identity.nickname : undefined,
    });
  },
});

export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await getUser(ctx);
    if (!user) return null;
    return {
      _id: user._id,
      username: user.username ?? null,
      display_name: user.display_name ?? null,
      email: user.email ?? null,
      avatar_url: user.avatar_url ?? null,
      birthday: user.birthday ?? null,
      adult_unlocked: Boolean(user.age_21_verified_at),
      edu_email: user.edu_email ?? null,
      edu_verified: Boolean(user.edu_verified_at),
      school: user.school ?? null,
      home_neighborhood: user.home_neighborhood ?? null,
      credit_balance: user.credit_balance,
      instant_alerts: user.instant_alerts,
      referral_code: user.referral_code,
      xp: user.xp,
      level: user.level,
      streak_weeks: user.streak_weeks,
      featured_badge_id: user.featured_badge_id ?? null,
      role: user.role,
    };
  },
});

export const usernameAvailable = query({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    const name = username.toLowerCase();
    if (!USERNAME.test(name)) return false;
    const taken = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", name))
      .unique();
    const me = await getUser(ctx);
    return !taken || taken._id === me?._id;
  },
});

/** Create account: username, name, birthday, neighbourhood and an optional invite code. */
export const updateProfile = mutation({
  args: {
    username: v.optional(v.string()),
    display_name: v.optional(v.string()),
    birthday: v.optional(v.union(v.string(), v.null())),
    home_neighborhood: v.optional(v.string()),
    referral_code: v.optional(v.string()),
    featured_badge_id: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const patch: Partial<Doc<"users">> = {};
    if (args.username !== undefined) {
      const name = args.username.toLowerCase();
      if (!USERNAME.test(name)) throw new Error("Usernames are 3 to 20 letters, numbers, _ or .");
      const taken = await ctx.db
        .query("users")
        .withIndex("by_username", (q) => q.eq("username", name))
        .unique();
      if (taken && taken._id !== user._id) throw new Error("That username is taken");
      patch.username = name;
    }
    if (args.display_name !== undefined) patch.display_name = args.display_name.trim().slice(0, 60);
    if (args.birthday !== undefined) {
      if (args.birthday !== null && !/^\d{4}-\d{2}-\d{2}$/.test(args.birthday)) throw new Error("Birthday must be YYYY-MM-DD");
      patch.birthday = args.birthday ?? undefined;
    }
    if (args.home_neighborhood !== undefined) patch.home_neighborhood = args.home_neighborhood.trim() || undefined;
    if (args.featured_badge_id !== undefined) {
      const owned = await ctx.db
        .query("user_badges")
        .withIndex("by_user_badge", (q) => q.eq("user_id", user._id).eq("badge_id", args.featured_badge_id!))
        .unique();
      if (!owned) throw new Error("You haven't earned that badge");
      patch.featured_badge_id = args.featured_badge_id;
    }
    if (args.referral_code && !user.referred_by && Date.now() - user.created_at < 7 * DAY) {
      const referrer = await ctx.db
        .query("users")
        .withIndex("by_referral_code", (q) => q.eq("referral_code", args.referral_code!.trim().toUpperCase()))
        .unique();
      if (referrer && referrer._id !== user._id) patch.referred_by = referrer._id;
    }
    await ctx.db.patch("users", user._id, patch);
  },
});

export function ageOn(birthday: string, now = new Date()): number {
  const [y, m, d] = birthday.split("-").map(Number);
  let age = now.getUTCFullYear() - y!;
  if (now.getUTCMonth() + 1 < m! || (now.getUTCMonth() + 1 === m! && now.getUTCDate() < d!)) age -= 1;
  return age;
}

/** The 21+ gate: self-attested birthday, checked here so the feed can trust age_21_verified_at. */
export const unlockAdult = mutation({
  args: {},
  handler: async (ctx): Promise<"unlocked" | "too-young" | "no-birthday"> => {
    const user = await requireUser(ctx);
    if (user.age_21_verified_at) return "unlocked";
    if (!user.birthday) return "no-birthday";
    if (ageOn(user.birthday) < 21) return "too-young";
    await ctx.db.patch("users", user._id, { age_21_verified_at: Date.now() });
    return "unlocked";
  },
});

// ---------------------------------------------------------------- Clerk webhook (convex/http.ts)

type ClerkEmail = { id: string; email_address: string; verification?: { status?: string } | null };
type ClerkPhone = { id: string; phone_number: string; verification?: { status?: string } | null };

const clerkUser = v.object({
  id: v.string(),
  username: v.optional(v.union(v.string(), v.null())),
  first_name: v.optional(v.union(v.string(), v.null())),
  last_name: v.optional(v.union(v.string(), v.null())),
  image_url: v.optional(v.union(v.string(), v.null())),
  primary_email_address_id: v.optional(v.union(v.string(), v.null())),
  primary_phone_number_id: v.optional(v.union(v.string(), v.null())),
  email_addresses: v.optional(v.array(v.any())),
  phone_numbers: v.optional(v.array(v.any())),
  public_metadata: v.optional(v.any()),
  updated_at: v.optional(v.number()),
});

/** "g.ucla.edu" → "ucla.edu". */
export function schoolDomain(email: string): string | null {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain || !domain.endsWith(".edu")) return null;
  return domain.split(".").slice(-2).join(".");
}

export const upsertFromClerk = internalMutation({
  args: { data: clerkUser, issuer: v.string() },
  handler: async (ctx, { data, issuer }) => {
    const now = Date.now();
    let user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerk_user_id", data.id))
      .unique();
    if (user?.deleted_at) return;
    if (user && data.updated_at && user.clerk_updated_at && data.updated_at < user.clerk_updated_at) return; // out of order

    const emails = (data.email_addresses ?? []) as ClerkEmail[];
    const phones = (data.phone_numbers ?? []) as ClerkPhone[];
    const verified = (x: { verification?: { status?: string } | null }) => x.verification?.status === "verified";
    const primaryEmail = emails.find((e) => e.id === data.primary_email_address_id);
    const primaryPhone = phones.find((p) => p.id === data.primary_phone_number_id);
    const edu = emails.find((e) => verified(e) && schoolDomain(e.email_address));
    const role = data.public_metadata?.role === "admin" ? "admin" : "user";
    const name = [data.first_name, data.last_name].filter(Boolean).join(" ") || undefined;
    const username = data.username && USERNAME.test(data.username) ? data.username : undefined;

    const patch: Partial<Doc<"users">> = {
      email: primaryEmail?.email_address,
      phone: primaryPhone?.phone_number,
      role,
      clerk_updated_at: data.updated_at,
      ...(username ? { username } : {}),
      ...(name ? { display_name: name } : {}),
      ...(data.image_url ? { avatar_url: data.image_url } : {}),
    };
    if (edu && !user?.edu_verified_at) {
      patch.edu_email = edu.email_address;
      patch.edu_verified_at = now;
      patch.school = schoolDomain(edu.email_address)!;
      patch.is_student = true;
    }

    if (!user) {
      const id = await ctx.db.insert("users", {
        ...newUser(data.id, `${issuer}|${data.id}`, now, await newReferralCode(ctx)),
        ...patch,
      });
      user = (await ctx.db.get("users", id))!;
    } else {
      await ctx.db.patch("users", user._id, patch);
      user = (await ctx.db.get("users", user._id))!;
    }
    if ((primaryEmail && verified(primaryEmail)) || (primaryPhone && verified(primaryPhone))) await grantReferral(ctx, user);
  },
});

/** Clerk user.deleted: delete saved locations, follows, devices and notifications (plus reminders, which would
 * otherwise still fire); keep photo submissions and the credit ledger with the user link removed. */
export const deleteFromClerk = internalMutation({
  args: { clerkUserId: v.string() },
  handler: async (ctx, { clerkUserId }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerk_user_id", clerkUserId))
      .unique();
    if (!user || user.deleted_at) return;
    const uid = user._id;

    for (const loc of await ctx.db.query("saved_locations").withIndex("by_user", (q) => q.eq("user_id", uid)).collect()) {
      await locationGeo.remove(ctx, loc._id);
      await ctx.db.delete("saved_locations", loc._id);
    }
    for (const row of await ctx.db.query("category_follows").withIndex("by_user_type", (q) => q.eq("user_id", uid)).collect())
      await ctx.db.delete("category_follows", row._id);
    for (const row of await ctx.db.query("deal_type_follows").withIndex("by_user_type", (q) => q.eq("user_id", uid)).collect())
      await ctx.db.delete("deal_type_follows", row._id);
    for (const row of await ctx.db.query("store_follows").withIndex("by_user_store", (q) => q.eq("user_id", uid)).collect())
      await ctx.db.delete("store_follows", row._id);
    for (const row of await ctx.db.query("devices").withIndex("by_user", (q) => q.eq("user_id", uid)).collect())
      await ctx.db.delete("devices", row._id);
    for (const row of await ctx.db.query("notifications").withIndex("by_user_sent", (q) => q.eq("user_id", uid)).collect())
      await ctx.db.delete("notifications", row._id);
    for (const row of await ctx.db.query("reminders").withIndex("by_user", (q) => q.eq("user_id", uid)).collect()) {
      if (row.job_id && !row.sent_at && !row.canceled_at) await ctx.scheduler.cancel(row.job_id);
      await ctx.db.delete("reminders", row._id);
    }
    for (const row of await ctx.db.query("photo_submissions").withIndex("by_user_created", (q) => q.eq("user_id", uid)).collect())
      await ctx.db.patch("photo_submissions", row._id, { user_id: undefined });
    for (const row of await ctx.db.query("credit_ledger").withIndex("by_user_created", (q) => q.eq("user_id", uid)).collect())
      await ctx.db.patch("credit_ledger", row._id, { user_id: undefined });

    await ctx.db.patch("users", uid, {
      deleted_at: Date.now(),
      email: undefined,
      phone: undefined,
      username: undefined,
      display_name: undefined,
      avatar_url: undefined,
      birthday: undefined,
      edu_email: undefined,
      instant_alerts: false,
    });
  },
});

export const recordWebhook = internalMutation({
  args: { svixId: v.string() },
  handler: async (ctx, { svixId }): Promise<boolean> => {
    const seen = await ctx.db
      .query("webhook_events")
      .withIndex("by_svix_id", (q) => q.eq("svix_id", svixId))
      .unique();
    if (seen) return false;
    await ctx.db.insert("webhook_events", { svix_id: svixId, received_at: Date.now() });
    return true;
  },
});
