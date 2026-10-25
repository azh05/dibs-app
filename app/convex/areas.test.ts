import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { DAY } from "./lib/time";
import { identity, json, makeTest, shopsResponse, stubFetch, TAPIOCA, WESTWOOD, type T } from "./test.setup";

let restore: () => void = () => {};
beforeEach(() => {
  vi.useFakeTimers();
  process.env.DIBS_API_URL = "http://api.test";
  process.env.DIBS_API_KEY = "k";
});
afterEach(() => {
  restore();
  vi.useRealTimers();
});

const LA = { neighborhood: "Westwood", city: "Los Angeles", region: "California" };
const SANTA_MONICA = { lat: 34.0195, lng: -118.4912 }; // 3.8 mi from WESTWOOD
const ENZO = { lat: 34.0612, lng: -118.4471 };

/** A /discover/shops result: two shops from Google Maps, no deals. */
function discoveryResponse() {
  const base = shopsResponse({ deals: [], sources: [] });
  return {
    ...base,
    rejected: [],
    queries: ["maps: restaurant"],
    usage: { input_tokens: 0, output_tokens: 0, web_search_requests: 0 },
    provider: "apify_maps",
    brightdata_requests: 0,
    apify_runs: 7,
    shops: [
      base.shops[0],
      { id: "gmaps:enzo", name: "Enzo's Pizzeria", category: "Pizza restaurant", place_id: "enzo", ...ENZO, found_via: "google_maps" },
    ],
  };
}

/** Routes the API: discovery and deal-scan jobs both finish on their first poll. */
function api_(opts: { discovery?: unknown; scan?: unknown; failScan?: boolean } = {}) {
  const stub = stubFetch((url, init) => {
    if (url.endsWith("/discover/shops") && init?.method === "POST") return json({ job_id: "d1", status_url: "/discover/shops/d1" }, 202);
    if (url.includes("/discover/shops/")) return json({ job_id: "d1", status: "done", progress: [], result: opts.discovery ?? discoveryResponse() });
    if (url.endsWith("/extract/shops") && init?.method === "POST")
      return opts.failScan ? json({ detail: "down" }, 502) : json({ job_id: "s1", status_url: "/extract/shops/s1" }, 202);
    if (url.includes("/extract/shops/")) return json({ job_id: "s1", status: "done", progress: [], result: opts.scan ?? shopsResponse() });
    return json({}, 404);
  });
  restore = stub.restore;
  const posts = (path: string) => stub.calls.filter((c) => c.url.endsWith(path) && c.init?.method === "POST");
  return { calls: stub.calls, posts };
}

async function settle(t: T, ms = 1) {
  vi.advanceTimersByTime(ms);
  await t.finishInProgressScheduledFunctions();
}

/** Run what saving a place scheduled: the discovery (and any deal scan), then their polls. */
async function runJobs(t: T) {
  await settle(t);
  await settle(t, 15_000);
}

async function save(t: T, n: number, place: { lat: number; lng: number; radius_miles?: number; neighborhood?: string; city?: string; region?: string }) {
  const as = t.withIdentity(identity(n));
  await as.mutation(api.users.store, {});
  const id = await as.mutation(api.prefs.saveLocation, { label: "Home", ...place });
  return { as, loc: (await t.run((ctx) => ctx.db.get("saved_locations", id)))! };
}

const areas = (t: T) => t.run((ctx) => ctx.db.query("scan_areas").collect());
const links = (t: T) => t.run((ctx) => ctx.db.query("area_stores").collect());

test("a saved place starts an area, and places inside it share it", async () => {
  const t = makeTest();
  api_({ failScan: true });
  const { loc: first } = await save(t, 1, { ...WESTWOOD, ...LA, radius_miles: 1 });
  const [area] = await areas(t);
  expect(area).toMatchObject({ key: "westwood|los angeles|california", name: "Westwood", radius_miles: 1, enabled: true, categories: ["food", "drink"] });
  expect(first).toMatchObject({ scan_area_id: area!._id, scan_area_key: area!.key });

  // 0.23 mi away with a 0.5 mi circle: inside, even though its reverse geocode says Sawtelle.
  const { loc: second } = await save(t, 2, { ...TAPIOCA, neighborhood: "Sawtelle", city: "Los Angeles", region: "California", radius_miles: 0.5 });
  expect(await areas(t)).toHaveLength(1);
  expect(second).toMatchObject({ scan_area_id: area!._id, scan_area_key: "westwood|los angeles|california" });
});

