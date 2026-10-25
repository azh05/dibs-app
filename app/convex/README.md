# Convex backend

The app's backend: users (Clerk sign-in), saved places and interests, the stores and deals the agents find, photo confirmations with credits, community signals, push alerts and gamification. It implements the "Backend data model" doc. The schema is `schema.ts`; field names follow what the API returns (snake_case).

```
app (Expo)  ->  Convex (this folder)  ->  api/ (FastAPI)  ->  Anthropic, Bright Data, Apify
```

The app talks only to Convex. Convex actions call the Dibs API server to server with a shared key. Neither the app nor Convex holds Anthropic, Bright Data or Apify keys.

## Setup, start to finish

Five parts: Convex, the API, a tunnel between them, Clerk, then the app. About 20 minutes the first time.

### 1. Convex cloud deployment

```bash
cd app
npm install
npx convex login
npx convex dev --configure existing --team <team> --project <project> --dev-deployment cloud --once
```

The first `npx convex dev` asks you to create a project (or use the command above for an existing one). It writes `CONVEX_DEPLOYMENT`, `EXPO_PUBLIC_CONVEX_URL` and `EXPO_PUBLIC_CONVEX_SITE_URL` to `app/.env.local`. The first deploy fails with "CLERK_JWT_ISSUER_DOMAIN not set" until step 4.

If `npx convex login` offers to link an existing anonymous deployment, that one is local (`127.0.0.1:3210`) and a phone can't reach it. Run the `--dev-deployment cloud` command above afterwards.

No Convex account? `CONVEX_AGENT_MODE=anonymous npx convex dev` runs a local backend. It can call an API on the same machine (`DIBS_API_URL=http://127.0.0.1:8000`) with no tunnel, which is handy for testing scans.

### 2. The API, with a shared key

```bash
cd api
printf '\nDIBS_API_KEY=%s\n' "$(openssl rand -hex 24)" >> .env     # once
uv run --env-file .env uvicorn app.main:app --port 8001
```

With `DIBS_API_KEY` set, every `/extract/*` call needs the header `X-Dibs-Key`. Convex sends it. Give Convex the same value:

```bash
cd app
npx convex env set DIBS_API_KEY "$(grep '^DIBS_API_KEY=' ../api/.env | cut -d= -f2-)"
```

### 3. A tunnel so Convex can reach the API

Convex runs in the cloud, so the API needs a public URL. During development, run in its own terminal and leave it open:

```bash
ngrok http 8001            # or: cloudflared tunnel --url http://localhost:8001
npx convex env set DIBS_API_URL https://<id>.ngrok-free.app
```

Free ngrok URLs change each time ngrok restarts; set `DIBS_API_URL` again when that happens.

To check the path without spending credits, send a deliberately invalid request. The run should fail with HTTP 422, which means Convex reached the API and the key was accepted:

```bash
npx convex run scans:startShops '{"area":{"scan_area_key":"wiring-check","neighborhood":"Westwood"},"trigger":"schedule","force":true,"request":{"max_shops":0}}'
npx convex data agent_runs --limit 1 --order desc
```

For scans that run 24/7, the API needs a long-running host (Render, Railway, Fly). Serverless platforms won't work: scan jobs run 1 to 5 minutes in background threads and live in the server's memory.

### 4. Clerk

In the Clerk dashboard for your application:

1. **Configure → Integrations → Convex**: turn it on. This adds `aud: "convex"` to session tokens, so no JWT template is needed. Copy the Frontend API URL (shown there, e.g. `https://verb-noun-00.clerk.accounts.dev`) and run `npx convex env set CLERK_JWT_ISSUER_DOMAIN <url>`.
2. **Native applications**: turn on the Native API. Sign-in from the app fails without it.
3. **User & authentication**: turn on email (password plus email verification code), phone (SMS code), Google and Apple. Recommended requirements:
   - **Username off.** Dibs stores usernames in Convex.
   - **Email on, but not required**, so phone-only accounts work.
   - **Password not required for every account.**

   Stricter settings still work. The app shows a "finish your account" step (`src/app/onboarding/finish.tsx`) for whatever Clerk still requires, then sends a code to any new email. Clerk also sets the minimum password length (15 on new apps); its message appears under the field.
