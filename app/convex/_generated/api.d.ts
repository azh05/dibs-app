/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as areas from "../areas.js";
import type * as batches from "../batches.js";
import type * as catalog from "../catalog.js";
import type * as challenges from "../challenges.js";
import type * as community from "../community.js";
import type * as credits from "../credits.js";
import type * as crons from "../crons.js";
import type * as deals from "../deals.js";
import type * as http from "../http.js";
import type * as ingest from "../ingest.js";
import type * as leaderboards from "../leaderboards.js";
import type * as lib_api from "../lib/api.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_cost from "../lib/cost.js";
import type * as lib_credits from "../lib/credits.js";
import type * as lib_deals from "../lib/deals.js";
import type * as lib_gamify from "../lib/gamify.js";
import type * as lib_geo from "../lib/geo.js";
import type * as lib_levels from "../lib/levels.js";
import type * as lib_line from "../lib/line.js";
import type * as lib_rateLimits from "../lib/rateLimits.js";
import type * as lib_status from "../lib/status.js";
import type * as lib_text from "../lib/text.js";
import type * as lib_tiers from "../lib/tiers.js";
import type * as lib_time from "../lib/time.js";
import type * as lib_views from "../lib/views.js";
import type * as lineChecks from "../lineChecks.js";
import type * as notify from "../notify.js";
import type * as photos from "../photos.js";
import type * as prefs from "../prefs.js";
import type * as profile from "../profile.js";
import type * as reminders from "../reminders.js";
import type * as saves from "../saves.js";
import type * as scans from "../scans.js";
import type * as social from "../social.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  areas: typeof areas;
  batches: typeof batches;
  catalog: typeof catalog;
  challenges: typeof challenges;
  community: typeof community;
  credits: typeof credits;
  crons: typeof crons;
  deals: typeof deals;
  http: typeof http;
  ingest: typeof ingest;
  leaderboards: typeof leaderboards;
  "lib/api": typeof lib_api;
  "lib/auth": typeof lib_auth;
  "lib/cost": typeof lib_cost;
  "lib/credits": typeof lib_credits;
  "lib/deals": typeof lib_deals;
  "lib/gamify": typeof lib_gamify;
  "lib/geo": typeof lib_geo;
  "lib/levels": typeof lib_levels;
  "lib/line": typeof lib_line;
  "lib/rateLimits": typeof lib_rateLimits;
  "lib/status": typeof lib_status;
  "lib/text": typeof lib_text;
  "lib/tiers": typeof lib_tiers;
  "lib/time": typeof lib_time;
  "lib/views": typeof lib_views;
  lineChecks: typeof lineChecks;
  notify: typeof notify;
  photos: typeof photos;
  prefs: typeof prefs;
  profile: typeof profile;
  reminders: typeof reminders;
  saves: typeof saves;
  scans: typeof scans;
  social: typeof social;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  dealGeo: import("@convex-dev/geospatial/_generated/component.js").ComponentApi<"dealGeo">;
  locationGeo: import("@convex-dev/geospatial/_generated/component.js").ComponentApi<"locationGeo">;
  areaGeo: import("@convex-dev/geospatial/_generated/component.js").ComponentApi<"areaGeo">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
