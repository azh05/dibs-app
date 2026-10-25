import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { DAY, HOUR, localDate } from "./lib/time";
import { discoveryResponse, identity, json, makeTest, shopsResponse, stubFetch, WESTWOOD, type T } from "./test.setup";

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

type Known = { id: string; name: string; instagram?: string; found_via: string; since?: string; lookup?: boolean };
type Body = { stores?: Known[]; sweep_only?: boolean };

/** What the API returns for a store batch: Tapioca Lab posted a deal; the lookup found Enzo's Instagram. */
function batchResult(body: Body) {
  const base = shopsResponse();
  const stores = body.stores ?? [];
  return {
    ...base,
    deals: [base.deals[0]], // Tapioca Lab's own BOGO post
    shops: stores.map((k) => (k.id === "gmaps:enzo" ? { ...k, instagram: "enzospizza" } : k)),
    scanned: stores.map((k) =>
      k.id === "gmaps:tapioca"
        ? { id: k.id, posts: 2, latest_post_date: "2026-10-24", deals: 1 }
        : { id: k.id, posts: 0, latest_post_date: null, deals: 0 },
    ),
  };
}

/** Routes the API. Discovery finishes on its first poll; the area scan a new place starts fails (it isn't under test). */
function api_(opts: { batch?: "ok" | "down" | "lost"; sweep?: unknown } = {}) {
  const jobs = new Map<string, Body>();
  const stub = stubFetch((url, init) => {
    if (url.endsWith("/discover/shops") && init?.method === "POST")
      return json({ job_id: "d1", status_url: "/discover/shops/d1" }, 202);
    if (url.includes("/discover/shops/"))
      return json({ job_id: "d1", status: "done", progress: [], result: discoveryResponse() });
    if (url.endsWith("/extract/shops") && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Body;
      if (!body.stores || (!body.sweep_only && opts.batch === "down")) return json({ detail: "down" }, 502);
      const id = `j${jobs.size + 1}`;
      jobs.set(id, body);
      return json({ job_id: id, status_url: `/extract/shops/${id}` }, 202);
    }
    const job = url.match(/\/extract\/shops\/(\w+)$/)?.[1];
    const body = job ? jobs.get(job) : undefined;
    if (body && !(opts.batch === "lost" && !body.sweep_only)) {
      const result = body.sweep_only ? (opts.sweep ?? shopsResponse()) : batchResult(body);
      return json({ job_id: job, status: "done", progress: [], result });
    }
    return json({ detail: "Not Found" }, 404);
  });
  restore = stub.restore;
  const bodies = () =>
    stub.calls
      .filter((c) => c.url.endsWith("/extract/shops") && c.init?.method === "POST")
      .map((c) => JSON.parse(String(c.init!.body)) as Body);
  return {
    batches: () => bodies().filter((b) => b.stores && !b.sweep_only),
    sweeps: () => bodies().filter((b) => b.sweep_only),
  };
}

async function settle(t: T, ms = 1) {
  vi.advanceTimersByTime(ms);
  await t.finishInProgressScheduledFunctions();
}

/** A watched Westwood area whose discovery found Tapioca Lab (Instagram) and Enzo's Pizzeria (nothing to scrape). */
async function westwood(t: T): Promise<Doc<"scan_areas">> {
  const as = t.withIdentity(identity(1));
  await as.mutation(api.users.store, {});
  await as.mutation(api.prefs.saveLocation, { label: "Home", ...WESTWOOD, ...LA, radius_miles: 1 });
  await settle(t);
  await settle(t, 15_000);
  const [area] = await t.run((ctx) => ctx.db.query("scan_areas").collect());
  expect(area!.store_count).toBe(2);
  return area!;
}

const store = (t: T, externalId: string) =>
  t.run((ctx) =>
    ctx.db
      .query("stores")
      .withIndex("by_external_id", (q) => q.eq("external_id", externalId))
      .unique(),
  );
