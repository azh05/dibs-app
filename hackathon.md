# Hackathon log

* Project: Dibs
* Event: Cal Hacks 13.0
* What it does: Dibs finds short-lived local deals, has Claude extract them as structured JSON, checks them with deterministic rules and alerts nearby users.
* Live app: not deployed (Expo app runs in Expo Go)
* Repo: https://github.com/azh05/dibs-app (private)
* Frontend: not deployed
* Convex deployment: Convex cloud dev deployment via CI (`.github/workflows/ci.yml`); URL not committed
* Components: @convex-dev/geospatial (as dealGeo, locationGeo, areaGeo), @convex-dev/rate-limiter
* Convex features: schema, indexes, queries, mutations, actions, HTTP actions, crons, scheduled functions, file storage, full text search, realtime useQuery, paginated queries
* Auth: Clerk
* AI models: claude-opus-5-5 (deal extraction, in `api/`), jina-embeddings-v5-text-small (Elastic search)
* Started: 2026-10-24T05:44:04Z
* Last updated: 2026-10-25T08:30:00Z

## How we use Convex

- **Live deal feed and Map**: `deals.feed` is a query over the `dealGeo` geospatial component, read with `useQuery` (`app/convex/deals.ts`, `app/src/lib/api.ts`). Deals, Map, Saved, the Alerts inbox, Friends, Profile, Leaderboard and the photo result screen all update live without a refresh.
- **24/7 deal agents**: crons start scans of every saved area, and actions call the extraction API and poll it by rescheduling themselves (`app/convex/crons.ts`, `scans.ts`, `batches.ts`). Mutations upsert the results (`ingest.ts`).
- **Push alerts and reminders**: each new deal schedules a fanout to followers and to nearby users whose saved places are in the `locationGeo` index; reminders are scheduled functions (`app/convex/notify.ts`, `reminders.ts`).
- **Photo deals for credits**: users upload a photo to Convex file storage, then an action has it verified (`app/convex/photos.ts`).
- **Accounts and friends**: Clerk sign-in, an HTTP action that receives Clerk's user webhook, and full text search over people's names (`app/convex/http.ts`, `schema.ts` `search_display_name`, `social.ts`).
- **Shop lists per area**: a geo-indexed `scan_areas` table and an `area_stores` list, read with a paginated query (`app/convex/areas.ts`).

## Log

Dates are UTC.

- 2026-10-24 `fb24e87` Deal extractor API with verification rules (api `extractor.py`, `verify.py`)
- 2026-10-24 `7a6c59a` Bright Data SERP and Instagram pipelines (`brightdata.py`, `bd_pipeline.py`)
- 2026-10-24 `620a115` Photo deal extraction and demo page (`api/app/photo.py`, `api/demo/index.html`)
- 2026-10-24 `e8bd16a` Expo app from the Figma design (`app/src/app/(tabs)/*`)
- 2026-10-24 `ac6c952` Google Maps shops and their channels via Apify (`api/app/apify.py`, `shop_pipeline.py`)
- 2026-10-24 `783e582` Sign-in, filters, line check and profile screens (`app/src/app/*`)
- 2026-10-25 `a7cde4d` Convex backend: users, deals, photos, alerts (`app/convex/schema.ts`, `ingest.ts`, `scans.ts`)
- 2026-10-25 `421d346` App wired to Convex and Clerk (`app/src/lib/backend-store.tsx`, `feed.ts`)
- 2026-10-25 `84b0931` Elastic deal search and Ask dibs agent (`api/app/elastic.py`, `app/src/app/ask.tsx`)
- 2026-10-25 `a0f644b` CI tests and Convex deploy from main (`.github/workflows/ci.yml`)
- 2026-10-25 `7e40989` Shop list per scan area in Convex (`app/convex/areas.ts`)
- 2026-10-25 `e74bef9` Mandatory usernames, find friends (`app/src/app/onboarding/username.tsx`, `convex/social.ts`)
- 2026-10-25 `92d87b9` Batch scan script, photo retry fix (`app/scripts/batch-scan.sh`, `convex/photos.ts`)
- 2026-10-25 `f867885` Rotating batch scans with tiers and budget (`app/convex/batches.ts`)
- 2026-10-25 `3af8339` Saving from search and Ask dibs (`app/convex/deals.ts`, `app/src/lib/api.ts`)
- 2026-10-25 `4dd6a8e` Map measures from its centre (`app/src/app/(tabs)/map.tsx`, `lib/location.ts`)
- 2026-10-25 `02dfc19` Map shows what's on screen; alerts always on (`map.tsx`, `alerts.tsx`)
- 2026-10-25 `5151cd2` Deals filtered by your interests (`app/src/lib/filters.ts`)
- 2026-10-25 Hackathon log (`hackathon.md`, `README.md`)