test("a place near the center widens the area; a far one starts another", async () => {
  const t = makeTest();
  api_({ failScan: true });
  await save(t, 1, { ...WESTWOOD, ...LA, radius_miles: 1 });
  await save(t, 2, { ...TAPIOCA, ...LA, radius_miles: 1 });
  expect((await areas(t)).map((a) => a.radius_miles)).toEqual([1.25]); // 0.23 + 1, rounded up to 0.05

  const { loc } = await save(t, 3, { ...SANTA_MONICA, ...LA, radius_miles: 2 });
  const all = await areas(t);
  expect(all.map((a) => [a.key, a.radius_miles])).toEqual([
    ["westwood|los angeles|california", 1.25],
    ["westwood|los angeles|california#2", 2],
  ]);
  expect(loc.scan_area_key).toBe("westwood|los angeles|california#2");
});

test("discovery stores the area's shop list, not deals, and leaves the deal-scan clock alone", async () => {
  const t = makeTest();
  const { posts } = api_();
  await save(t, 1, { ...WESTWOOD, city: "Los Angeles", radius_miles: 1 }); // no neighborhood: no deal scan
  await runJobs(t);

  const [post] = posts("/discover/shops");
  expect(new Headers(post!.init?.headers).get("X-Dibs-Key")).toBe("k");
  expect(JSON.parse(post!.init!.body as string)).toMatchObject({
    lat: WESTWOOD.lat,
    lng: WESTWOOD.lng,
    radius_miles: 1,
    categories: ["food", "drink"],
    max_shops: 250,
    location: { city: "Los Angeles", timezone: "America/Los_Angeles" },
  });
  expect(posts("/extract/shops")).toHaveLength(0);

  const [area] = await areas(t);
  expect(area).toMatchObject({ store_count: 2, discovered_radius_miles: 1 });
  expect(area!.last_discovered_at).toBeGreaterThan(0);
  const rows = await links(t);
  expect(rows.map((r) => r.via)).toEqual(["maps", "maps"]);
  expect(rows.every((r) => r.distance_m! > 0 && r.distance_m! < 1609)).toBe(true);
  const db = await t.run(async (ctx) => ({
    stores: await ctx.db.query("stores").collect(),
    deals: await ctx.db.query("deals").collect(),
    notifications: await ctx.db.query("notifications").collect(),
    run: await ctx.db.query("agent_runs").first(),
  }));
  expect(db.stores.map((s) => [s.name, s.last_scanned_at, s.scan_area_key])).toEqual([
    ["Tapioca Lab", 0, area!.key],
    ["Enzo's Pizzeria", 0, area!.key],
  ]);
  expect(db.deals).toEqual([]);
  expect(db.notifications).toEqual([]);
  expect(db.run).toMatchObject({ provider: "apify_maps", status: "done", scan_area_id: area!._id, apify_runs: 7 });
  expect(db.run!.area).toBeUndefined();

  // Forced again a day later: same rows, newer last_seen_at.
  const firstSeen = rows[0]!.last_seen_at;
  vi.advanceTimersByTime(DAY);
  await t.action(internal.areas.startDiscovery, { areaId: area!._id, force: true });
  await settle(t, 15_000);
  const again = await links(t);
  expect(again).toHaveLength(2);
  expect(again[0]!.first_seen_at).toBe(firstSeen);
  expect(again[0]!.last_seen_at).toBeGreaterThan(firstSeen);
  expect(await t.run(async (ctx) => (await ctx.db.query("stores").collect()).length)).toBe(2);
});

test("chain branches on Google Maps stay separate stores; a deal-named store joins its Maps listing", async () => {
  const t = makeTest();
  const branch = (n: number, lat: number) => ({
    id: `gmaps:sb${n}`, name: "Starbucks", category: "Coffee shop", place_id: `sb${n}`, lat, lng: WESTWOOD.lng, instagram: "starbucks", found_via: "google_maps",
  });
  api_({ discovery: { ...discoveryResponse(), shops: [branch(1, 34.0628), branch(2, 34.0655)] } });
  const { loc } = await save(t, 1, { ...WESTWOOD, city: "Los Angeles" });
  await t.run(async (ctx) => {
    // Known before from a deal that only named it.
    await ctx.db.insert("stores", {
      external_id: "name:starbucks", name: "Starbucks", normalized_name: "starbucks", found_via: "deal", timezone: "America/Los_Angeles",
      scan_area_key: loc.scan_area_key, is_chain: false, geofence_m: 75, upvotes: 0, downvotes: 0, last_scanned_at: 5, created_at: 0,
    });
  });
  await runJobs(t);
  const stores = await t.run((ctx) => ctx.db.query("stores").collect());
  expect(stores.map((s) => [s.external_id, s.found_via]).sort()).toEqual([
    ["gmaps:sb1", "google_maps"], // took over the name-only record
    ["gmaps:sb2", "google_maps"],
  ]);
  expect((await links(t)).length).toBe(2);
});