4. **Webhooks → Add endpoint**:
   - URL: `https://<deployment>.convex.site/clerk-users-webhook`. Note `.site`, not `.cloud`.
   - Events: `user.created`, `user.updated`, `user.deleted`.
   - Copy the endpoint's **Signing Secret** (`whsec_...`) and run `npx convex env set CLERK_WEBHOOK_SECRET whsec_...`.
   - The endpoint's **Testing** tab can send a sample event to check it.
5. Admins (who review "In review" photo submissions): set `{"role": "admin"}` in the user's public metadata.

The session token and the webhook do different jobs. Convex checks each call's Clerk session token with Clerk's public keys, found through `CLERK_JWT_ISSUER_DOMAIN`, so no secret is involved. The webhook is Clerk calling Convex: it keeps email, phone and role in sync, fills in a username the user doesn't have yet (never one someone else has, and never over one picked in the app), marks a user as a verified student once a `.edu` address on their Clerk account is verified, grants referral credits once a referred user verifies, and cleans up on deletion. `user.deleted` removes saved places, follows, devices, notifications and reminders; photo submissions and the credit ledger stay, with the user link removed. The signing secret proves each webhook call came from Clerk.

Testing without real messages: Clerk development apps accept emails containing `+clerk_test` (e.g. `you+clerk_test@gmail.com`) and phone numbers like `+1 201-555-0100`. The code is always `424242`.

### 5. The app

`app/.env.local` needs both:

```bash
EXPO_PUBLIC_CONVEX_URL=https://<deployment>.convex.cloud        # written by `npx convex dev`
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...                   # Clerk dashboard → API keys
```

Without both, the app runs in mock mode (`src/lib/mock.ts`). Expo reads env vars when Metro starts, so after changing `.env.local`, restart Metro with `npx expo start --clear`.

```bash
npx expo start --ios
xcrun simctl location booted set 34.0628,-118.4455     # put the simulator in Westwood
```

Sign up, pick interests, then tap **Turn on live alerts**. That saves your location and starts the first scan of the area, which costs real money: about $0.30 to $1.20 of Apify for 8 shops, plus Claude tokens. Deals appear on their own 1 to 5 minutes later. To watch:

- In the Convex dashboard, check `users`, then `agent_runs` going `running` to `done`, then `stores` and `deals`.
- In Clerk → Webhooks, the `user.created` delivery should show as succeeded.

Phone and social sign-ups skip Create account, so they have no birthday. **Verify 21+** asks for one the first time (`src/lib/age-gate.ts`).

### Push

**Not set up yet:** `app.json` has no EAS `projectId`, so the app gets no Expo push token and no device registers. Alerts still show in the Alerts tab, but nothing reaches the lock screen. To set it up (someone logged in to Expo):

1. `cd app && npx eas-cli@latest init`, choosing an Expo organization the team shares. It writes `owner` and `extra.eas.projectId` to `app.json`; commit that.
2. Android: remote push needs a development build and FCM V1 credentials (Firebase service account key, uploaded with `npx eas-cli@latest credentials`). iOS: a development build needs a paid Apple Developer account; let EAS create the APNs key when it asks.
3. On a real phone, sign in and allow notifications, then check the `devices` table in the Convex dashboard for a row.

The app registers its token (`prefs.registerDevice`) after sign-in and again once onboarding gets notification permission. Alerts are always on (there is no Instant toggle). Convex sends alerts and reminders through Expo's push service, 100 per request, and drops tokens Expo reports as `DeviceNotRegistered`.

## Environment (Convex dashboard, or `npx convex env set NAME value`)

