import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { DAY } from "./lib/time";
import { identity, json, makeTest, stubFetch, type T } from "./test.setup";

let restore: () => void = () => {};
beforeEach(() => {
  vi.useFakeTimers();
  process.env.DIBS_API_URL = "http://api.test";
});
afterEach(() => {
  restore();
  vi.useRealTimers();
});

function photoResponse(n: number, shop = `Shop ${n}`) {
  const slug = shop.toLowerCase().replace(/\W+/g, "-");
  return {
    as_of: "2026-10-24",
    deals: [
      {
        id: `deal:photo${n}`,
        shop_id: `name:${slug}`,
        shop_name: shop,
        category: "beauty",
        offer: `$${10 + n} cuts with student ID`,
        conditions: [],
        end_date: "2099-12-31",
        source_url: `https://dibs.local/photo/hash${n}`,
        source_post_date: "2026-10-24",
        verbatim_quote: "STUDENT CUTS",
        confidence: "high",
        status: "live",
        flags: [],
        deal_types: ["student"],
        kind: "deal",
      },
    ],
    rejected: [],
    queries: [],
    sources: [{ url: `https://dibs.local/photo/hash${n}`, text: "STUDENT CUTS $15", origin: "photo" }],
    search_errors: [],
    usage: { input_tokens: 10, output_tokens: 5, web_search_requests: 0 },
    provider: "user_photo",
    brightdata_requests: 0,
    apify_runs: 0,
    shops: [{ id: `name:${slug}`, name: shop, found_via: "deal" }],
    transcript: "STUDENT CUTS $15",
  };
}

async function settle(t: T, ms = 1) {
  vi.advanceTimersByTime(ms);
  await t.finishInProgressScheduledFunctions();
}

async function signIn(t: T, n: number) {
  const as = t.withIdentity(identity(n));
  const userId = await as.mutation(api.users.store, {});
  return { as, userId };
}

async function submitPhoto(t: T, as: ReturnType<T["withIdentity"]>, n: number, response = photoResponse(n)) {
  const stub = stubFetch(() => json(response));
  restore = stub.restore;
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob([`photo-${n}-${Math.random()}`], { type: "image/png" })));
  const id = await as.mutation(api.photos.submit, { storageId, photo_date: "2026-10-24" });
  await settle(t); // processPhoto
  await settle(t); // alerts
  stub.restore();
  return { id, stub };
}

async function credits(t: T, userId: Id<"users">) {
  return t.run(async (ctx) => ({
    balance: (await ctx.db.get("users", userId))!.credit_balance,
    entries: (await ctx.db.query("credit_ledger").withIndex("by_user_created", (q) => q.eq("user_id", userId)).collect()).map((e) => e.status),
  }));
}

test("a verified photo of a new deal earns pending credits that post after 24 hours", async () => {
  const t = makeTest();
  const { as, userId } = await signIn(t, 1);
  const { id, stub } = await submitPhoto(t, as, 1);
  const form = stub.calls[0]!.init!.body as FormData;
  expect(stub.calls[0]!.url).toBe("http://api.test/extract/photo");
  expect(form.get("photo_date")).toBe("2026-10-24");

  const sub = await as.query(api.photos.get, { id });
  expect(sub).toMatchObject({ state: "done", result: "confirmed", store: "Shop 1", credit: { amount: 500, status: "pending" } });
  expect(await credits(t, userId)).toEqual({ balance: 0, entries: ["pending"] });
  expect((await as.query(api.users.me, {}))!.xp).toBe(100);

  await settle(t, DAY);
  expect(await credits(t, userId)).toEqual({ balance: 500, entries: ["posted"] });
  expect((await as.query(api.credits.history, {}))!.balance).toBe(500);
});

test("an 'ended' report before then reverses the credits", async () => {
  const t = makeTest();
  const { as, userId } = await signIn(t, 1);
  const { id } = await submitPhoto(t, as, 1);
  const dealId = (await as.query(api.photos.get, { id }))!.deal_id!;
  const other = await signIn(t, 2);
  await other.as.mutation(api.community.confirm, { dealId, kind: "ended" });
  expect(await credits(t, userId)).toEqual({ balance: 0, entries: ["reversed"] });
  await settle(t, DAY);
  expect((await credits(t, userId)).balance).toBe(0);
});

test("two other users confirming posts the credits early", async () => {
  const t = makeTest();
  const { as, userId } = await signIn(t, 1);
  const { id } = await submitPhoto(t, as, 1);
  const dealId = (await as.query(api.photos.get, { id }))!.deal_id!;
  await as.mutation(api.community.confirm, { dealId, kind: "still_running" }); // the submitter doesn't count
  await (await signIn(t, 2)).as.mutation(api.community.confirm, { dealId, kind: "still_running" });
  expect((await credits(t, userId)).entries).toEqual(["pending"]);
  await (await signIn(t, 3)).as.mutation(api.community.confirm, { dealId, kind: "still_running" });
  expect(await credits(t, userId)).toEqual({ balance: 500, entries: ["posted"] });
});

test("only 3 submissions a day earn credits", async () => {
  const t = makeTest();
  const { as, userId } = await signIn(t, 1);
  for (const n of [1, 2, 3, 4]) await submitPhoto(t, as, n);
  expect((await credits(t, userId)).entries).toEqual(["pending", "pending", "pending"]);
  const subs = await as.query(api.photos.mine, {});
  expect(subs.map((s) => s.result)).toEqual(["confirmed", "confirmed", "confirmed", "confirmed"]);
});

test("a photo of a deal we already know confirms it instead of earning credits", async () => {
  const t = makeTest();
  const first = await signIn(t, 1);
  const { id } = await submitPhoto(t, first.as, 1);
  const dealId = (await first.as.query(api.photos.get, { id }))!.deal_id!;
  const second = await signIn(t, 2);
  // Same shop and offer, different photo: merged into the same deal.
  const again = photoResponse(1);
  again.deals[0]!.id = "deal:photo1b";
  again.deals[0]!.source_url = again.sources[0]!.url = "https://dibs.local/photo/other";
  const { id: id2 } = await submitPhoto(t, second.as, 2, again);
  expect((await second.as.query(api.photos.get, { id: id2 }))!).toMatchObject({ result: "confirmed", deal_id: dealId, credit: null });
  expect(await t.run(async (ctx) => (await ctx.db.get("deals", dealId))!.confirmation_count)).toBe(1);
});

test("the same photo can't be submitted twice", async () => {
  const t = makeTest();
  const { as } = await signIn(t, 1);
  const a = await t.run((ctx) => ctx.storage.store(new Blob(["same bytes"], { type: "image/png" })));
  const b = await t.run((ctx) => ctx.storage.store(new Blob(["same bytes"], { type: "image/png" })));
  restore = stubFetch(() => json(photoResponse(1))).restore;
  await as.mutation(api.photos.submit, { storageId: a });
  await expect(as.mutation(api.photos.submit, { storageId: b })).rejects.toThrow("already submitted");
});

test("an expired poster is recorded but earns nothing", async () => {
  const t = makeTest();
  const { as, userId } = await signIn(t, 1);
  const expired = photoResponse(1);
  Object.assign(expired.deals[0]!, { status: "expired", end_date: "2026-07-06" });
  const { id } = await submitPhoto(t, as, 1, expired);
  expect((await as.query(api.photos.get, { id }))!.result).toBe("expired");
  expect((await credits(t, userId)).entries).toEqual([]);
});
