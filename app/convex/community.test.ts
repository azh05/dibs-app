import { afterEach, beforeEach, expect, test } from "vitest";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { blend } from "./lib/line";
import { identity, json, makeTest, shopsResponse, stubFetch, TAPIOCA, WESTWOOD, type T } from "./test.setup";

let restore: () => void = () => {};
beforeEach(() => {
  process.env.DIBS_API_URL = "http://api.test";
});
afterEach(() => restore());

async function seed(t: T) {
  restore = stubFetch(() => json({ job_id: "j", status: "done", progress: [], result: shopsResponse() })).restore;
  const runId = await t.mutation(internal.ingest.startRun, {
    provider: "apify_shops",
    trigger: "schedule",
    area: { scan_area_key: "westwood|los angeles|california", neighborhood: "Westwood" },
    queries: [],
  });
  await t.mutation(internal.ingest.updateRun, { runId, status: "running", api_job_id: "j" });
  await t.action(internal.scans.pollShops, { runId });
  restore();
  return t.run(async (ctx) => {
    const store = (await ctx.db.query("stores").collect()).find((s) => s.name === "Tapioca Lab")!;
    const deal = (await ctx.db.query("deals").withIndex("by_store", (q) => q.eq("store_id", store._id)).first())!;
    return { storeId: store._id, dealId: deal._id };
  });
}

async function signIn(t: T, n: number) {
  const as = t.withIdentity(identity(n));
  const userId = await as.mutation(api.users.store, {});
  return { as, userId };
}

test("blend drops outliers and favours recent reports", () => {
  const now = 1_000_000_000;
  expect(blend([], now)).toBeNull();
  const r = blend(
    [
      { wait_minutes: 15, reported_at: now, score: 1 },
      { wait_minutes: 15, reported_at: now - 5 * 60_000, score: 1 },
      { wait_minutes: 20, reported_at: now - 10 * 60_000, score: 1 },
      { wait_minutes: 120, reported_at: now, score: 1 }, // troll
    ],
    now,
  )!;
  expect(r.count).toBe(3);
  expect(r.minutes).toBeGreaterThanOrEqual(15);
  expect(r.minutes).toBeLessThanOrEqual(17);
});

test("line reports inside the geofence count and earn XP, capped per day", async () => {
  const t = makeTest();
  const { storeId, dealId } = await seed(t);
  const { as } = await signIn(t, 1);
  const inside = await as.mutation(api.lineChecks.report, { storeId, wait_minutes: 15, ...TAPIOCA });
  expect(inside).toMatchObject({ in_geofence: true, xp: 10 });
  const outside = await as.mutation(api.lineChecks.report, { storeId, wait_minutes: 90, ...WESTWOOD });
  expect(outside).toMatchObject({ in_geofence: false, xp: 0 });
  expect(await t.query(api.lineChecks.estimate, { storeId })).toMatchObject({ minutes: 15, reports: 1 });
  const view = await as.query(api.deals.get, { id: dealId });
  expect(view!.line).toEqual({ minutes: 15, reports: 1 });

});

test("line-check XP stops at 5 a day", async () => {
  const t = makeTest();
  const { storeId } = await seed(t);
  const { as, userId } = await signIn(t, 1);
  await t.run(async (ctx) => {
    for (let i = 0; i < 5; i++)
      await ctx.db.insert("xp_ledger", { user_id: userId, amount: 10, reason: "line_check", created_at: Date.now() - i * 60_000 });
  });
  expect(await as.mutation(api.lineChecks.report, { storeId, wait_minutes: 15, ...TAPIOCA })).toMatchObject({ in_geofence: true, xp: 0 });
});

test("undo removes the report and its XP", async () => {
  const t = makeTest();
  const { storeId } = await seed(t);
  const { as } = await signIn(t, 1);
  const { reportId } = await as.mutation(api.lineChecks.report, { storeId, wait_minutes: 30, ...TAPIOCA });
  await as.mutation(api.lineChecks.undo, { reportId });
  expect((await as.query(api.users.me, {}))!.xp).toBe(0);
  expect(await t.query(api.lineChecks.estimate, { storeId })).toBeNull();
});

test("votes toggle and keep cached counts", async () => {
  const t = makeTest();
  const { dealId } = await seed(t);
  const a = await signIn(t, 1);
  const b = await signIn(t, 2);
  await a.as.mutation(api.community.vote, { targetType: "deal", targetId: dealId, value: 1 });
  await b.as.mutation(api.community.vote, { targetType: "deal", targetId: dealId, value: -1 });
  await a.as.mutation(api.community.vote, { targetType: "deal", targetId: dealId, value: -1 }); // switch
  const deal = await t.run((ctx) => ctx.db.get("deals", dealId as Id<"deals">));
  expect(deal).toMatchObject({ upvotes: 0, downvotes: 2 });
  expect((await a.as.query(api.deals.get, { id: dealId }))!.my_vote).toBe(-1);
});

test("three 'ended' reports hide a deal", async () => {
  const t = makeTest();
  const { dealId } = await seed(t);
  for (const n of [1, 2, 3]) await (await signIn(t, n)).as.mutation(api.community.confirm, { dealId, kind: "ended" });
  expect((await t.run((ctx) => ctx.db.get("deals", dealId)))!.status).toBe("hidden");
  expect(await t.query(api.deals.feed, { ...WESTWOOD, radius_miles: 1 })).toEqual([]);
});

test("a confirmation is one per user per day; changing your mind swaps it", async () => {
  const t = makeTest();
  const { dealId } = await seed(t);
  const { as } = await signIn(t, 1);
  expect(await as.mutation(api.community.confirm, { dealId, kind: "still_running" })).toBe(true);
  expect(await as.mutation(api.community.confirm, { dealId, kind: "still_running" })).toBe(false);
  await as.mutation(api.community.confirm, { dealId, kind: "ended" });
  expect(await t.run((ctx) => ctx.db.get("deals", dealId))).toMatchObject({ confirmation_count: 0, ended_count: 1 });
});