test("a fresh area costs nothing: no call for a repeat, or for a new user inside it", async () => {
  const t = makeTest();
  const { posts } = api_();
  await save(t, 1, { ...WESTWOOD, city: "Los Angeles", radius_miles: 1 });
  await runJobs(t);
  expect(posts("/discover/shops")).toHaveLength(1);
  const [area] = await areas(t);

  expect(await t.action(internal.areas.startDiscovery, { areaId: area!._id })).toBeNull();
  await save(t, 2, { ...TAPIOCA, city: "Los Angeles", radius_miles: 0.5 });
  await runJobs(t);
  expect(posts("/discover/shops")).toHaveLength(1);

  // A week later it's due again.
  vi.advanceTimersByTime(8 * DAY);
  expect(await t.query(internal.areas.areasToDiscover, { now: Date.now() })).toEqual([area!._id]);
});

test("a discovery already running isn't started twice", async () => {
  const t = makeTest();
  const { posts } = api_();
  const { loc } = await save(t, 1, { ...WESTWOOD, city: "Los Angeles" });
  await settle(t); // the first discovery is now running
  expect(await t.action(internal.areas.startDiscovery, { areaId: loc.scan_area_id! })).toBeNull();
  expect(posts("/discover/shops")).toHaveLength(1);
});

test("the cron discovers watched areas that are new, stale or widened", async () => {
  const t = makeTest();
  api_({ failScan: true });
  const { as, loc } = await save(t, 1, { ...WESTWOOD, city: "Los Angeles", radius_miles: 1 });
  const areaId = loc.scan_area_id!;
  const due = () => t.query(internal.areas.areasToDiscover, { now: Date.now() });
  expect(await due()).toEqual([areaId]);

  await runJobs(t);
  expect(await due()).toEqual([]);
  await as.mutation(api.prefs.setAlertRadius, { radius_miles: 1.5 }); // widens it past the discovered 1 mi
  expect((await t.run((ctx) => ctx.db.get("scan_areas", areaId)))!.radius_miles).toBe(1.5);
  expect(await due()).toEqual([areaId]);

  await as.mutation(api.prefs.deleteLocation, { id: loc._id });
  expect(await due()).toEqual([]); // nobody watches it any more
});

test("a discovery run doesn't count as a recent deal scan", async () => {
  const t = makeTest();
  api_({ failScan: true });
  await save(t, 1, { ...WESTWOOD, ...LA, radius_miles: 0.5 });
  await runJobs(t); // discovery done; the deal scan failed
  const [area] = await areas(t);
  expect(await t.query(internal.scans.areasToScan, {})).toMatchObject([
    { scan_area_key: area!.key, lat: WESTWOOD.lat, radius_miles: 1, neighborhood: "Westwood" }, // the area's circle
  ]);
});

test("deal scans add shops inside the circle, or without coordinates, to the list", async () => {
  const t = makeTest();
  const base = shopsResponse();
  const pier = { id: "gmaps:pier", name: "Pier Cafe", place_id: "pier", ...SANTA_MONICA, found_via: "mention" };
  api_({ discovery: { ...discoveryResponse(), shops: [] }, scan: { ...base, shops: [...base.shops, pier] } });
  await save(t, 1, { ...WESTWOOD, ...LA, radius_miles: 1 });
  await runJobs(t);
  const names = await t.run(async (ctx) =>
    Promise.all((await ctx.db.query("area_stores").collect()).map(async (r) => [(await ctx.db.get("stores", r.store_id))!.name, r.via])),
  );
  expect(names.sort()).toEqual([
    ["Corner Bar", "scan"],
    ["Tapioca Lab", "scan"],
  ]);
});

test("one user can start at most 3 discoveries a day", async () => {
  const t = makeTest();
  const { posts } = api_();
  const places = [WESTWOOD, { lat: 34.1478, lng: -118.1445 }, { lat: 33.7701, lng: -118.1937 }, { lat: 33.6846, lng: -117.8265 }];
  const as = t.withIdentity(identity(1));
  await as.mutation(api.users.store, {});
  for (const p of places) await as.mutation(api.prefs.saveLocation, { label: "Place", ...p, city: "Los Angeles" });
  await runJobs(t);
  expect(await areas(t)).toHaveLength(4);
  expect(posts("/discover/shops")).toHaveLength(3);
  // The fourth is left to the cron.
  const due: Id<"scan_areas">[] = await t.query(internal.areas.areasToDiscover, { now: Date.now() });
  expect(due).toHaveLength(1);
});