| Variable | What |
| --- | --- |
| `CLERK_JWT_ISSUER_DOMAIN` | Clerk's Frontend API URL (`auth.config.ts`) |
| `CLERK_WEBHOOK_SECRET` | Signing secret of the Clerk webhook (`whsec_...`) |
| `DIBS_API_URL` | Where Convex reaches the Dibs API: a deployed URL, or the tunnel URL |
| `DIBS_API_KEY` | Same value as the API's `DIBS_API_KEY`; sent as `X-Dibs-Key` |
| `EXPO_ACCESS_TOKEN` | Optional: only if Expo enhanced push security is on |
| `DIBS_SCAN_MAX_SHOPS` | Optional: shops per area scan (an area with no shop list yet; default 8; Apify cost grows with it) |
| `DIBS_SCAN_BATCH` | Optional: stores per batch scan (default 20; each Apify channel run has to finish within 4 minutes) |
| `DIBS_AREA_DAILY_BUDGET_USD` | Optional: estimated deal-scan spend per area per local day before batches and sweeps stop (default 5; `scan_areas.daily_budget_usd` overrides it per area) |
| `DIBS_COST_APIFY_PER_SHOP`, `DIBS_COST_BRIGHTDATA_PER_REQUEST`, `DIBS_COST_INPUT_PER_MTOK`, `DIBS_COST_OUTPUT_PER_MTOK`, `DIBS_COST_WEB_SEARCH` | Optional: the prices behind `agent_runs.cost_usd` (`lib/cost.ts`; defaults $0.035, $0.0015, $4, $20, $0.01) |
| `DIBS_DISCOVER_MAX_SHOPS` | Optional: shops kept per area by `/discover/shops` (default 250; Google Maps is billed per place) |

Tests need none of these: `npm test` runs the convex-test suite with no keys and no network.

## How data flows

- **Scan areas** (`areas.ts`): a saved place joins an enabled area whose circle covers it. Otherwise it widens an area centred within 0.5 mi (up to 5 mi), or it starts a new area centred on it (at least 1 mi). The place's `scan_area_key` becomes the area's `key`, so everyone in the circle shares one key.
  - **Shop list**: `/discover/shops` returns up to 250 shops in the circle from Google Maps. Their stores are upserted (`last_scanned_at` untouched; new stores start at 0, meaning never deal-scanned) and linked in `area_stores` (`via: "maps"`). Stores a deal scan finds inside the circle, or with no coordinates (handle only), are linked too (`via: "scan"`).
  - **Freshness**: a list is fresh for 7 days (`DISCOVERY_TTL`), or until the circle grows. `claimDiscovery` checks freshness and in-flight runs in one transaction, so a fresh area makes no API call, and neither does a new user inside one.
  - **When**: a new or widened area is discovered right away (3 per user per day, `areaDiscovery`); the 6-hourly cron catches up on the rest, 2 areas per tick. Discovery runs carry `scan_area_id` and no `area`, so they don't count as deal scans.
  - **Beyond food and drink**: once a week each area on the default categories also gets a smaller discovery of retail, beauty, fitness and entertainment shops (`EXTRA_CATEGORIES`, 20 Maps results per search term), using the cron's spare slots. It adds to the list without changing `store_count` or `last_discovered_at` (`scan_areas.extra_discovered_at` is its clock).
- **Batch scans** (`batches.ts`): an area with a shop list is scanned store by store.
  - Every hour, `claimBatch` takes the area's 20 most overdue stores with something to scrape (an Instagram, TikTok or Facebook account, or a website). A store is due when `next_scan_at` is unset or past. The never-scheduled go first, then hot before warm before cold.
  - Up to 5 Maps stores with nothing to scrape ride along once a week, so the API's Google lookup can find their accounts. Any Maps store missing an Instagram, TikTok or Facebook is sent with `lookup: true` at most once a week (`accounts_checked_at`). A store that gains its first account is scanned on the next tick.
  - Claiming sets `next_scan_at` an hour ahead (a lease) in the same transaction, so ticks never overlap. The batch is one `/extract/shops` job with `stores` (no Google Maps search), and each store's `since` is the day of its last scan, so only newer posts are read.
  - `finishBatch` reads the response's `scanned` and sets `last_post_at`, `last_deal_at`, `quiet_scans`, `scan_tier` and `next_scan_at`, using `lib/tiers.ts`:
    - **hot**, every 24 h: a deal in the last 30 days, a follower, or a food or drink store in its first week
    - **warm**, every 3 days: posts weekly, or nothing says it has gone quiet
    - **cold**, every 7 days: two quiet batches in a row, no post in 30 days, a non-food store in its first week, or nothing to scrape

    A store a failed run never reported keeps its lease and comes back within the hour.
  - Once a day (10 AM in LA), `scheduleSweeps` sends each area a `sweep_only` job: the keyword sweep and Google's deal search, with the area's accounts so their posts count as first-hand. It doesn't move the stores' scan clocks (`last_scanned_at`); shops its deals name join the list.
  - **Budget**: each run's `cost_usd` is estimated in `lib/cost.ts`. Batches and sweeps stop for the day once an area's runs since local midnight add up to its budget (`DIBS_AREA_DAILY_BUDGET_USD`, default $5, or `scan_areas.daily_budget_usd`).
  - **Lost jobs**: when the API restarts, it loses its jobs, and a poll gets a 404. A batch or sweep is then re-sent once from `agent_runs.request` (`retried`).
