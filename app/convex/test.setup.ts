/// <reference types="vite/client" />
// Shared convex-test setup: the schema, every function module and the four components.
import geospatialTest from "@convex-dev/geospatial/test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";

import schema from "./schema";

export const modules = import.meta.glob("./**/!(*.*.*)*.*s");

export function makeTest() {
  const t = convexTest(schema, modules);
  geospatialTest.register(t, "dealGeo");
  geospatialTest.register(t, "locationGeo");
  geospatialTest.register(t, "areaGeo");
  rateLimiterTest.register(t);
  return t;
}

export type T = ReturnType<typeof makeTest>;

export const WESTWOOD = { lat: 34.0628, lng: -118.4455 };
export const TAPIOCA = { lat: 34.0644, lng: -118.4419 }; // 0.23 mi from WESTWOOD

/** A Clerk-like identity for t.withIdentity. */
export function identity(n: number) {
  return { subject: `user_${n}`, tokenIdentifier: `https://clerk.test|user_${n}`, issuer: "https://clerk.test", email: `u${n}@example.com`, name: `User ${n}` };
}

type Json = Record<string, unknown>;

/** A /extract/shops-style SearchResponse with two shops and two deals. */
export function shopsResponse(overrides: { deals?: Json[]; shops?: Json[]; sources?: Json[] } = {}) {
  return {
    as_of: "2026-10-24",
    deals: overrides.deals ?? [
      {
        id: "deal:aaa",
        shop_id: "gmaps:tapioca",
        shop_name: "Tapioca Lab",
        shop_handle: "tapiocalab",
        address: "1099 Gayley Ave",
        category: "drink",
        offer: "BOGO on all milk teas",
        code: null,
        conditions: ["dine-in or pickup"],
        start_date: null,
        end_date: "2099-12-31",
        start_time: null,
        end_time: "18:00:00",
        source_url: "https://www.instagram.com/p/tapioca1/",
        source_post_date: "2026-10-24",
        verbatim_quote: "BOGO all milk teas, today only",
        confidence: "high",
        status: "live",
        flags: ["shop_own_post"],
        headline: "BOGO",
        title: "BOGO milk tea",
        deal_types: ["bogo"],
        kind: "deal",
        student_only: false,
        age_21: false,
        est_savings_cents: 650,
        recurring_window: null,
      },
      {
        id: "deal:bbb",
        shop_id: "name:corner-bar",
        shop_name: "Corner Bar",
        shop_handle: null,
        address: null,
        category: "food",
        offer: "Half-price wings",
        code: null,
        conditions: [],
        start_date: null,
        end_date: null,
        start_time: null,
        end_time: null,
        source_url: "https://www.tiktok.com/@foodie/video/1",
        source_post_date: "2026-10-23",
        verbatim_quote: "half price wings at corner bar",
        confidence: "medium",
        status: "live",
        flags: ["second_hand", "no_end_date"],
        headline: "50% off",
        title: "Half-price wings",
        deal_types: ["percent_off"],
        kind: "deal",
        student_only: false,
        age_21: false,
        est_savings_cents: null,
        recurring_window: null,
      },
    ],
    rejected: [{ deal: { shop_name: "Nope", source_url: "https://example.com/x" }, reason: "missing_quote" }],
    queries: ["boba"],
    sources: overrides.sources ?? [
      { url: "https://www.instagram.com/p/tapioca1/", title: "post", page_age: "2026-10-24", text: "BOGO all milk teas, today only. Bring a friend.", origin: "instagram", handle: "tapiocalab" },
      { url: "https://www.tiktok.com/@foodie/video/1", title: "tiktok", page_age: "2026-10-23", text: "Went to corner bar, half price wings at corner bar!", origin: "tiktok", handle: "foodie" },
      { url: "https://www.instagram.com/p/unrelated/", title: "post", page_age: null, text: "no deal here", origin: "instagram", handle: "tapiocalab" },
    ],
    search_errors: [],
    usage: { input_tokens: 1000, output_tokens: 200, web_search_requests: 0 },
    provider: "apify_shops",
    brightdata_requests: 2,
    apify_runs: 5,
    shops: overrides.shops ?? [
      {
        id: "gmaps:tapioca",
        name: "Tapioca Lab",
        address: "1099 Gayley Ave",
        category: "Bubble tea store",
        maps_url: "https://maps.google.com/?cid=1",
        place_id: "tapioca",
        lat: TAPIOCA.lat,
        lng: TAPIOCA.lng,
        website: null,
        instagram: "tapiocalab",
        tiktok: null,
        facebook: null,
        hours: [{ day: "Monday", hours: "11 AM to 10 PM" }],
        found_via: "google_maps",
      },
      { id: "name:corner-bar", name: "Corner Bar", found_via: "deal" },
    ],
    transcript: null,
  };
}

export const ENZO = { lat: 34.0612, lng: -118.4471 };

/** A /discover/shops result: two shops from Google Maps, no deals. */
export function discoveryResponse() {
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

/** Replace global fetch with a router; returns the calls made. */
export function stubFetch(routes: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    return routes(url, init);
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
