# APIs & auth

Every outside service Dibs uses, how each one is authenticated, what it costs, and how users will sign in. As of Oct 24, 2026. Keys live only in `api/.env` (gitignored); `api/.env.example` lists the names. The same content is in the "APIs & auth" tab of the Dibs App Google Doc.

## How the pieces connect

Mobile app → Convex (users signed in with Clerk) → Dibs API (FastAPI, in api/) → Anthropic, Bright Data, Apify.

The app never calls Anthropic, Bright Data or Apify itself and never holds their keys. Only the Dibs API does.

## Outside APIs (keys on our server)

### Anthropic (Claude)

- What for: reads every fetched page, post and photo and records the deals as JSON, on every /extract endpoint. `/extract/search` also uses Claude's own web search tool.
- Auth: API key in `ANTHROPIC_API_KEY`. The anthropic Python SDK sends it as the `x-api-key` header. Model: `DIBS_MODEL` (default `claude-opus-5-5`).
- Get a key: console.anthropic.com → API keys.
- Cost: per token; web search is $10 per 1,000 searches. A 10-shop `/extract/shops` run used about 16k input and 2.5k output tokens.

### Bright Data

- What for: Google results (SERP API) for `/extract/serp`, and public Instagram posts by URL (Web Scraper API, dataset `gd_lk5ns7kz21pck8jpis`) for `/extract/instagram`. In `/extract/shops` it finds shops' missing Instagram/TikTok/Facebook accounts and searches Google for recent deal posts (optional: skipped without a key).
- Setup: the account must be active (payment method verified) for the Instagram scraper, and needs a SERP API zone (Web Access → SERP API → add zone) whose name goes in `BRIGHTDATA_SERP_ZONE`.
- Auth: API key in `BRIGHTDATA_API_KEY`, sent as `Authorization: Bearer <key>` to api.brightdata.com. Google searches also need a zone name in `BRIGHTDATA_SERP_ZONE` (blank = the account's first SERP or Web Unlocker zone).
- Get a key: account settings → API keys, then create a SERP API zone. Cal Hacks promo: brightdata.com/?promo=calhack2026 ($300 credits).
- Cost: per request; every response reports `brightdata_requests`. Their prize track only allows data a logged-out visitor can see (no logins or cookies).

### Apify

- What for: `/extract/shops`. Public Store Actors: Google Maps (compass/crawler-google-places) finds shops and their social links; apify/instagram-scraper, apify/instagram-hashtag-scraper, clockworks/tiktok-scraper, apify/facebook-posts-scraper and apify/website-content-crawler read their posts and pages.
- Auth: personal API token in `APIFY_TOKEN`, sent as `Authorization: Bearer <token>` to api.apify.com.
- Get a token: console.apify.com → Settings → API & Integrations. Promo: Billing → Subscription → code `APIFY_CAL_HACKS` ($200 credits).
- Cost: per result, priced by each Actor. Live: about $1.20 for 10 food and drink shops with the creator sweep, about $0.29 for 8 non-food shops. Facebook costs the most (about $8 per 1,000 posts). About $3.24 used so far.
- Limit: 16 GB of memory across all running Actors on the free plan, even with promo credits. The API asks for less memory per run and queues runs instead of failing.
- Apify MCP (mcp.apify.com): connects Claude chat or Claude Code to Apify with the same token. Useful for trying Actors while developing; the Dibs API calls Apify's REST API directly.

### Google Maps

- No Google key. Shop names, addresses, place ids, coordinates and social links come through Apify's Google Maps Actor.

## Dibs API (our FastAPI server)

- Auth: a shared secret with Convex. With `DIBS_API_KEY` set, every `/extract/*` call needs the header `X-Dibs-Key: <key>` (401 otherwise); `/health`, `/docs` and `/demo` stay open. Without it the API is open, so it must stay on 127.0.0.1. CORS allows any origin.
- Endpoints: each one, with the outside services it uses, is in "Endpoints Convex can call" below.

## Endpoints Convex can call

Every endpoint takes JSON (except `/extract/photo`, a file upload) and returns the same shape: deals (each with status, flags, `source_url` and `verbatim_quote`), rejected deals, sources, `search_errors` and usage counts. The slow ones run as background jobs: the POST returns 202 with a `status_url`, and Convex polls that URL until status is "done" or "failed". Jobs live in the API's memory and are lost if it restarts.

### `POST /extract/shops` (background job, 1 to 5 min): the main one, for 24/7 scans

- What it does: finds the shops in an area, reads each shop's own posts and pages plus creator posts, and returns verified deals linked to shops.
- Apify: Google Maps scraper (shops, addresses, place ids, coordinates, social links); Instagram scraper (each shop's posts and reels); Instagram hashtag scraper (creator posts, e.g. `#westwoodeats`); TikTok scraper (each shop's videos, plus a TikTok search for the area); Facebook posts scraper (page posts, plus text read off poster images); website crawler (home page and deal, menu and student pages).
- Bright Data (optional): Google search for shops' missing Instagram, TikTok and Facebook accounts, and for recent deal posts in the area; its Instagram scraper fetches the posts Google found.
- Claude: extracts the deals from everything fetched.
- Returns shops (stable ids) and deals linked to them by `shop_id`: what Convex upserts into its tables.
- Cost per run: about $0.30 to $1.20 of Apify (6 to 10 shops), about $0.02 of Bright Data, plus Claude tokens.

### `POST /extract/photo` (5 to 20 s)

- What it does: checks a user's photo of an in-store deal (poster, sign, menu board) for the Earn credits flow. Upload: image, plus optional shop name, photo date and timezone.
- Claude only (reads the image): transcribes every word on it, then records the deal. The transcript comes back too.

### `POST /extract/search` (10 to 60 s)

- What it does: finds deals for an area (or one shop) with Claude's own web search. The app's Deals list uses it today.
- Claude only: Claude's web search tool finds and reads the pages. Cost: tokens plus $10 per 1,000 searches.

### `POST /extract/serp` (10 to 60 s)

- What it does: deals from Google results for the area.
- Bright Data: Google search (SERP API, past month); its Instagram scraper re-fetches in full any Instagram post a deal cites.
- Claude: extracts from the Google snippets and posts.

### `POST /extract/instagram` (background job, 20 to 60 s)

- What it does: recent posts from Instagram accounts you name (handles).
- Bright Data: Google finds each account's recent post links, then its Instagram scraper fetches those posts.
- Claude: extracts.

### Not for Convex

- `GET /health` (is it up), `GET /docs` (interactive API docs), `GET /demo` (the photo demo page).

### Connecting Convex

- Convex runs in the cloud, so the API has to be reachable from the internet (deployed, or a tunnel during the hackathon). Set the Convex env vars `DIBS_API_URL` and `DIBS_API_KEY` (see `app/convex/README.md`).
- Set `DIBS_API_KEY` on the API before exposing it: without it, anyone who finds the URL can spend our Apify, Bright Data and Claude credits.

## User sign-in: the two options

### Option A: Clerk + Convex (the plan in "Backend data model")

- Users sign in with Clerk (Google, Apple, phone). Convex checks Clerk's token on every call (`convex/auth.config.ts` with the Clerk issuer domain and applicationID "convex"). `users.store` creates the users row on first sign-in, and a Clerk webhook keeps it in sync.
- Neither Clerk nor Convex is on the Cal Hacks sponsor list we found.

### Option B: SpacetimeAuth (built on the auth branch, not merged)

- SpacetimeDB's hosted login: magic link, Google, GitHub, Discord. SpacetimeDB is a headline sponsor with a "most impressive use of Spacetime" prize.
- The auth branch (commit 2aed0bb) makes every /extract endpoint require a SpacetimeAuth ID token (`Authorization: Bearer <id_token>`), checked in `api/app/auth.py` against SpacetimeAuth's public keys. It adds `GET /me`, `DIBS_AUTH=off` for local dev, and tests.

### Decision: Clerk + Convex (built, in `app/convex/`)

- Sign-in: Google, Apple, phone code, and email with password through Clerk's Expo SDK (`@clerk/expo`). Convex verifies Clerk's session token (native Convex integration, `aud: "convex"`). A Svix-verified webhook keeps users in sync.
- Student verification: the `.edu` address is added to the user's Clerk account and confirmed with Clerk's emailed code; the webhook then marks the user as a verified student. No email provider needed.

### Recommendation (as written before the build)

- Use one sign-in for users: Clerk + Convex, since the data model is already built around it.
- Then the app talks to Convex, and Convex actions call the Dibs API server to server. The Dibs API needs a shared secret with Convex, not user tokens: one `DIBS_API_KEY` header check on the /extract endpoints.
- If the app ever has to call the Dibs API directly, the auth branch's token check is standard OIDC and works with Clerk too: point the issuer at the Clerk domain and the audience at "convex".
- SpacetimeAuth only makes sense if the database also moves to SpacetimeDB for its prize.

## Env vars (`api/.env`)

- `ANTHROPIC_API_KEY`, `DIBS_MODEL`: Claude.
- `BRIGHTDATA_API_KEY` (or `BRIGHTDATA_API_TOKEN`), `BRIGHTDATA_SERP_ZONE`: Bright Data.
- `APIFY_TOKEN`, `APIFY_MEMORY_MB` (default 16384): Apify.
- `DIBS_SHOP_CACHE`: Google Maps shop-list cache file (default `api/.cache/shops.json`; "off" disables).
- `DIBS_API_KEY`: shared secret with Convex (`X-Dibs-Key` header).
- Auth branch only: `SPACETIMEAUTH_CLIENT_ID`, `SPACETIMEAUTH_ISSUER`, `DIBS_AUTH=off`.
