# Convex backend

The app's backend: users (Clerk sign-in), saved places and interests, the stores and deals the agents find, photo confirmations with credits, community signals, push alerts and gamification. It implements the "Backend data model" doc. The schema is `schema.ts`; field names follow what the API returns (snake_case).

```
app (Expo)  ->  Convex (this folder)  ->  api/ (FastAPI)  ->  Anthropic, Bright Data, Apify
```

The app talks only to Convex. Convex actions call the Dibs API server to server with a shared key. Neither the app nor Convex holds Anthropic, Bright Data or Apify keys.

## Run it

```bash
cd app
npm install
npx convex dev            # first run: log in and create a project; writes EXPO_PUBLIC_CONVEX_URL to .env.local
npm test                  # convex-test suite (no keys, no network)
```

No Convex account yet? `CONVEX_AGENT_MODE=anonymous npx convex dev` runs a local backend at `http://127.0.0.1:3210`. It can call an API running on the same machine (`DIBS_API_URL=http://127.0.0.1:8000`).

Then start the app with both keys in `app/.env.local`:

```bash
EXPO_PUBLIC_CONVEX_URL=https://<deployment>.convex.cloud        # written by `npx convex dev`
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...                   # Clerk dashboard → API keys
```

Without both, the app runs in mock mode (`src/lib/mock.ts`).

## Environment (Convex dashboard, or `npx convex env set NAME value`)

| Variable | What |
| --- | --- |
| `CLERK_JWT_ISSUER_DOMAIN` | Clerk's Frontend API URL, e.g. `https://verb-noun-00.clerk.accounts.dev` (`auth.config.ts`) |
| `CLERK_WEBHOOK_SECRET` | Signing secret of the Clerk webhook below (`whsec_...`) |
| `DIBS_API_URL` | Where the Dibs API is reachable from Convex: deployed, or a tunnel to `127.0.0.1:8000` (cloudflared, ngrok) |
| `DIBS_API_KEY` | Same value as the API's `DIBS_API_KEY`; sent as `X-Dibs-Key` |
| `EXPO_ACCESS_TOKEN` | Optional: only if Expo enhanced push security is on |
| `DIBS_SCAN_MAX_SHOPS` | Optional: shops per scheduled `/extract/shops` run (default 8; Apify cost grows with it) |

## Clerk setup

1. Create a Clerk application. Under **User & authentication**, turn on email (with password and email verification code), phone (SMS code), Google and Apple.
2. **Configure → Integrations → Convex**: activate it. This adds `aud: "convex"` to session tokens, so no JWT template is needed. Copy the Frontend API URL into `CLERK_JWT_ISSUER_DOMAIN`.
3. **Native applications**: turn on the Native API. Allow the app's redirect URL (`dibs://` in builds; the `exp://` URL Expo Go prints during development).
4. **Webhooks → Add endpoint**: `https://<deployment>.convex.site/clerk-users-webhook` (note `.site`), events `user.created`, `user.updated`, `user.deleted`. Copy the signing secret into `CLERK_WEBHOOK_SECRET`.
5. Admins (who review "In review" photo submissions): set `{"role": "admin"}` in the user's public metadata.

The webhook keeps email, phone, username and role in sync. It also marks a user as a verified student when a `.edu` address on their Clerk account is verified, and it grants referral credits once a referred user verifies. `user.deleted` removes saved places, follows, devices, notifications and reminders; photo submissions and the credit ledger stay, with the user link removed.

## Push

Run `npx eas-cli@latest init` once, so `app.json` gets an EAS `projectId`; the app needs it for an Expo push token. Android needs a development build for remote push. After sign-in the app registers its token (`prefs.registerDevice`). Convex then sends alerts and reminders through Expo's push service, 100 per request, and drops tokens Expo reports as `DeviceNotRegistered`.

## How data flows

- **Scans** (`scans.ts`, `crons.ts`): every hour, up to 3 areas that people have saved and that weren't scanned in the last 6 hours get a `/extract/shops` job. The API runs it in the background (1 to 5 min). `pollShops` checks it every 15 s by rescheduling itself, because actions aren't retried, and gives up after 10 minutes. Saving a new place scans its area right away.
- **Ingest** (`ingest.ts`): the result is written in batches.
  - Stores are matched by `Shop.id`, then Instagram handle, then name within the scanned area.
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
- **Alerts** (`notify.ts`): store followers, plus users with a saved place in range whose store type or deal-type picks match, and Instant alerts on. One notification per user, deal and reason.
- **Gamification** (`lib/gamify.ts`):
  - XP: deal used 50, verified photo 100, line check 10 (5 a day).
  - Streaks in weeks, 24 badges, one weekly challenge.
  - Monthly leaderboards for neighbourhood and school (rebuilt hourly) and friends (live).

## Crons

| Job | When |
| --- | --- |
| `scans.scheduleAreas` | hourly |
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
```

## Layout

```
schema.ts        every table and index
catalog.ts       store types and deal types, shared with the app; Google Maps category → store type
users.ts         users.store, profile, 21+ check, Clerk webhook mutations
http.ts          POST /clerk-users-webhook (Svix-verified)
ingest.ts        writes an API response: stores, sources, deals, evidence, rejected
scans.ts         /extract/shops jobs (cron), /extract/search (user, rate-limited), scan cache
deals.ts         feed, deal detail, store deals, status recompute
prefs.ts         saved places, interests, Instant alerts, store follows, push devices
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
lib/             auth, API client, geo, status, time, text matching (ports of verify.py / linking.py), gamify
*.test.ts        convex-test suites
```
