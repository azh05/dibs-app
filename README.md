# Dibs

Short-lived local deals (grand-opening specials, BOGO offers, happy hours, promo codes) found on the public web and in the store, extracted by Claude, and checked with plain Python rules before anyone sees them. Built for college students first: UCLA (Westwood), UC Berkeley and San Francisco.

| Folder | What | Docs |
| --- | --- | --- |
| [`api/`](api/) | FastAPI backend: finds and verifies deals. Claude web search, Bright Data (Google + public Instagram posts), Apify (Google Maps shops + their Instagram, TikTok, Facebook and websites), user photos | [api/README.md](api/README.md) |
| [`app/`](app/) | Expo (React Native) app built from the [Figma design](https://www.figma.com/design/6mfeMN9XPnjwR6dn2DwdsG): onboarding, Deals, Map, Friends, Earn credits, Alerts, Profile | [app/README.md](app/README.md) |
| Convex | Backend for the app: Clerk sign-in, storage and the 24/7 scan schedule. Not in the repo yet | "Backend data model" tab of the Dibs App doc; [api/README.md, "Storing results"](api/README.md#storing-results-convex) |

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

The app uses mock data unless `EXPO_PUBLIC_API_URL` is set (e.g. `EXPO_PUBLIC_API_URL=http://localhost:8000 npx expo start`). Check changes with `npx tsc --noEmit && npx expo lint`.

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

With an Elastic Serverless project configured, every verified deal is also indexed with Jina embeddings. `POST /search/deals` searches them by meaning in any language, plus distance. `POST /agent/ask` talks to an Elastic Agent Builder agent that answers from that index, and through Elastic Workflows can watch for new deals (with a push alert) or scan an area. See [api/README.md, "Elastic"](api/README.md#elastic-search-agent-and-workflows).

Every deal must cite a source the API actually fetched, with a word-for-word quote. For scraped pages and photos, that quote must also appear in the fetched text. Each deal gets a status (`live`, `needs_check`, `stale`, `expired`) and is marked as the shop's own post or second-hand. `/extract/shops` also returns shop records with stable ids, so a database can upsert shops and deals without duplicates. The API's only auth is an optional shared key (`DIBS_API_KEY`), so without it the API stays on 127.0.0.1.

### app/ (built, mock data)

Every screen in the Figma file, wired the way its prototype links are:

- **Onboarding**: Welcome (with the cycling store-type list), sign in or create an account, pick interests from 72 store types and 8 deal types, then turn on live alerts.
- **Deals and Map**: the live feed with your interests and deal types as chips, upcoming events, and a map with recency pins. Filters cover sort (best deals, relevance, distance), distance, store type, deal type, open now, community verified and likely expired. The deal and event pages have directions, follow and reminders.
- **Line check**: standing at a store asks how long the line is, and reports from the last hour show on the deal.
- **Friends**: your rank in Westwood and at your school, friends ranked by money saved, and an activity feed.
- **Earn credits**: snap an in-store deal and earn 500 credits once it's verified (the photo is checked by `/extract/photo`).
- **Alerts and Profile**: alert settings, saved deals and lists, savings so far, ranks and the leaderboard.

Real local notifications and the line check run on the device. Accounts, saves, friends and leaderboards are mock data and reset on restart until Convex exists.

### Convex (planned)

- **Users and auth**: Clerk sign-in (Google, Apple, phone). Students also verify a `.edu` address.
- **Tables**: stores, deals and their sources, scan runs and areas, photo submissions and a credits ledger, follows, saved deals, reminders, notifications, votes, line reports, and social tables. Paid placements sit in their own table that the organic feed never reads.
- **24/7 agents**: an hourly cron starts each scan area at its local run times (daily food and drink at 10:00 and 16:00, plus a weekly refresh), calls `/extract/shops`, and upserts the result. Hourly and daily crons update deal status and purge old deals.
- **Alerts**: alerts go out through Expo push, only when a new deal goes live near someone who follows that store type or store.

The schema the API writes and its upsert rules are in [api/README.md, "Storing results"](api/README.md#storing-results-convex). Until Convex exists, the app calls the API directly when `EXPO_PUBLIC_API_URL` is set (`/extract/search` for the feed, `/extract/photo` for Earn).

API keys live only in `api/.env` (gitignored). Neither the app nor Convex calls Anthropic, Bright Data or Apify directly. Once Convex calls the API from the cloud, the two share a key (planned: a `DIBS_API_KEY` header; the "APIs & auth" tab of the Dibs App doc covers every outside API and sign-in option).
