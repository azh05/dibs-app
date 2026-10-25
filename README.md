# Dibs

Short-lived local deals (grand-opening specials, BOGO offers, promo codes) found on the public web, extracted by Claude, and checked with plain Python rules before anyone sees them.

| Folder | What | Docs |
| --- | --- | --- |
| [`api/`](api/) | FastAPI backend: finds and verifies deals. Claude web search, Bright Data (Google + public Instagram posts), Apify (Google Maps shops + their Instagram, TikTok, Facebook and websites), user photos | [api/README.md](api/README.md) |
| [`app/`](app/) | Expo (React Native) app built from the Figma design: Deals, Map, Friends, Earn credits, Alerts, deal and event detail | [app/README.md](app/README.md) |
| [`docs/`](docs/) | Team notes: [outside APIs, keys and user sign-in options](docs/apis-and-auth.md) | |
| Convex | Backend for the app: Clerk sign-in and the tables in the "Backend data model" doc. Not in the repo yet | [api/README.md, "Storing results"](api/README.md#storing-results-convex) |

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

The app uses mock data unless `EXPO_PUBLIC_API_URL` is set (e.g. `EXPO_PUBLIC_API_URL=http://localhost:8000 npx expo start`).

## How it fits together

The app's screens are built (from the Figma design); the backend that stores users and deals is next, on Convex.

```
app (Expo)  ->  Convex (Clerk sign-in, tables, scheduled scans)  ->  api/ (FastAPI)  ->  Anthropic, Bright Data, Apify
```

- **app** reads and writes through Convex: the deal feed, saved deals, alerts, photo submissions. It holds no outside API keys.
- **Convex** owns all storage and user auth. Its actions call the extract endpoints (on a schedule for 24/7 scans, or when a user searches or submits a photo) and upsert the results: shops by `Shop.id`, deals by `Deal.id` and the dedupe key. The schema and upsert rules are in [api/README.md, "Storing results"](api/README.md#storing-results-convex).
- **api/** is stateless: it fetches, has Claude extract, verifies, and returns JSON. It has no auth yet, so it stays on 127.0.0.1; once Convex calls it from the cloud it needs a shared key between the two (planned: a `DIBS_API_KEY` header, see [docs/apis-and-auth.md](docs/apis-and-auth.md)).
- Until Convex exists, the app calls the API directly when `EXPO_PUBLIC_API_URL` is set (`/extract/search` for the feed, `/extract/photo` for Earn).

API keys live only in `api/.env` (gitignored). Neither the app nor Convex calls Anthropic, Bright Data or Apify directly.
