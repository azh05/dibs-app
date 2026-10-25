import { afterEach, beforeEach, expect, test } from "vitest";

import { internal, api } from "./_generated/api";
import { json, makeTest, shopsResponse, stubFetch, TAPIOCA, WESTWOOD, type T } from "./test.setup";

let restore: () => void = () => {};
beforeEach(() => {
  process.env.DIBS_API_URL = "http://api.test";
  process.env.DIBS_API_KEY = "k";
});
afterEach(() => restore());

const AREA = { scan_area_key: "westwood|los angeles|california", neighborhood: "Westwood", city: "Los Angeles", region: "California", timezone: "America/Los_Angeles" };

async function runShops(t: T, result: unknown) {
  const fetchStub = stubFetch((url) => (url.includes("/extract/shops/") ? json({ job_id: "j", status: "done", progress: [], result }) : json({}, 404)));
  restore = fetchStub.restore;
  const runId = await t.mutation(internal.ingest.startRun, { provider: "apify_shops", trigger: "schedule", area: AREA, queries: [] });
  await t.mutation(internal.ingest.updateRun, { runId, status: "running", api_job_id: "j" });
  await t.action(internal.scans.pollShops, { runId });
  fetchStub.restore();
  return { runId, calls: fetchStub.calls };
}

async function counts(t: T) {
  return t.run(async (ctx) => ({
    stores: (await ctx.db.query("stores").collect()).length,
    sources: (await ctx.db.query("sources").collect()).length,
    deals: (await ctx.db.query("deals").collect()).length,
    evidence: (await ctx.db.query("deal_evidence").collect()).length,
    rejected: (await ctx.db.query("rejected_extractions").collect()).length,
  }));
}

test("a shops job is written once, and re-running it adds nothing", async () => {
  const t = makeTest();
  const { runId, calls } = await runShops(t, shopsResponse());
  expect(calls[0]!.url).toBe("http://api.test/extract/shops/j");
  expect(new Headers(calls[0]!.init?.headers).get("X-Dibs-Key")).toBe("k");
  // Only cited sources are kept (the unrelated post is dropped).
  expect(await counts(t)).toEqual({ stores: 2, sources: 2, deals: 2, evidence: 2, rejected: 1 });
  const run = await t.run((ctx) => ctx.db.get("agent_runs", runId));
  expect(run).toMatchObject({ status: "done", deals_found: 2, apify_runs: 5, input_tokens: 1000 });

  await runShops(t, shopsResponse());
  expect(await counts(t)).toMatchObject({ stores: 2, sources: 2, deals: 2, evidence: 2 });
});

test("stores get a catalog type, hours and coordinates; deals get times and flags", async () => {
  const t = makeTest();
  await runShops(t, shopsResponse());
  const { tapioca, bar, boba, wings } = await t.run(async (ctx) => {
    const stores = await ctx.db.query("stores").collect();
    const deals = await ctx.db.query("deals").collect();
    return {
      tapioca: stores.find((s) => s.name === "Tapioca Lab")!,
      bar: stores.find((s) => s.name === "Corner Bar")!,
      boba: deals.find((d) => d.offer.startsWith("BOGO"))!,
      wings: deals.find((d) => d.offer.startsWith("Half"))!,
    };
  });
  expect(tapioca).toMatchObject({ store_type: "boba_tea", instagram_handle: "tapiocalab", google_place_id: "tapioca", lat: TAPIOCA.lat });
  expect(tapioca.hours).toEqual([{ day: "Monday", hours: "11 AM to 10 PM" }]);
  expect(bar.store_type).toBe("restaurants"); // no Maps category: the deal's "food"
  expect(boba).toMatchObject({ status: "live", headline: "BOGO", deal_types: ["bogo"], est_savings_cents: 650, second_hand: false, geo_indexed: true, end_time: "18:00" });
  expect(boba.flags).toContain("shop_own_post");
  expect(new Date(boba.ends_at!).toISOString()).toBe("2100-01-01T02:00:00.000Z"); // 6 PM Pacific
  expect(wings).toMatchObject({ second_hand: true, has_coords: false, geo_indexed: false });
  expect(wings.flags).toContain("second_hand");
});

test("the same offer from a shop's own post makes a second-hand deal first-hand", async () => {
  const t = makeTest();
  await runShops(t, shopsResponse());
  const own = shopsResponse({
    deals: [
      {
        ...shopsResponse().deals[1],
        id: "deal:ccc",
        source_url: "https://www.instagram.com/p/cornerbar/",
        verbatim_quote: "Half-price wings all week",
        flags: ["shop_own_post"],
      },
    ],
    sources: [{ url: "https://www.instagram.com/p/cornerbar/", text: "Half-price wings all week", origin: "instagram", handle: "cornerbar" }],
  });
  await runShops(t, own);
  const deals = await t.run((ctx) => ctx.db.query("deals").collect());
  const wings = deals.find((d) => d.offer.startsWith("Half"))!;
  expect(deals).toHaveLength(2); // merged by dedupe key, not a new deal
  expect(wings.second_hand).toBe(false);
  expect(await t.run((ctx) => ctx.db.query("deal_evidence").withIndex("by_deal", (q) => q.eq("deal_id", wings._id)).collect())).toHaveLength(2);
});

test("the feed returns nearby deals and coord-less deals for the area", async () => {
  const t = makeTest();
  await runShops(t, shopsResponse());
  const near = await t.query(api.deals.feed, { ...WESTWOOD, radius_miles: 1 });
  expect(near.map((d) => d.store?.name)).toEqual(["Tapioca Lab"]);
  expect(near[0]!.distance_m).toBeGreaterThan(300);
  expect(near[0]!.distance_m).toBeLessThan(400);
  expect(near[0]).toMatchObject({ source: { kind: "instagram", handle: "tapiocalab" }, saved: false });

  const withArea = await t.query(api.deals.feed, { ...WESTWOOD, radius_miles: 1, scan_area_key: AREA.scan_area_key });
  expect(withArea.map((d) => d.store?.name).sort()).toEqual(["Corner Bar", "Tapioca Lab"]);

  const far = await t.query(api.deals.feed, { lat: 37.77, lng: -122.42, radius_miles: 5 });
  expect(far).toEqual([]);
});

test("expired deals leave the feed when status is recomputed", async () => {
  const t = makeTest();
  await runShops(t, shopsResponse());
  await t.run(async (ctx) => {
    const boba = (await ctx.db.query("deals").collect()).find((d) => d.offer.startsWith("BOGO"))!;
    await ctx.db.patch("deals", boba._id, { end_date: "2020-01-01" });
  });
  expect(await t.mutation(internal.deals.recomputeStatus, {})).toBe(1);
  expect(await t.query(api.deals.feed, { ...WESTWOOD, radius_miles: 1 })).toEqual([]);
});

test("a failed job marks the run failed", async () => {
  const t = makeTest();
  const fetchStub = stubFetch(() => json({ job_id: "j", status: "failed", progress: [], error: { status_code: 502, detail: "maps down" } }));
  restore = fetchStub.restore;
  const runId = await t.mutation(internal.ingest.startRun, { provider: "apify_shops", trigger: "schedule", area: AREA, queries: [] });
  await t.mutation(internal.ingest.updateRun, { runId, status: "running", api_job_id: "j" });
  await t.action(internal.scans.pollShops, { runId });
  expect(await t.run((ctx) => ctx.db.get("agent_runs", runId))).toMatchObject({ status: "failed", error: "502: maps down" });
});
