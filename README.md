# Dibs

Short-lived local deals (grand-opening specials, BOGO offers, promo codes) found on the public web, extracted by Claude, and checked with plain Python rules before anyone sees them.

| Folder | What | Docs |
| --- | --- | --- |
| [`api/`](api/) | FastAPI backend: finds and verifies deals. Claude web search, Bright Data (Google + public Instagram posts), Apify (Google Maps shops + their Instagram, TikTok, Facebook and websites), user photos | [api/README.md](api/README.md) |
| [`app/`](app/) | Expo (React Native) app built from the Figma design: Deals, Map, Earn $5, Alerts, deal and event detail | [app/README.md](app/README.md) |
| [`docs/`](docs/) | Team notes: [outside APIs, keys and user sign-in options](docs/apis-and-auth.md) | |
| [`app/convex/`](app/convex/) | Convex backend for the app: Clerk sign-in, the tables in the "Backend data model" doc, 24/7 scans, photo credits, push alerts, gamification | [app/convex/README.md](app/convex/README.md) |

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

The app uses mock data unless `EXPO_PUBLIC_CONVEX_URL` and `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` are set in `app/.env.local` (see [app/convex/README.md](app/convex/README.md) for the Convex and Clerk setup).

## How it fits together

The app's screens are built from the Figma design; users and deals live in Convex.

```
app (Expo)  ->  Convex (Clerk sign-in, tables, scheduled scans)  ->  api/ (FastAPI)  ->  Anthropic, Bright Data, Apify
```

- **app** reads and writes through Convex: the deal feed, saved deals, alerts, photo submissions. It holds no outside API keys.
- **Convex** (`app/convex/`) owns all storage and user auth. Its actions call the extract endpoints (hourly for 24/7 scans of saved areas, or when a user searches or submits a photo) and upsert the results: shops by `Shop.id`, deals by `Deal.id` and the dedupe key. See [app/convex/README.md](app/convex/README.md) and [api/README.md, "Storing results"](api/README.md#storing-results-convex).
- **api/** is stateless: it fetches, has Claude extract, verifies, and returns JSON. Convex calls it server to server with the shared `DIBS_API_KEY` (header `X-Dibs-Key`); it has to be reachable from Convex (deployed, or a tunnel during the hackathon).

API keys live only in `api/.env` (gitignored). Neither the app nor Convex calls Anthropic, Bright Data or Apify directly.