const getRun = (t: T, runId: Id<"agent_runs">) => t.run((ctx) => ctx.db.get("agent_runs", runId));
const sent = (run: Doc<"agent_runs"> | null) => (run?.request as Body).stores ?? [];
const about = (ms: number) => expect.closeTo(ms, -1); // within a few ms: convex-test's clock ticks on its own

test("a batch takes the due stores with something to scrape, plus account lookups, and leases them", async () => {
  const t = makeTest();
  api_();
  const area = await westwood(t);
  const runId = (await t.mutation(internal.batches.claimBatch, { areaId: area._id }))!;
  const stores = sent(await getRun(t, runId));
  expect(stores.map((s) => s.id)).toEqual(["gmaps:enzo", "gmaps:tapioca"]); // Enzo has no channels: lookup only
  expect(stores[0]).toMatchObject({ name: "Enzo's Pizzeria", lookup: true });
  // Tapioca Lab is scraped, and looked up for its missing TikTok and Facebook (weekly at most).
  expect(stores[1]).toMatchObject({
    name: "Tapioca Lab",
    instagram: "tapiocalab",
    found_via: "google_maps",
    lookup: true,
  });
  expect(stores[1]!.since).toBeUndefined(); // never scanned
  expect((await store(t, "gmaps:tapioca"))!.next_scan_at).toEqual(about(Date.now() + HOUR));
  // Leased and running: the next tick takes nothing.
  expect(await t.mutation(internal.batches.claimBatch, { areaId: area._id })).toBeNull();
});

test("a finished batch schedules each store by its tier, and a store that gained an account goes next", async () => {
  const t = makeTest();
  const { batches } = api_();
  const area = await westwood(t);
  await t.action(internal.batches.scheduleBatches, {});
  await settle(t); // send
  await settle(t, 15_000); // poll, ingest, finishBatch
  expect(batches()).toHaveLength(1);
  const now = Date.now();

  const tapioca = (await store(t, "gmaps:tapioca"))!;
  expect(tapioca).toMatchObject({
    scan_tier: "hot",
    next_scan_at: about(now + DAY),
    last_deal_at: about(now),
    quiet_scans: 0,
    accounts_checked_at: about(now),
  });
  expect(tapioca.last_post_at).toBeGreaterThan(0);
  const enzo = (await store(t, "gmaps:enzo"))!;
  expect(enzo).toMatchObject({
    instagram_handle: "enzospizza",
    accounts_checked_at: about(now),
    next_scan_at: about(now),
    quiet_scans: 1,
  });

  const done = await t.run((ctx) =>
    ctx.db
      .query("agent_runs")
      .withIndex("by_status", (q) => q.eq("status", "done"))
      .collect(),
  );
  const run = done.find((r) => (r.request as Body | undefined)?.stores);
  expect(run).toMatchObject({ stores_scanned: 2, deals_found: 1 });
  expect(run!.cost_usd).toBeGreaterThan(0);

  // Next tick: only Enzo is due, now with its Instagram and, since it was scanned, a since date.
  await settle(t, 2 * 60_000);
  const next = (await t.mutation(internal.batches.claimBatch, { areaId: area._id }))!;
  const [enzoNext, ...rest] = sent(await getRun(t, next));
  expect(rest).toEqual([]);
  expect(enzoNext).toMatchObject({
    id: "gmaps:enzo",
    instagram: "enzospizza",
    since: localDate(now, "America/Los_Angeles"),
  });
  expect(enzoNext!.lookup).toBeUndefined(); // checked this week
});