- **Area scans** (`scans.ts`, `crons.ts`): every hour, up to 3 saved areas with no shop list yet, not scanned in the last 6 hours, get a Google Maps `/extract/shops` job over the area's own circle. The API runs it in the background (1 to 5 min). `pollShops` checks it, and batch and sweep jobs, every 15 s by rescheduling itself, because actions aren't retried. It gives up after 10 minutes (30 for discovery jobs). Saving a new place scans its area right away, before its list exists.
- **Ingest** (`ingest.ts`): the result is written in batches.
  - Stores are matched by `Shop.id`, then Instagram handle, then name within the scanned area. Two Google Maps places never merge (chain branches share a name and handle), so handle and name only join a Maps place to a store known some other way.
  - Sources are matched by normalized URL. Only the ones a deal cites are kept.
  - Deals are matched by `Deal.id` (the evidence key, one post), then by store + offer + code (the same offer in several posts).
  - Re-running a scan changes nothing but `last_verified_at`. A brand-new active deal triggers alerts.
- **Feed** (`deals.ts`): the geospatial index `dealGeo` holds active deals (`live`, `needs_check`, `upcoming`) at their store's coordinates. Deals whose store has no coordinates are listed for the area they were scanned in. 21+ deals are hidden until the 21+ check passes.
- **Status** (`lib/status.ts`): `verify.py`'s rules, recomputed hourly. `upcoming` means it starts in the future. `hidden` means 3 or more "ended" reports.
- **Photos and credits** (`photos.ts`, `lib/credits.ts`): upload, then `/extract/photo`, then `finalize`.
  - Only a confirmed (live, not low-confidence) photo that created a new deal earns 500 credits, at most 3 times a day.
  - Credits start pending. They post after 24 hours, or as soon as 2 other users confirm the deal. An "ended" report before then reverses them.
  - A photo of a deal we already know counts as a confirmation instead.
  - The same image can't be submitted twice (sha256 from storage metadata).
- **Alerts** (`notify.ts`): store followers, plus users with a saved place in range whose store type or deal-type picks match. One notification per user, deal and reason.
- **Gamification** (`lib/gamify.ts`):
  - XP: deal used 50, verified photo 100, line check 10 (5 a day).
  - Streaks in weeks, 24 badges, one weekly challenge.
  - Monthly leaderboards for neighbourhood and school (rebuilt hourly) and friends (live).

## Crons

| Job | When |
| --- | --- |
| `scans.scheduleAreas` | hourly (areas with no shop list yet) |
| `batches.scheduleBatches` | hourly |
| `batches.scheduleSweeps` | daily, 17:00 UTC |
| `areas.scheduleDiscovery` | every 6 hours |
| `deals.recomputeStatus` | hourly |
| `leaderboards.rebuild` | hourly |
| `credits.settleDue` | daily (safety net for missed settle jobs) |
| `challenges.rollover` | Mondays |

## Handy commands

