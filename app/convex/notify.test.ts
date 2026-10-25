import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { api, internal } from "./_generated/api";
import { identity, json, makeTest, shopsResponse, stubFetch, TAPIOCA, WESTWOOD, type T } from "./test.setup";

let restore: () => void = () => {};
beforeEach(() => {
  process.env.DIBS_API_URL = "http://api.test";
});
afterEach(() => {
  restore();
  vi.useRealTimers();
});

const AREA = { scan_area_key: "westwood|los angeles|california", neighborhood: "Westwood" };

async function user(t: T, n: number, opts: { at?: { lat: number; lng: number }; radius?: number; types?: string[]; instant?: boolean } = {}) {
  const as = t.withIdentity(identity(n));
  const userId = await as.mutation(api.users.store, {});
  const at = opts.at ?? WESTWOOD;
  await as.mutation(api.prefs.saveLocation, { label: "Home", ...at, radius_miles: opts.radius ?? 1 });
  await as.mutation(api.prefs.setTopics, { store_types: opts.types ?? ["boba_tea"], deal_types: [] });
  if (opts.instant === false) await as.mutation(api.prefs.setInstantAlerts, { on: false });
  await as.mutation(api.prefs.registerDevice, { push_token: `ExponentPushToken[${n}]`, platform: "ios" });
  return { as, userId };
}

async function ingest(t: T) {
  const stub = stubFetch((url) =>
    url.includes("exp.host")
      ? json({ data: [{ status: "ok" }, { status: "error", details: { error: "DeviceNotRegistered" } }] })
      : json({ job_id: "j", status: "done", progress: [], result: shopsResponse() }),
  );
  restore = stub.restore;
  const runId = await t.mutation(internal.ingest.startRun, { provider: "apify_shops", trigger: "schedule", area: AREA, queries: [] });
  await t.mutation(internal.ingest.updateRun, { runId, status: "running", api_job_id: "j" });
  await t.action(internal.scans.pollShops, { runId });
  return stub;
}

test("a new deal alerts nearby followers of its type, once, by push", async () => {
  vi.useFakeTimers();
  const t = makeTest();
  const near = await user(t, 1);
  const far = await user(t, 2, { at: { lat: 34.1, lng: -118.3 } }); // ~10 mi away
  const notInterested = await user(t, 3, { types: ["gyms"] });
  const muted = await user(t, 4, { instant: false });
  const wide = await user(t, 5, { at: { lat: 34.09, lng: -118.4419 }, radius: 5, types: ["gyms"] });
  await wide.as.mutation(api.prefs.setFollow, {
    storeId: await t.run(async (ctx) => {
      // Follow the store before it has deals: create it via a first, empty run.
      return (await ctx.db.insert("stores", {
        external_id: "gmaps:tapioca", name: "Tapioca Lab", normalized_name: "tapioca lab", found_via: "google_maps",
        timezone: "America/Los_Angeles", is_chain: false, geofence_m: 75, upvotes: 0, downvotes: 0, last_scanned_at: 0, created_at: 0,
        lat: TAPIOCA.lat, lng: TAPIOCA.lng,
      }));
    }),
    on: true,
  });

  const stub = await ingest(t);
  vi.advanceTimersByTime(1);
  await t.finishInProgressScheduledFunctions();

  const inbox = async (as: typeof near.as) => (await as.query(api.notify.inbox, {})).map((n) => n.reason);
  expect(await inbox(near.as)).toEqual(["saved_location"]);
  expect(await inbox(wide.as)).toEqual(["followed_store"]);
  expect(await inbox(far.as)).toEqual([]);
  expect(await inbox(notInterested.as)).toEqual([]);
  expect(await inbox(muted.as)).toEqual([]);

  const pushes = stub.calls.filter((c) => c.url.includes("exp.host"));
  expect(pushes).toHaveLength(1);
  const sent = JSON.parse(pushes[0]!.init!.body as string);
  expect(sent.map((p: { to: string }) => p.to).sort()).toEqual(["ExponentPushToken[1]", "ExponentPushToken[5]"]);
  expect(sent[0]).toMatchObject({ title: "Tapioca Lab", categoryId: "deal-alert" });
  expect(sent[0].body).toContain("BOGO milk tea · via Instagram");

  // The token Expo called DeviceNotRegistered is gone.
  expect(await t.run(async (ctx) => (await ctx.db.query("devices").collect()).length)).toBe(4);

  // Re-planning sends nothing new.
  const dealId = await t.run(async (ctx) => (await ctx.db.query("deals").collect()).find((d) => d.offer.startsWith("BOGO"))!._id);
  expect(await t.mutation(internal.notify.planFanout, { dealId })).toEqual([]);
});

test("21+ deals skip users who haven't verified their age", async () => {
  vi.useFakeTimers();
  const t = makeTest();
  const a = await user(t, 1);
  const adult = await user(t, 2);
  await adult.as.mutation(api.users.updateProfile, { birthday: "1990-01-01" });
  expect(await adult.as.mutation(api.users.unlockAdult, {})).toBe("unlocked");
  await ingest(t);
  const dealId = await t.run(async (ctx) => {
    const d = (await ctx.db.query("deals").collect()).find((x) => x.offer.startsWith("BOGO"))!;
    await ctx.db.patch("deals", d._id, { age_21: true });
    for (const n of await ctx.db.query("notifications").collect()) await ctx.db.delete("notifications", n._id);
    return d._id;
  });
  const pushes = await t.mutation(internal.notify.planFanout, { dealId });
  expect(pushes.map((p) => p.to)).toEqual(["ExponentPushToken[2]"]);
  expect(await a.as.query(api.deals.feed, { ...WESTWOOD, radius_miles: 1 })).toEqual([]);
});

test("reminders fire once and can be cancelled", async () => {
  vi.useFakeTimers();
  const t = makeTest();
  const { as } = await user(t, 1);
  await ingest(t);
  vi.advanceTimersByTime(1);
  await t.finishInProgressScheduledFunctions();
  const dealId = await t.run(async (ctx) => (await ctx.db.query("deals").collect()).find((d) => d.offer.startsWith("Half"))!._id);
  await as.mutation(api.reminders.set, { dealId });
  expect(await as.query(api.reminders.mine, {})).toHaveLength(1);
  await as.mutation(api.reminders.cancel, { dealId });
  expect(await as.query(api.reminders.mine, {})).toHaveLength(0);
  await as.mutation(api.reminders.set, { dealId });
  vi.advanceTimersByTime(60 * 60_000 + 1);
  await t.finishInProgressScheduledFunctions();
  expect((await as.query(api.notify.inbox, {})).map((n) => n.reason)).toContain("reminder");
  expect(await as.query(api.reminders.mine, {})).toHaveLength(0);
});
