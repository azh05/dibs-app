// The "Backend data model" doc as a Convex schema. Field names follow what the API returns (snake_case), so the
// extraction results write straight in. Convex has no unique indexes: every "unique" below is an index that the
// writing mutation checks with .unique() before inserting (mutations are serializable, so this is safe).
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const provider = v.union(
  v.literal("claude_web_search"),
  v.literal("brightdata_serp"),
  v.literal("brightdata_instagram"),
  v.literal("user_photo"),
  v.literal("apify_shops"),
  v.literal("apify_maps"),
);

export const dealStatus = v.union(
  v.literal("live"),
  v.literal("needs_check"),
  v.literal("stale"),
  v.literal("expired"),
  v.literal("upcoming"), // starts in the future
  v.literal("hidden"), // 3+ "ended" reports
);

export const dealType = v.union(
  v.literal("bogo"),
  v.literal("percent_off"),
  v.literal("free"),
  v.literal("student"),
  v.literal("happy_hour"),
  v.literal("late_night"),
  v.literal("new_opening"),
  v.literal("event"),
);

export const confidence = v.union(v.literal("high"), v.literal("medium"), v.literal("low"));

export const sourceKind = v.union(
  v.literal("instagram"),
  v.literal("tiktok"),
  v.literal("facebook"),
  v.literal("website"),
  v.literal("google"),
  v.literal("photo"),
);

export const recurringWindow = v.object({
  days: v.array(v.string()), // mon … sun; empty = every day
  start_time: v.optional(v.string()), // HH:MM
  end_time: v.optional(v.string()),
});

export const notificationReason = v.union(
  v.literal("saved_location"),
  v.literal("followed_store"),
  v.literal("category"),
  v.literal("ending_soon"),
  v.literal("event_reminder"),
  v.literal("reminder"),
);

export const reminderReason = v.union(v.literal("user_chosen"), v.literal("event_start"), v.literal("ending_soon"));

export const area = v.object({
  scan_area_key: v.string(),
  neighborhood: v.optional(v.string()),
  city: v.optional(v.string()),
  region: v.optional(v.string()),
  timezone: v.optional(v.string()),
  lat: v.optional(v.number()),
  lng: v.optional(v.number()),
  radius_miles: v.optional(v.number()),
  saved_location_id: v.optional(v.id("saved_locations")),
});

