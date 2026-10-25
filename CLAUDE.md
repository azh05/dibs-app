# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Dibs finds short-lived local deals, has Claude extract them as structured JSON, and checks every deal with deterministic Python rules before returning it. It is a monorepo with three layers, two of them built:

```
app/ (Expo)  ->  Convex (planned: Clerk sign-in, tables, crons)  ->  api/ (FastAPI)  ->  Anthropic, Bright Data, Apify
```

- **`api/`**: the stateless extraction service (FastAPI, Python). Fetches, has Claude extract, verifies, returns JSON. It is the only place that holds Anthropic, Bright Data or Apify keys.
- **`app/`**: the Expo (React Native) app, built screen by screen from the Figma file "dibs — App Design" (https://www.figma.com/design/6mfeMN9XPnjwR6dn2DwdsG). Mock data today; it calls the API directly when `EXPO_PUBLIC_API_URL` is set.
- **Convex**: not in the repo yet. It will own users (Clerk), storage and the 24/7 scan schedule, and its actions will call `api/`. The app will then read and write only through Convex.

Where things are documented (keep them in sync when behavior changes):

- `api/README.md`: the HTTP API, verification rules, Bright Data and Apify setup, and the Convex schema/upsert contract ("Storing results (Convex)").
- `app/README.md`: app flow, what runs for real, layout. `app/AGENTS.md` (loaded by `app/CLAUDE.md`): Expo rules; read it before touching the app.
- `docs/apis-and-auth.md`: every outside API, how it authenticates, and the sign-in options (mirrors the "APIs & auth" tab of the Dibs App Google Doc).
- The Dibs App Google Doc, "Backend data model" tab: the full Convex data model, scheduling and purging rules. The root `README.md` gives the overview.

## API (`api/`)

All paths in this section are relative to `api/`, and every command runs from there.

### Commands

Uses [uv](https://docs.astral.sh/uv/) (Python 3.13, pinned in `.python-version`).

```bash
cd api
uv sync                                                    # install deps
uv run --env-file .env uvicorn app.main:app --reload --port 8000   # dev server, docs at /docs
uv run pytest -q                                           # all tests
uv run pytest tests/test_verify.py::test_name -q           # single test
```

Add dependencies with `uv add <pkg>` (dev-only: `uv add --dev <pkg>`), never pip; commit `uv.lock` with the change.

`pytest.ini` sets `pythonpath = .`, so tests import `app.*` directly. Tests need no API keys or credits. There is no linter/formatter configured.

Env vars (see `api/.env.example`; keys live only in the gitignored `api/.env`): `ANTHROPIC_API_KEY`, `DIBS_MODEL` (default `claude-opus-5-5`), `BRIGHTDATA_API_KEY` (or `BRIGHTDATA_API_TOKEN`), `BRIGHTDATA_SERP_ZONE`, `APIFY_TOKEN`, `APIFY_MEMORY_MB` (account memory cap, default 16384), `DIBS_SHOP_CACHE` (shop-list cache path, `off` disables). `/extract/serp`, `/extract/instagram` and `/extract/shops` spend real Bright Data / Apify credits and have no auth — keep uvicorn bound to 127.0.0.1.

### Architecture

Five extract endpoints, one shared verification layer:

- **`/extract/search`** → `app/extractor.py` `DealExtractor`. A single multi-turn Claude call with two tools: server-side `web_search` (`web_search_20250305`) and the client tool `record_deals`, whose input schema is generated from `RawDeal` (refs inlined by `_inline_refs`). The loop (max `MAX_TURNS`=4) handles `pause_turn` by resending the assistant turn unchanged, and nudges once if Claude answers in prose. Sources for verification are the URLs the web search actually returned.
- **`/extract/serp`** and **`/extract/instagram`** → `app/bd_pipeline.py` `BrightDataPipeline`. `app/brightdata.py` fetches (SERP API with retries; Instagram posts scraped by URL). `/extract/instagram` finds each shop's posts through Google first, then fetches them by URL, because Bright Data's profile discovery is unreliable; `/extract/serp` re-extracts deals that cite an Instagram post from the full caption (`enrich_instagram`), `app/sources.py` normalizes everything into `SourceDoc`, then `extract_from_docs` makes a Claude call with **only** `record_deals` over numbered sources `[S1]`, `[S2]`.... Instagram runs as a background job via `app/jobs.py` `JobStore` (in-memory, thread pool; `POST` returns 202 + `status_url`).
- **`/extract/shops`** → `app/shop_pipeline.py` `ShopPipeline` (background job). `app/apify.py` `ApifyClient` runs public Store Actors through `run-sync-get-dataset-items` (one parser per Actor's output). Google Maps (`compass/crawler-google-places`, `scrapeContacts`) finds shops with their Instagram/TikTok/Facebook links, cached per area by `ShopCache` (`api/.cache/shops.json`, 7 days); a keyword sweep (TikTok search + Instagram hashtags) runs alongside and its @mentions become extra shops; with `BRIGHTDATA_API_KEY` set (`main.get_shop_pipeline` passes a `BrightDataClient`), `app/google_lookup.py` `GoogleLookup` uses Bright Data's Google search to fill shops' missing Instagram/TikTok/Facebook (`accounts_from_results`, accepted only when `handle_matches` the shop name) and to search for recent deal posts (Instagram post URLs fetched in full via `BrightDataClient.instagram_posts`, other results kept as second-hand SERP snippets); Bright Data failures never fail the job. Then one run per channel (Instagram, TikTok, Facebook, website crawler) for all shops, in parallel. `_attribute` marks posts from a shop's own account (`SourceDoc.shop`, rendered as "shop's own <channel>"); everything else is second-hand. Extraction reuses `extract_docs_batched` (sources split into parallel Claude calls that each fit `PROMPT_CHAR_BUDGET`) and `verify_docs` from `bd_pipeline.py`; deals are flagged `shop_own_post` or `second_hand`, then `app/linking.py` `link_deals` sets `Deal.shop_id` (own account → handle → fuzzy name → new `found_via: "deal"` Shop) and a stable `Deal.id`. `Shop.id` is `gmaps:<place_id>` / `ig:` / `tt:` / `name:`. These ids are the upsert keys for the planned Convex tables (README "Storing results"). Website docs carry a `prompt_text` excerpt (`deal_excerpt`) for Claude while verification uses the full page.
- Apify caps memory across all running Actors (16 GB free plan). `ApifyClient.run` passes per-Actor `memory` (`ACTOR_MEMORY_MB`), waits on a process-wide `MemoryGate`, and retries 402 "memory limit" responses; out-of-credit 402s fail at once.
- **`/extract/photo`** → `app/photo.py` `PhotoExtractor`. Multipart upload; Claude gets the image and calls `record_photo_deals` with a full `transcript` plus deals (`PhotoRawDeal` adds `year_stated`). The transcript is passed to `verify_deals` as `source_texts`, so quotes are machine-checked like the Bright Data path. Dates without a year are fixed in Python (`resolve_missing_year`, nearest to `photo_date`) and flagged `year_inferred`; status is judged against today. `GET /demo` serves `demo/index.html`, a dependency-free phone-sized page that drives this endpoint from a webcam or upload.
- **`app/verify.py` `verify_deals`** is the AI-free gate every path goes through: rejects deals lacking a quote or citing a URL not in the fetched sources, strips promo codes not in the quote, assigns `live`/`needs_check`/`stale`/`expired`, dedupes, and sorts. The Bright Data path additionally passes `source_texts` and `authoritative_post_dates` (keyed by `normalize_url()`) so quotes must appear in the source text and Bright Data post dates override Claude's.
- **`app/schemas.py`**: `RawDeal` (what Claude emits) vs `Deal` (verified, adds `status`/`flags`); request/response models. Every endpoint returns `SearchResponse` with a `provider` field. `../app/src/lib/types.ts` in the Expo app mirrors `Deal` (`ApiDeal`), so a new enum value (e.g. a `Category`) also needs an entry in `../app/src/lib/api.ts` `CATEGORY`.
- **`app/errors.py` `http_error`** maps upstream exceptions (Anthropic, Bright Data and Apify auth/timeout/other errors) to HTTP status codes; `main._call` and `JobStore` both use it.

### Non-obvious constraints

- `claude-opus-5-5` rejects forced `tool_choice` (`{"type": "tool"}` / `"any"`) with a 400, so every pipeline uses `tool_choice: auto`, name the tool in the prompt, and fall back to one nudge turn. Assistant turns are sent back via `model_dump(exclude_none=True)` so thinking blocks round-trip unchanged.
- Dates Claude can't express as `YYYY-MM-DD` become `null` (never guessed); other malformed fields drop only that deal, with a note in `search_errors`.
- `tests/test_extractor.py::test_system_prompt_unchanged_by_refactor` pins a SHA-256 of `SYSTEM_PROMPT`. Editing `DEAL_TYPES`/`SEARCH_INSTRUCTIONS`/`DEAL_RULES`/`SEARCH_FINISH` intentionally requires updating that hash. `DEAL_RULES` is shared with the Bright Data `EXTRACTION_PROMPT`.
- Bright Data sources are truncated to `DOC_CHAR_LIMIT` per doc / `PROMPT_CHAR_BUDGET` total for the prompt, but verification checks against the full text.

### Testing approach

- Claude is faked with objects returning real `anthropic` SDK `Message` objects (see `msg()`/`FakeClient` in `tests/test_extractor.py`); constructors accept injected clients (`DealExtractor(client=...)`, `BrightDataPipeline(bd=..., anthropic_client=...)`).
- Bright Data and Apify are faked with `httpx.MockTransport`; `tests/test_shop_pipeline.py` uses a `FakeApify` with one method per Actor and `ShopCache(None)` (disabled).
- API tests use `app.dependency_overrides` on `get_extractor`/`get_pipeline`/`get_jobs` and a `JobStore(executor=InlineExecutor())` to run jobs synchronously.

## App (`app/`)

Expo SDK 58 with expo-router, TypeScript, React Native StyleSheet (no Tailwind). Paths in this section are relative to `app/`. Read `AGENTS.md` first: Expo APIs change every SDK, so check the versioned docs instead of memory, and add packages with `npx expo install`.

```bash
cd app
npm install
npx expo start --ios                                        # Expo Go on the iOS simulator
EXPO_PUBLIC_API_URL=http://localhost:8000 npx expo start    # use the local API instead of mock data
npx tsc --noEmit && npx expo lint                           # run both before calling a change done
```

There are no app tests. `.prettierrc` exists but older files aren't formatted, so format only the files you touch (`npx prettier --write <file>`).

### Architecture

- **Routes** (`src/app/`): `index` (Welcome) → `onboarding/sign-in|create-account|interests|alerts` → `(tabs)`. The tabs are Deals, Map, Friends, Earn, Alerts and Profile. `saved` and `leaderboard` also live in `(tabs)` with `href: null`, so they keep the tab bar with Profile lit (`PARENT_TAB` in `components/tab-bar.tsx`), and the tabs use `backBehavior="history"` so their back buttons work. Stack screens above the tabs: `filters` (modal that edits a draft), `deal/[id]`, `event/[id]`, `submission`. Typed routes are on (`app.json`).
- **State**: `src/lib/store.tsx` is one in-memory React context (`useStore`): account, interests, alert radius, filters, saved/used/followed/liked sets, reminders, submissions, credits, line reports and XP. Nothing persists; Convex replaces it.
- **Data**: `src/lib/api.ts` `useDeals()` returns mock deals (`src/lib/mock.ts`) or calls `POST /extract/search` and maps `ApiDeal` into the app's `Deal` (`CATEGORY` maps API categories to store types and icons). `src/lib/types.ts` mirrors `api/app/schemas.py`, so a new API enum value needs a `CATEGORY` entry. `src/lib/photo.ts` posts Earn photos to `/extract/photo` (mocked with the Figma Chipotle example when no API is set). Events, friends, leaderboards, badges and lists are mock only (`mock.ts`, `src/lib/social.ts`).
- **Taxonomy**: `src/lib/interests.ts` is the one list of 72 store types in sections, plus 8 deal types. It drives Pick interests, Filters, the Deals chips and alert matching. Nightlife and 21+ shops stay locked until the birthday shows 21+.
- **Device features**: `src/lib/notifications.ts` (local deal alerts with Get Directions / Save / Remind Me actions) and `src/lib/line-check.ts` (geofence prompt "How long is the line?", about 60 m for 2 minutes while the Map is open).

### Conventions

- Figma is the source of truth. Screens and components carry a comment naming their Figma frame and node id, e.g. `// 17 · Friends (Figma 102:2466)`; look the node up with the Figma MCP before changing a screen.
- Colours, fonts (Plus Jakarta Sans), radii and shadows come from `src/theme.ts`; text goes through `components/text.tsx` (`weight`, `size`, `tracking`, `color`).
- Icons are Figma SVGs in `assets/icons/`, registered in `components/icon.tsx` in alphabetical order. `.svgrrc` maps `#16161A` to `currentColor`, so a new icon must be drawn in `#16161A` to take a `color`.
- Rewards are dibs credits (500 per verified deal, `CREDITS_PER_DEAL` in `src/lib/photo.ts`), never dollars or gift cards. Dollar amounts appear only as money saved on deals.

## Convex (planned)

Not in the repo yet. The full design is in the "Backend data model" tab of the Dibs App doc; this is what the code relies on.

- **Tables**: users and preferences (Clerk identity, saved locations, category/store/deal-type follows, devices for Expo push), stores and what the agents find (`stores`, `agent_runs`, `sources`, `deals`, `deal_evidence`, `rejected_extractions`, `scan_cache`, `scan_areas`), photo submissions and the `credit_ledger`, community signals (votes, deal confirmations, line reports), notifications, reminders and saved deals, social and gamification (stretch), and `sponsored_placements`, which the organic feed never reads.
- **Contract with the API**: `api/README.md` "Storing results (Convex)" is the schema for the tables the API fills. Every write is an upsert: `stores` by `external_id` (`Shop.id`), `sources` by normalized URL, `deals` by `dedupe_key` (store + offer + code, the same rule as `verify.py`), `deal_evidence` by `evidence_key` (`Deal.id`). Field names stay snake_case as the API returns them; keep that section in sync with `schemas.py` and the doc.
- **Scheduling**: nothing runs on Apify's or Bright Data's own schedulers. An hourly Convex cron starts each `scan_area` at its local run times (daily food and drink at 10:00 and 16:00, weekly shop refresh, website crawl and non-food categories), POSTs `/extract/shops`, polls the `status_url`, and saves the result in one mutation. `JobStore` is in memory, so a run still going after 15 minutes is marked failed and retried. `ShopCache` (`.cache/shops.json`) is what moves into `stores`.
- **Status and purging**: an hourly cron sets `upcoming`/`expired`/`stale` (14 days, `STALE_AFTER_DAYS`)/`hidden`; the feed shows live, needs_check and upcoming. A daily cron deletes deals 90 days after they expire or go stale, unless a user record points at them. Alerts go out only for a new `dedupe_key`.
- **Auth**: users sign in with Clerk and Convex checks Clerk's token. The API has no auth yet; before Convex calls it from the cloud, add a shared-secret header check (planned `DIBS_API_KEY`). An OIDC token check for the API was prototyped with SpacetimeAuth (commit `2aed0bb`, not merged; its branch is deleted), as described in `docs/apis-and-auth.md`.
