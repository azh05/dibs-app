import { Webhook } from "svix";
import { beforeEach, expect, test } from "vitest";

import { api } from "./_generated/api";
import { identity, makeTest, type T } from "./test.setup";

const SECRET = "whsec_" + btoa("0123456789abcdef0123456789abcdef");

beforeEach(() => {
  process.env.CLERK_WEBHOOK_SECRET = SECRET;
  process.env.CLERK_JWT_ISSUER_DOMAIN = "https://clerk.test";
});

let n = 0;
async function deliver(t: T, type: string, data: Record<string, unknown>, svixId = `msg_${++n}`) {
  const body = JSON.stringify({ type, data });
  const timestamp = new Date();
  const signature = new Webhook(SECRET).sign(svixId, timestamp, body);
  return t.fetch("/clerk-users-webhook", {
    method: "POST",
    headers: { "svix-id": svixId, "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)), "svix-signature": signature },
    body,
  });
}

const clerkUser = (overrides: Record<string, unknown> = {}) => ({
  id: "user_1",
  username: "mayasaves",
  first_name: "Maya",
  last_name: "Rodriguez",
  primary_email_address_id: "e1",
  email_addresses: [{ id: "e1", email_address: "maya@gmail.com", verification: { status: "verified" } }],
  phone_numbers: [],
  public_metadata: {},
  updated_at: 100,
  ...overrides,
});

test("users.store creates the row once, from the token", async () => {
  const t = makeTest();
  const as = t.withIdentity(identity(1));
  const id = await as.mutation(api.users.store, {});
  expect(await as.mutation(api.users.store, {})).toBe(id);
  expect(await as.query(api.users.me, {})).toMatchObject({ email: "u1@example.com", display_name: "User 1", credit_balance: 0, level: 1 });
  expect(await t.query(api.users.me, {})).toBeNull(); // signed out
});

test("the Clerk webhook syncs, verifies .edu emails and ignores replays and stale updates", async () => {
  const t = makeTest();
  expect((await deliver(t, "user.created", clerkUser())).status).toBe(200);
  const as = t.withIdentity(identity(1)); // same subject and issuer → same token identifier
  expect(await as.query(api.users.me, {})).toMatchObject({ username: "mayasaves", display_name: "Maya Rodriguez", edu_verified: false });

  const withEdu = clerkUser({
    updated_at: 200,
    email_addresses: [
      { id: "e1", email_address: "maya@gmail.com", verification: { status: "verified" } },
      { id: "e2", email_address: "maya@g.ucla.edu", verification: { status: "verified" } },
    ],
    public_metadata: { role: "admin" },
  });
  await deliver(t, "user.updated", withEdu, "dup");
  await deliver(t, "user.updated", clerkUser({ updated_at: 999, username: "replayed" }), "dup"); // same svix-id: ignored
  await deliver(t, "user.updated", clerkUser({ updated_at: 150, username: "stale_name" })); // older than 200: ignored
  expect(await as.query(api.users.me, {})).toMatchObject({ username: "mayasaves", edu_verified: true, school: "ucla.edu", role: "admin" });

  expect((await t.fetch("/clerk-users-webhook", { method: "POST", body: "{}" })).status).toBe(400);
});

test("user.deleted removes personal rows and keeps submissions and credits unlinked", async () => {
  const t = makeTest();
  await deliver(t, "user.created", clerkUser());
  const as = t.withIdentity(identity(1));
  await as.mutation(api.prefs.saveLocation, { label: "Home", lat: 34.06, lng: -118.44 });
  await as.mutation(api.prefs.setTopics, { store_types: ["cafes"], deal_types: ["bogo"] });
  const userId = (await as.query(api.users.me, {}))!._id;
  await t.run(async (ctx) => {
    await ctx.db.insert("credit_ledger", { user_id: userId, amount: 500, type: "referral", status: "posted", created_at: 0 });
  });
  await deliver(t, "user.deleted", { id: "user_1", deleted: true });
  const left = await t.run(async (ctx) => ({
    locations: (await ctx.db.query("saved_locations").collect()).length,
    follows: (await ctx.db.query("category_follows").collect()).length + (await ctx.db.query("deal_type_follows").collect()).length,
    ledger: (await ctx.db.query("credit_ledger").collect()).map((e) => e.user_id ?? null),
    user: await ctx.db.get("users", userId),
  }));
  expect(left).toMatchObject({ locations: 0, follows: 0, ledger: [null] });
  expect(left.user!.deleted_at).toBeDefined();
  expect(left.user!.email).toBeUndefined();
  expect(await as.query(api.users.me, {})).toBeNull();
});

test("referrals credit both users once the new user verifies", async () => {
  const t = makeTest();
  const referrer = t.withIdentity(identity(9));
  await referrer.mutation(api.users.store, {});
  const code = (await referrer.query(api.users.me, {}))!.referral_code;
  // The new user signs up before verifying their email, then enters the code.
  await deliver(t, "user.created", clerkUser({ email_addresses: [{ id: "e1", email_address: "maya@gmail.com", verification: { status: "unverified" } }] }));
  const as = t.withIdentity(identity(1));
  await as.mutation(api.users.updateProfile, { referral_code: code.toLowerCase() });
  expect((await as.query(api.users.me, {}))!.credit_balance).toBe(0);
  await deliver(t, "user.updated", clerkUser({ updated_at: 300 }));
  expect((await as.query(api.users.me, {}))!.credit_balance).toBe(500);
  expect((await referrer.query(api.users.me, {}))!.credit_balance).toBe(500);
  await deliver(t, "user.updated", clerkUser({ updated_at: 400 }));
  expect((await referrer.query(api.users.me, {}))!.credit_balance).toBe(500); // once
});

test("usernames are validated and unique; 21+ needs a birthday", async () => {
  const t = makeTest();
  const a = t.withIdentity(identity(1));
  const b = t.withIdentity(identity(2));
  await a.mutation(api.users.store, {});
  await b.mutation(api.users.store, {});
  await a.mutation(api.users.updateProfile, { username: "Maya_1" });
  expect(await b.query(api.users.usernameAvailable, { username: "maya_1" })).toBe(false);
  await expect(b.mutation(api.users.updateProfile, { username: "maya_1" })).rejects.toThrow("taken");
  await expect(b.mutation(api.users.updateProfile, { username: "x" })).rejects.toThrow();
  expect(await b.mutation(api.users.unlockAdult, {})).toBe("no-birthday");
  await b.mutation(api.users.updateProfile, { birthday: `${new Date().getUTCFullYear() - 18}-01-01` });
  expect(await b.mutation(api.users.unlockAdult, {})).toBe("too-young");
});