```bash
# Scan an area now (spends Apify credits through the API)
npx convex run scans:startShops '{"area":{"scan_area_key":"westwood|los angeles|california","neighborhood":"Westwood","city":"Los Angeles","region":"California"},"trigger":"schedule","force":true}'
npx convex data agent_runs --limit 5
npx convex run deals:recomputeStatus

# Scan areas: assign areas to places saved before they existed (once per deployment), list them, refresh one
# area's shop list now (spends Apify credits), and page through a list
npx convex run areas:backfill
npx convex data scan_areas
npx convex run areas:startDiscovery '{"areaId":"<scan_areas _id>","force":true}'
npx convex run areas:storesInArea '{"areaId":"<scan_areas _id>","paginationOpts":{"numItems":20,"cursor":null}}'

# Batch scans: the area's next batch now (spends Apify credits), and its sweep for today
npx convex run batches:startBatch '{"areaId":"<scan_areas _id>"}'
npx convex run batches:claimSweep '{"areaId":"<scan_areas _id>"}'   # then: batches:send '{"runId":"<returned id>"}'
```

## Filling areas with deals (`scripts/batch-scan.sh`)

Run from `app/` on a machine logged in to the deployment. Each scan covers up to 25 shops through `scans:startShops` (Apify, plus Bright Data's Google lookups when the API has its key), takes 1 to 5 minutes, and costs about $0.05 a shop. Scans start 6 minutes apart (`GAP=<seconds>` to change) so they don't queue on Apify's 16 GB memory cap past the 10-minute polling limit. `scripts/batch-scan.sh --help` prints this.

| Command | Scans | Cost, time |
| --- | --- | --- |
| `scripts/batch-scan.sh '<area JSON>' ...` | 4 scans by search term (drinks, fast food, restaurants, non-food), about 95 shops | ~$5, ~20 min per area |
| `scripts/batch-scan.sh --all <area id> ...` | every shop discovery stored for the area (up to 250), 25 per scan | ~$12, ~1 h per 250 shops |
| `scripts/batch-scan.sh --place "Mission District, San Francisco, California" ...` | the same 4 scans for a place with no scan area yet | ~$5, ~20 min per place |

- Area JSON and ids: `npx convex data scan_areas` (the JSON fields are `scan_area_key`, `neighborhood`, `city`, `region`, `timezone`, `lat`, `lng`, `radius_miles`).
- `--all` needs the area's discovery to have finished; it says so when the list is empty.
- `--place` takes `"Neighborhood, City, State[, Timezone]"` (timezone defaults to `America/Los_Angeles`). Its deals appear in the app for anyone whose location or saved place is nearby; saving a place there also makes it a scan area for the regular schedule.
- Progress: `npx convex data agent_runs --limit 10 --order desc`.

## Layout

```
schema.ts        every table and index
catalog.ts       store types and deal types, shared with the app; Google Maps category → store type
users.ts         users.store, profile, 21+ check, Clerk webhook mutations
http.ts          POST /clerk-users-webhook (Svix-verified)
ingest.ts        writes an API response: stores, sources, deals, evidence, rejected
areas.ts         scan areas (circles saved places share), their shop lists, /discover/shops jobs (cron)
batches.ts       rotating store batches and daily area sweeps over each list (cron), tiers, daily budget
scans.ts         area /extract/shops jobs (cron), /extract/search (user, rate-limited), scan cache, job polling
deals.ts         feed, deal detail, store deals, status recompute
prefs.ts         saved places, interests, store follows, push devices
saves.ts         saved deals, Used it, lists
reminders.ts     scheduled reminders (cancelled when turned off)
photos.ts        photo upload, /extract/photo, result, admin review
credits.ts       settle, history
community.ts     votes, Still running? / Ended
lineChecks.ts    line reports, blended estimates
notify.ts        alert fanout, Expo push, inbox
social.ts        friends, friends feed, cheers
leaderboards.ts  monthly boards
challenges.ts    weekly challenge
profile.ts       $ saved, Deal DNA, badges, invites
crons.ts         schedules
lib/             auth, API client, geo, status, time, text matching (ports of verify.py / linking.py), gamify,
                 scan tiers, run cost estimate
*.test.ts        convex-test suites
```