test("a failed batch's stores come back once the lease runs out", async () => {
  const t = makeTest();
  api_({ batch: "down" });
  const area = await westwood(t);
  await t.action(internal.batches.scheduleBatches, {});
  await settle(t);
  const [failed] = await t.run((ctx) =>
    ctx.db
      .query("agent_runs")
      .withIndex("by_status", (q) => q.eq("status", "failed"))
      .collect(),
  );
  expect(failed).toBeDefined();
  expect(await t.mutation(internal.batches.claimBatch, { areaId: area._id })).toBeNull(); // still leased
  await settle(t, HOUR);
  const runId = await t.mutation(internal.batches.claimBatch, { areaId: area._id });
  expect(sent(await getRun(t, runId!)).map((s) => s.id)).toEqual(["gmaps:enzo", "gmaps:tapioca"]);
});

test("a batch the API lost is sent once more, then given up", async () => {
  const t = makeTest();
  const { batches } = api_({ batch: "lost" });
  await westwood(t);
  await t.action(internal.batches.scheduleBatches, {});
  await settle(t); // send
  await settle(t, 15_000); // poll: 404, re-queued
  await settle(t); // send again
  await settle(t, 15_000); // poll: 404 again
  expect(batches()).toHaveLength(2);
  const runs = await t.run((ctx) => ctx.db.query("agent_runs").collect());
  expect(runs.filter((r) => (r.request as Body | undefined)?.stores)).toEqual([
    expect.objectContaining({ status: "failed", retried: true }),
  ]);
});

test("an area over its daily budget gets no batch or sweep", async () => {
  const t = makeTest();
  api_();
  const area = await westwood(t);
  await t.run(async (ctx) => {
    const runId = await ctx.db.insert("agent_runs", {
      provider: "apify_shops",
      trigger: "schedule",
      status: "done",
      area: { scan_area_key: area.key },
      queries: [],
      poll_attempts: 0,
      search_errors: [],
      input_tokens: 0,
      output_tokens: 0,
      web_search_requests: 0,
      brightdata_requests: 0,
      apify_runs: 0,
      deals_found: 0,
      cost_usd: 5,
      started_at: Date.now(),
    });
    return runId;
  });
  expect(await t.mutation(internal.batches.claimBatch, { areaId: area._id })).toBeNull();
  expect(await t.mutation(internal.batches.claimSweep, { areaId: area._id })).toBeNull();
  await t.run((ctx) => ctx.db.patch("scan_areas", area._id, { daily_budget_usd: 10 }));
  expect(await t.mutation(internal.batches.claimBatch, { areaId: area._id })).not.toBeNull();
});

test("the daily sweep sends the area's accounts once a day and leaves their scan clock alone", async () => {
  const t = makeTest();
  const { sweeps } = api_();
  const area = await westwood(t);
  await t.action(internal.batches.scheduleSweeps, {});
  await t.action(internal.batches.scheduleSweeps, {}); // same day: nothing more
  await settle(t);
  await settle(t, 15_000);
  expect(sweeps()).toHaveLength(1);
  const [body] = sweeps();
  expect(body!.stores).toEqual([
    {
      id: "gmaps:tapioca",
      name: "Tapioca Lab",
      category: "Bubble tea store",
      lat: expect.any(Number),
      lng: expect.any(Number),
      instagram: "tapiocalab",
      found_via: "google_maps",
    },
  ]);

  expect((await store(t, "gmaps:tapioca"))!.last_scanned_at).toBe(0); // the sweep didn't scrape its channels
  const bar = (await store(t, "name:corner-bar"))!; // a shop the sweep's deal named joins the list, never scanned
  expect(bar.last_scanned_at).toBe(0);
  const linked = await t.run((ctx) =>
    ctx.db
      .query("area_stores")
      .withIndex("by_store", (q) => q.eq("store_id", bar._id))
      .collect(),
  );
  expect(linked).toEqual([expect.objectContaining({ area_id: area._id, via: "scan" })]);
  const done = await t.run((ctx) =>
    ctx.db
      .query("agent_runs")
      .withIndex("by_status", (q) => q.eq("status", "done"))
      .collect(),
  );
  expect(done.find((r) => (r.request as Body | undefined)?.sweep_only)).toMatchObject({ stores_scanned: 0 });
});
