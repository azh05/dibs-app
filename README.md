# Dibs

Short-lived local deals (grand-opening specials, BOGO offers, happy hours, promo codes) found on the public web and in the store, extracted by Claude, and checked with plain Python rules before anyone sees them. Built for college students first: UCLA (Westwood), UC Berkeley and San Francisco.

| Folder | What | Docs |
| --- | --- | --- |
| [`api/`](api/) | FastAPI backend: finds and verifies deals. Claude web search, Bright Data (Google + public Instagram posts), Apify (Google Maps shops + their Instagram, TikTok, Facebook and websites), user photos | [api/README.md](api/README.md) |
| [`app/`](app/) | Expo (React Native) app built from the [Figma design](https://www.figma.com/design/6mfeMN9XPnjwR6dn2DwdsG): onboarding, Deals, Map, Friends, Earn credits, Alerts, Profile | [app/README.md](app/README.md) |
| [`app/convex/`](app/convex/) | Convex backend for the app: Clerk sign-in, storage, the 24/7 scan schedule, photo credits, push alerts, social and leaderboards | [app/convex/README.md](app/convex/README.md); "Backend data model" tab of the Dibs App doc |

## Quick start (API)

```bash
cd api
uv sync
cp .env.example .env        # add ANTHROPIC_API_KEY, BRIGHTDATA_API_KEY, APIFY_TOKEN
uv run --env-file .env uvicorn app.main:app --reload --port 8000
```

Then open http://localhost:8000/docs. Tests: `cd api && uv run pytest -q`.

## Quick start (app)

```bash
cd app
npm install
npx expo start --ios          # opens in Expo Go on the iOS simulator
```

The app uses mock data unless `EXPO_PUBLIC_CONVEX_URL` and `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` are set in `app/.env.local`. Check changes with `npx tsc --noEmit && npx expo lint`; `npm test` runs the Convex backend tests.

## Full stack setup

Convex cloud deployment → API with `DIBS_API_KEY` → a tunnel (or a host) so Convex can reach the API → Clerk (Convex integration, Native API, sign-in methods, webhook) → the app. Step-by-step instructions, including Clerk's test codes and a free check of the Convex-to-API path, are in [app/convex/README.md, "Setup, start to finish"](app/convex/README.md#setup-start-to-finish).

## Deploys and CI

The API runs on Render (https://dibs-app.onrender.com, root directory `api`, health check `/health`). `.github/workflows/ci.yml` runs on every PR and push to `main`: the API tests, then the app's typecheck, lint and Convex tests. On `main` it also runs `npx convex deploy` when `app/convex/` changed, to whichever deployment the `CONVEX_DEPLOY_KEY` secret belongs to (currently the shared dev deployment, so a local `npx convex dev` and CI overwrite each other's functions). Render's Auto-Deploy is set to "After CI Checks Pass" with a build filter on `api/**`, so only API changes restart it (a restart drops running scans). The app itself isn't deployed by CI: run it with Expo Go from Metro.

## How it fits together

```
app (Expo)  ->  Convex (Clerk sign-in, tables, crons)  ->  api/ (FastAPI)  ->  Anthropic, Bright Data, Apify
```

### api/ (built)

Stateless: it fetches, has Claude extract deals as JSON, verifies them, and returns them. Five extract endpoints share one verification layer:

| Endpoint | Finds deals from |
| --- | --- |
| `POST /extract/search` | Claude's own web search |
| `POST /extract/serp` | Google results through Bright Data, with full Instagram captions |
| `POST /extract/instagram` (job) | Named Instagram accounts' recent posts |
| `POST /extract/shops` (job) | Shops found on Google Maps, then their Instagram, TikTok, Facebook and websites, plus a hashtag and TikTok sweep of the area |
| `POST /extract/photo` | A user's photo of an in-store poster or menu |

`POST /discover/shops` (job) finds no deals: it lists every shop within a circle from Google Maps, for each scan area's shop list in Convex.

With an Elastic Serverless project configured, every verified deal is also indexed with Jina embeddings. `POST /search/deals` searches them by meaning in any language, plus distance. `POST /agent/ask` talks to an Elastic Agent Builder agent that answers from that index, and through Elastic Workflows can watch for new deals (with a push alert) or scan an area. See [api/README.md, "Elastic"](api/README.md#elastic-search-agent-and-workflows).

Every deal must cite a source the API actually fetched, with a word-for-word quote. For scraped pages and photos, that quote must also appear in the fetched text. Each deal gets a status (`live`, `needs_check`, `stale`, `expired`) and is marked as the shop's own post or second-hand. Every endpoint returns shop records and deals with stable ids, so Convex upserts them without duplicates. With `DIBS_API_KEY` set, `/extract/*` calls need the `X-Dibs-Key` header; without it the API is open and must stay on 127.0.0.1.

### app/ (built)

Every screen in the Figma file, wired the way its prototype links are:

- **Onboarding**: Welcome (with the cycling store-type list), sign in or create an account, pick interests from 72 store types and 8 deal types, then turn on live alerts.
- **Deals and Map**: the live feed with your interests and deal types as chips, upcoming events, and a map with recency pins. Filters cover sort (best deals, relevance, distance), distance, store type, deal type, match my interests (on by default; picking store or deal types or searching overrides it), open now, community verified and likely expired. The deal and event pages have directions, follow and reminders.
- **Line check**: standing at a store asks how long the line is, and reports from the last hour show on the deal.
- **Friends**: your rank in Westwood and at your school, friends ranked by money saved, and an activity feed.
- **Earn credits**: snap an in-store deal and earn 500 credits once it's verified (the photo is checked by `/extract/photo`).
- **Alerts and Profile**: alert settings, saved deals and lists, savings so far, ranks and the leaderboard.

With the backend keys set, everything is stored in Convex: accounts (Clerk), saves, interests, friends, ranks, credits, line reports. Without them the app runs on mock data that resets on restart.

### Convex (built, `app/convex/`)

- **Users and auth**: Clerk sign-in (Google, Apple, phone, email). Convex checks Clerk's session token on every call, and a signed Clerk webhook keeps users in sync. Students verify a `.edu` address through Clerk's email code.
- **Tables**: scan areas and their shop lists, stores, deals and their sources and evidence, scan runs and a scan cache, photo submissions and a credits ledger, follows, saved deals and lists, reminders, notifications, votes, deal confirmations, line reports, friends, activity, XP and leaderboards.
- **Scan areas**: every saved place joins a scan area, a circle shared by everyone inside it. Each area keeps its shop list (up to the 250 nearest places from Google Maps, through `/discover/shops`), refreshed weekly. An area whose list is still fresh costs nothing when someone new saves a place in it.
- **24/7 agents**: an hourly cron scans every store on each saved area's shop list in rotating batches (`/extract/shops` with known stores), each store as often as its tier says: daily for shops with recent deals or followers, every 3 days for ones that post, weekly for quiet ones. A daily sweep per area covers hashtags and Google, and each area has a daily spend budget. An area without a list yet gets a Google Maps scan (at most every 6 hours), and saving a new place scans its area right away. An hourly cron updates deal status.
- **Credits**: a verified photo of a new, live deal earns 500 credits. They post after 24 hours, or once 2 other people confirm the deal; an "ended" report reverses them. At most 3 a day.
- **Alerts**: Expo push to every device, when a new deal goes live near someone who follows its store type or deal type, or follows the store. Reminders are scheduled functions.

Not built yet from the doc's design: per-area local scan times, the 90-day purge of old deals, and paid placements. The schema and upsert rules are in [api/README.md, "Storing results"](api/README.md#storing-results-convex) and `app/convex/schema.ts`.

API keys live only in `api/.env` (gitignored). Neither the app nor Convex calls Anthropic, Bright Data or Apify directly; Convex calls the API with the shared `DIBS_API_KEY` (header `X-Dibs-Key`).