export default defineSchema({
  // ---------------------------------------------------------------- users and preferences

  users: defineTable({
    clerk_user_id: v.string(), // identity.subject
    token_identifier: v.string(), // identity.tokenIdentifier; every protected function looks the user up by it
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    username: v.optional(v.string()),
    role: v.union(v.literal("user"), v.literal("admin")), // Clerk public_metadata.role
    display_name: v.optional(v.string()),
    avatar_url: v.optional(v.string()),
    birthday: v.optional(v.string()), // YYYY-MM-DD, for the 21+ check
    age_21_verified_at: v.optional(v.number()),
    is_student: v.boolean(),
    edu_email: v.optional(v.string()),
    edu_verified_at: v.optional(v.number()), // set by the Clerk webhook when a .edu address is verified
    school: v.optional(v.string()), // from the verified .edu domain, e.g. "ucla.edu"
    home_neighborhood: v.optional(v.string()),
    credit_balance: v.number(), // posted credits only (see credit_ledger)
    instant_alerts: v.boolean(),
    referral_code: v.string(),
    referred_by: v.optional(v.id("users")),
    referral_rewarded_at: v.optional(v.number()),
    xp: v.number(),
    level: v.number(),
    streak_weeks: v.number(),
    last_active_week: v.optional(v.string()), // YYYY-MM-DD (Monday)
    reporter_score: v.number(), // line-check reliability, starts at 1.0
    featured_badge_id: v.optional(v.string()),
    clerk_updated_at: v.optional(v.number()), // last webhook applied; older events are ignored
    created_at: v.number(),
    last_active_at: v.number(),
    deleted_at: v.optional(v.number()),
  })
    .index("by_token", ["token_identifier"])
    .index("by_clerk_id", ["clerk_user_id"])
    .index("by_username", ["username"])
    .index("by_referral_code", ["referral_code"])
    .index("by_referred_by", ["referred_by"])
    .index("by_school", ["school"])
    .index("by_neighborhood", ["home_neighborhood"]),

  saved_locations: defineTable({
    user_id: v.id("users"),
    label: v.string(), // "Home", "Campus", "Current location"
    lat: v.number(),
    lng: v.number(),
    neighborhood: v.optional(v.string()),
    city: v.optional(v.string()),
    region: v.optional(v.string()),
    timezone: v.string(),
    radius_miles: v.number(), // Figma slider, default 1
    notify: v.boolean(),
    is_primary: v.boolean(), // the one the feed and the Alerts slider use
    scan_area_key: v.string(), // which area the 24/7 scans cover for it (its scan_areas.key)
    scan_area_id: v.optional(v.id("scan_areas")),
    created_at: v.number(),
  })
    .index("by_user", ["user_id"])
    .index("by_area", ["scan_area_key"]),

  // ---------------------------------------------------------------- scan areas and their shop lists

  // A circle the agents cover. Saved locations inside one share it (areas.ts assignArea); its shop list is
  // area_stores, refreshed from Google Maps every DISCOVERY_TTL by /discover/shops.
  scan_areas: defineTable({
    key: v.string(), // areaKey() of the location that created it ("westwood|los angeles|california"), "#2"... on a clash
    name: v.string(),
    lat: v.number(),
    lng: v.number(),
    radius_miles: v.number(),
    neighborhood: v.optional(v.string()),
    city: v.optional(v.string()),
    region: v.optional(v.string()),
    timezone: v.string(),
    categories: v.array(v.string()), // the API's Category values; default food and drink
    search_terms: v.optional(v.array(v.string())), // Google Maps searches, overriding categories
    enabled: v.boolean(),
    store_count: v.number(),
    discovered_radius_miles: v.optional(v.number()), // radius at the last discovery; a bigger circle needs a new one
    last_discovered_at: v.optional(v.number()),
    created_at: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_enabled_and_last_discovered_at", ["enabled", "last_discovered_at"]),

  area_stores: defineTable({
    area_id: v.id("scan_areas"),
    store_id: v.id("stores"),
    distance_m: v.optional(v.number()), // from the area's center
    via: v.union(v.literal("maps"), v.literal("scan")), // maps: discovery; scan: a deal scan found it (e.g. @mentioned)
    first_seen_at: v.number(),
    last_seen_at: v.number(), // maps rows not seen in the latest discovery dropped off Google Maps
  })
    .index("by_area_and_store", ["area_id", "store_id"])
    .index("by_store", ["store_id"])
    .index("by_area_and_last_seen_at", ["area_id", "last_seen_at"]),

  category_follows: defineTable({ user_id: v.id("users"), store_type: v.string() })
    .index("by_user_type", ["user_id", "store_type"])
    .index("by_type", ["store_type"]),

  deal_type_follows: defineTable({ user_id: v.id("users"), deal_type: dealType })
    .index("by_user_type", ["user_id", "deal_type"])
    .index("by_type", ["deal_type"]),

  store_follows: defineTable({ user_id: v.id("users"), store_id: v.id("stores"), created_at: v.number() })
    .index("by_user_store", ["user_id", "store_id"])
    .index("by_store", ["store_id"]),

  devices: defineTable({
    user_id: v.id("users"),
    platform: v.union(v.literal("ios"), v.literal("android"), v.literal("web")),
    push_token: v.string(), // Expo push token; Expo delivers to APNs and FCM
    last_seen_at: v.number(),
  })
    .index("by_push_token", ["push_token"])
    .index("by_user", ["user_id"]),

  // ---------------------------------------------------------------- stores and what agents find

  stores: defineTable({
    external_id: v.string(), // the API's Shop.id: gmaps:<place_id>, ig:<handle>, tt:<handle>, name:<slug>
    name: v.string(),
    normalized_name: v.string(),
    store_type: v.optional(v.string()), // catalog key (convex/catalog.ts)
    google_category: v.optional(v.string()), // Shop.category as Google Maps wrote it
    instagram_handle: v.optional(v.string()),
    tiktok_handle: v.optional(v.string()),
    facebook_url: v.optional(v.string()),
    website: v.optional(v.string()),
    google_place_id: v.optional(v.string()),
    maps_url: v.optional(v.string()),
    found_via: v.union(v.literal("google_maps"), v.literal("named"), v.literal("mention"), v.literal("deal")),
    address: v.optional(v.string()),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    neighborhood: v.optional(v.string()),
    city: v.optional(v.string()),
    timezone: v.string(),
    scan_area_key: v.optional(v.string()), // the area whose scan found it
    hours: v.optional(v.array(v.object({ day: v.string(), hours: v.string() }))), // Google Maps opening hours
    is_chain: v.boolean(),
    geofence_m: v.number(), // line-check radius, default 75
    upvotes: v.number(),
    downvotes: v.number(),
    last_scanned_at: v.number(),
    created_at: v.number(),
  })
    .index("by_external_id", ["external_id"])
    .index("by_instagram_handle", ["instagram_handle"])
    .index("by_area_name", ["scan_area_key", "normalized_name"])
    .index("by_normalized_name", ["normalized_name"]),

  agent_runs: defineTable({
    provider,
    trigger: v.union(v.literal("schedule"), v.literal("user_search"), v.literal("photo")),
    status: v.union(v.literal("queued"), v.literal("running"), v.literal("done"), v.literal("failed")),
    error: v.optional(v.string()),
    area: v.optional(area),
    scan_area_id: v.optional(v.id("scan_areas")), // discovery runs (apify_maps) set this instead of area
    request: v.optional(v.any()), // the JSON sent to the API (discovery runs)
    queries: v.array(v.string()),
    api_job_id: v.optional(v.string()), // the API's in-memory job (background endpoints)
    poll_attempts: v.number(),
    requested_by: v.optional(v.id("users")),
    search_errors: v.array(v.string()),
    input_tokens: v.number(),
    output_tokens: v.number(),
    web_search_requests: v.number(),
    brightdata_requests: v.number(),
    apify_runs: v.number(),
    deals_found: v.number(),
    started_at: v.number(),
    finished_at: v.optional(v.number()),
  })
    .index("by_status", ["status"])
    .index("by_area", ["area.scan_area_key"])
    .index("by_scan_area", ["scan_area_id"]),

  sources: defineTable({
    store_id: v.optional(v.id("stores")),
    provider,
    kind: sourceKind,
    url: v.string(), // normalizeUrl(); photos: dibs.local/photo/<hash>
    original_url: v.string(), // as the API returned it, for links
    author_handle: v.optional(v.string()),
    title: v.optional(v.string()),
    full_text: v.string(), // caption, snippet or photo transcript (capped at 200k chars)
    posted_at: v.optional(v.string()), // YYYY-MM-DD
    page_age: v.optional(v.string()),
    content_hash: v.string(),
    fetched_at: v.number(),
    first_seen_run_id: v.id("agent_runs"),
  }).index("by_url", ["url"]),

  scan_cache: defineTable({
    key: v.string(), // hash of provider + query + area
    run_id: v.id("agent_runs"),
    expires_at: v.number(),
  }).index("by_key", ["key"]),

  deals: defineTable({
    store_id: v.id("stores"),
    offer: v.string(),
    category: v.string(),
    code: v.optional(v.string()),
    conditions: v.array(v.string()),
    start_date: v.optional(v.string()), // YYYY-MM-DD, store-local
    end_date: v.optional(v.string()),
    start_time: v.optional(v.string()), // HH:MM
    end_time: v.optional(v.string()),
    timezone: v.string(),
    starts_at: v.optional(v.number()), // derived epoch ms, for sorting, "Ends in 2h" and reminders
    ends_at: v.optional(v.number()),
    kind: v.union(v.literal("deal"), v.literal("event")),
    status: dealStatus, // recomputed hourly
    flags: v.array(v.string()),
    confidence,
    dedupe_key: v.string(), // store id + offer + code, the same rule as verify.py
    second_hand: v.boolean(), // true only when every deal_evidence row is second-hand
    source_post_date: v.optional(v.string()), // newest evidence's post date, for staleness
    first_seen_at: v.number(),
    last_verified_at: v.number(),
    primary_source_id: v.id("sources"),
    upvotes: v.number(),
    downvotes: v.number(),
    confirmation_count: v.number(),
    ended_count: v.number(),
    last_confirmed_at: v.optional(v.number()),
    headline: v.optional(v.string()), // map-pin text: "BOGO", "30% off"
    title: v.optional(v.string()), // "BOGO on all milk teas"
    deal_types: v.array(dealType),
    student_only: v.boolean(),
    age_21: v.boolean(),
    recurring_window: v.optional(recurringWindow),
    est_savings_cents: v.optional(v.number()),
    poster_image_url: v.optional(v.string()),
    // Copied from the store so the feed and alert matching don't need a join to filter.
    store_type: v.optional(v.string()),
    scan_area_key: v.optional(v.string()),
    has_coords: v.boolean(),
    geo_indexed: v.boolean(), // currently in the dealGeo index
  })
    .index("by_dedupe_key", ["dedupe_key"])
    .index("by_store", ["store_id"])
    .index("by_status_end_date", ["status", "end_date"])
    .index("by_area_status", ["scan_area_key", "status"]),

  deal_evidence: defineTable({
    evidence_key: v.string(), // the API's Deal.id: hash of source URL + quote + code, stable across runs
    deal_id: v.id("deals"),
    source_id: v.id("sources"),
    verbatim_quote: v.string(),
    source_post_date: v.optional(v.string()),
    second_hand: v.boolean(), // Deal.flags has "second_hand" (else "shop_own_post", or a user photo)
    extracted_run_id: v.id("agent_runs"),
  })
    .index("by_evidence_key", ["evidence_key"])
    .index("by_deal", ["deal_id"])
    .index("by_deal_source", ["deal_id", "source_id"]),

  rejected_extractions: defineTable({
    run_id: v.id("agent_runs"),
    source_id: v.optional(v.id("sources")),
    raw_deal: v.any(), // as Claude returned it
    reason: v.string(),
  }).index("by_run", ["run_id"]),

  // ---------------------------------------------------------------- picture confirmation and credits

  photo_submissions: defineTable({
    user_id: v.optional(v.id("users")), // removed when the user is deleted; the row stays
    store_id: v.optional(v.id("stores")),
    image_id: v.id("_storage"),
    image_sha256: v.string(), // from _storage metadata; blocks re-submitting the same photo
    photo_date: v.string(),
    timezone: v.string(),
    shop_hint: v.optional(v.string()),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    state: v.union(v.literal("processing"), v.literal("done"), v.literal("failed")),
    error: v.optional(v.string()),
    transcript: v.optional(v.string()),
    source_id: v.optional(v.id("sources")),
    result: v.optional(
      v.union(
        v.literal("confirmed"),
        v.literal("expired"),
        v.literal("needs_check"),
        v.literal("no_deal"),
        v.literal("rejected"),
      ),
    ),
    reject_reason: v.optional(v.string()),
    deal_id: v.optional(v.id("deals")), // the deal it created or confirmed
    created_deal: v.boolean(),
    extracted: v.optional(v.any()), // the API's Deal, for the result screen
    created_at: v.number(),
  })
    .index("by_user_created", ["user_id", "created_at"])
    .index("by_sha256", ["image_sha256"])
    .index("by_result", ["result"]),

  deal_confirmations: defineTable({
    deal_id: v.id("deals"),
    user_id: v.optional(v.id("users")),
    kind: v.union(v.literal("photo"), v.literal("still_running"), v.literal("ended")),
    submission_id: v.optional(v.id("photo_submissions")),
    day: v.string(), // YYYY-MM-DD; one per deal, user and day
    created_at: v.number(),
  })
    .index("by_deal_user_day", ["deal_id", "user_id", "day"])
    .index("by_deal", ["deal_id"]),

  credit_ledger: defineTable({
    user_id: v.optional(v.id("users")),
    submission_id: v.optional(v.id("photo_submissions")), // unique on submission entries
    deal_id: v.optional(v.id("deals")),
    amount: v.number(), // whole credits: +500 per verified submission, negative for spends
    type: v.union(v.literal("submission"), v.literal("referral"), v.literal("spend"), v.literal("reversal")),
    status: v.union(v.literal("pending"), v.literal("posted"), v.literal("reversed")),
    reversal_reason: v.optional(v.string()),
    created_at: v.number(),
    posted_at: v.optional(v.number()),
  })
    .index("by_user_created", ["user_id", "created_at"])
    .index("by_submission", ["submission_id"])
    .index("by_deal_status", ["deal_id", "status"])
    .index("by_status_created", ["status", "created_at"]),

  // ---------------------------------------------------------------- community signals

  votes: defineTable({
    user_id: v.id("users"),
    target_type: v.union(v.literal("store"), v.literal("deal")),
    target_id: v.string(),
    value: v.union(v.literal(1), v.literal(-1)),
    created_at: v.number(),
  }).index("by_user_target", ["user_id", "target_type", "target_id"]),

  line_reports: defineTable({
    store_id: v.id("stores"),
    user_id: v.id("users"),
    wait_minutes: v.number(),
    reported_at: v.number(),
    lat: v.number(),
    lng: v.number(),
    in_geofence: v.boolean(), // only reports within stores.geofence_m count
    xp_ledger_id: v.optional(v.id("xp_ledger")),
  })
    .index("by_store_time", ["store_id", "reported_at"])
    .index("by_user_time", ["user_id", "reported_at"]),

  line_estimates: defineTable({
    store_id: v.id("stores"),
    estimate_minutes: v.number(),
    report_count: v.number(),
    computed_at: v.number(),
  }).index("by_store", ["store_id"]),

  // ---------------------------------------------------------------- notifications and reminders

  notifications: defineTable({
    user_id: v.id("users"),
    deal_id: v.id("deals"),
    reason: notificationReason,
    saved_location_id: v.optional(v.id("saved_locations")),
    channel: v.union(v.literal("push"), v.literal("email")),
    title: v.string(),
    body: v.string(),
    sent_at: v.number(),
    opened_at: v.optional(v.number()),
  })
    .index("by_user_sent", ["user_id", "sent_at"])
    .index("by_user_deal_reason", ["user_id", "deal_id", "reason"]),

  reminders: defineTable({
    user_id: v.id("users"),
    deal_id: v.id("deals"),
    remind_at: v.number(),
    reason: reminderReason,
    job_id: v.optional(v.id("_scheduled_functions")),
    sent_at: v.optional(v.number()),
    canceled_at: v.optional(v.number()),
  })
    .index("by_user_deal_reason", ["user_id", "deal_id", "reason"])
    .index("by_user", ["user_id"])
    .index("by_sent_remind", ["sent_at", "remind_at"]),

  // ---------------------------------------------------------------- saves and lists

  saved_deals: defineTable({
    user_id: v.id("users"),
    deal_id: v.id("deals"),
    created_at: v.number(),
    used_at: v.optional(v.number()), // "Used it"
    saved_cents: v.optional(v.number()),
  })
    .index("by_user_deal", ["user_id", "deal_id"])
    .index("by_user_used", ["user_id", "used_at"])
    .index("by_used", ["used_at"]),

  lists: defineTable({
    user_id: v.id("users"),
    name: v.string(),
    icon: v.optional(v.string()),
    created_at: v.number(),
  }).index("by_user", ["user_id"]),

  list_items: defineTable({
    list_id: v.id("lists"),
    store_id: v.optional(v.id("stores")),
    deal_id: v.optional(v.id("deals")),
    added_at: v.number(),
  }).index("by_list", ["list_id"]),

  // ---------------------------------------------------------------- social and gamification

  friendships: defineTable({
    user_id: v.id("users"),
    friend_id: v.id("users"),
    status: v.union(v.literal("pending"), v.literal("accepted")),
    requested_by: v.id("users"),
    created_at: v.number(),
  })
    .index("by_user_friend", ["user_id", "friend_id"])
    .index("by_user_status", ["user_id", "status"]),

  activity: defineTable({
    user_id: v.id("users"),
    type: v.union(v.literal("used_deal"), v.literal("saved_event"), v.literal("earned_badge")),
    deal_id: v.optional(v.id("deals")),
    badge_id: v.optional(v.string()),
    created_at: v.number(),
  }).index("by_user_created", ["user_id", "created_at"]),

  activity_reactions: defineTable({
    activity_id: v.id("activity"),
    user_id: v.id("users"),
    kind: v.union(v.literal("cheer"), v.literal("save")),
  }).index("by_activity_user_kind", ["activity_id", "user_id", "kind"]),

  xp_ledger: defineTable({
    user_id: v.id("users"),
    amount: v.number(),
    reason: v.union(
      v.literal("deal_used"),
      v.literal("submission"),
      v.literal("line_check"),
      v.literal("challenge"),
      v.literal("streak"),
      v.literal("reversal"),
    ),
    ref_id: v.optional(v.string()),
    created_at: v.number(),
  }).index("by_user_reason_time", ["user_id", "reason", "created_at"]),

  user_badges: defineTable({
    user_id: v.id("users"),
    badge_id: v.string(), // definitions live in convex/lib/badges.ts
    earned_at: v.number(),
  }).index("by_user_badge", ["user_id", "badge_id"]),

  challenges: defineTable({
    week_start: v.string(), // YYYY-MM-DD (Monday)
    title: v.string(),
    metric: v.union(v.literal("deals_used"), v.literal("line_checks"), v.literal("submissions")),
    store_type: v.optional(v.string()), // e.g. only boba deals count
    target: v.number(),
    xp_reward: v.number(),
  }).index("by_week", ["week_start"]),

  challenge_progress: defineTable({
    user_id: v.id("users"),
    challenge_id: v.id("challenges"),
    progress: v.number(),
    completed_at: v.optional(v.number()),
  }).index("by_user_challenge", ["user_id", "challenge_id"]),

  leaderboard_snapshots: defineTable({
    scope: v.union(v.literal("neighborhood"), v.literal("school")),
    scope_key: v.string(),
    period_start: v.string(), // YYYY-MM-01; boards reset monthly ("Resets on the 1st" in the app)
    user_id: v.id("users"),
    saved_cents: v.number(),
    rank: v.number(),
    rank_week_ago: v.optional(v.number()), // for "▲ 3 this week"
    week_marked_at: v.number(),
    snapshot_at: v.number(),
  })
    .index("by_board_rank", ["scope", "scope_key", "period_start", "rank"])
    .index("by_board_user", ["scope", "scope_key", "period_start", "user_id"]),

  // ---------------------------------------------------------------- plumbing

  webhook_events: defineTable({ svix_id: v.string(), received_at: v.number() }).index("by_svix_id", ["svix_id"]),
});
