# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Dibs finds short-lived local deals, has Claude extract them as structured JSON, and checks every deal with deterministic Python rules before returning it. It is a monorepo with three layers:

```
app/ (Expo)  ->  Convex (app/convex/: Clerk sign-in, tables, crons)  ->  api/ (FastAPI)  ->  Anthropic, Bright Data, Apify
```

- **`api/`**: the stateless extraction service (FastAPI, Python). Fetches, has Claude extract, verifies, returns JSON. It is the only place that holds Anthropic, Bright Data or Apify keys.
- **`app/`**: the Expo (React Native) app, built screen by screen from the Figma file "dibs — App Design" (https://www.figma.com/design/6mfeMN9XPnjwR6dn2DwdsG). With `EXPO_PUBLIC_CONVEX_URL` and `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` set it reads and writes only through Convex; without them it runs on mock data. It never calls the API itself.
- **Convex** (`app/convex/`): owns users (Clerk), storage and the 24/7 scan schedule. Its actions call `api/` with the shared `DIBS_API_KEY` and store what it returns.

Where things are documented (keep them in sync when behavior changes):

- `api/README.md`: the HTTP API, verification rules, Bright Data and Apify setup, and the Convex schema/upsert contract ("Storing results (Convex)").
- `app/convex/README.md`: Convex setup start to finish (cloud deployment, API key, tunnel, Clerk, push), env vars, data flow, crons, module map.
- `app/README.md`: app flow, what runs for real, layout. `app/AGENTS.md` (loaded by `app/CLAUDE.md`): Expo rules; read it before touching the app.
- The Dibs App Google Doc, "APIs & auth" tab: every outside API, how it authenticates, and the sign-in options.
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

Env vars (see `api/.env.example`; keys live only in the gitignored `api/.env`): `ANTHROPIC_API_KEY`, `DIBS_MODEL` (default `claude-opus-5-5`), `BRIGHTDATA_API_KEY` (or `BRIGHTDATA_API_TOKEN`), `BRIGHTDATA_SERP_ZONE`, `APIFY_TOKEN`, `APIFY_MEMORY_MB` (account memory cap, default 16384), `DIBS_SHOP_CACHE` (shop-list cache path, `off` disables), `ELASTIC_URL` / `KIBANA_URL` / `ELASTIC_API_KEY` (optional Elastic index and agent), `DIBS_API_KEY` (shared secret with Convex and the Elastic workflows: when set, every route except `/health` and `/demo` needs header `X-Dibs-Key`; `main.require_key`). `/extract/serp`, `/extract/instagram` and `/extract/shops` spend real Bright Data / Apify credits; without `DIBS_API_KEY` there is no auth, so keep uvicorn bound to 127.0.0.1 unless the key is set.

### Architecture

Five extract endpoints (plus `/discover/shops`, which lists shops and extracts nothing), one shared verification layer:

- **`/extract/search`** → `app/extractor.py` `DealExtractor`. A single multi-turn Claude call with two tools: server-side `web_search` (`web_search_20250305`) and the client tool `record_deals`, whose input schema is generated from `RawDeal` (refs inlined by `_inline_refs`). The loop (max `MAX_TURNS`=4) handles `pause_turn` by resending the assistant turn unchanged, and nudges once if Claude answers in prose. Sources for verification are the URLs the web search actually returned.
- **`/extract/serp`** and **`/extract/instagram`** → `app/bd_pipeline.py` `BrightDataPipeline`. `app/brightdata.py` fetches (SERP API with retries; Instagram posts scraped by URL). `/extract/instagram` finds each shop's posts through Google first, then fetches them by URL, because Bright Data's profile discovery is unreliable; `/extract/serp` re-extracts deals that cite an Instagram post from the full caption (`enrich_instagram`), `app/sources.py` normalizes everything into `SourceDoc`, then `extract_from_docs` makes a Claude call with **only** `record_deals` over numbered sources `[S1]`, `[S2]`.... Instagram runs as a background job via `app/jobs.py` `JobStore` (in-memory, thread pool; `POST` returns 202 + `status_url`).
- **`/extract/shops`** → `app/shop_pipeline.py` `ShopPipeline` (background job). `app/apify.py` `ApifyClient` runs public Store Actors through `run-sync-get-dataset-items` (one parser per Actor's output). Google Maps (`compass/crawler-google-places`, `scrapeContacts`) finds shops with their Instagram/TikTok/Facebook links, cached per area by `ShopCache` (`api/.cache/shops.json`, 7 days); a keyword sweep (TikTok search + Instagram hashtags) runs alongside and its @mentions become extra shops; with `BRIGHTDATA_API_KEY` set (`main.get_shop_pipeline` passes a `BrightDataClient`), `app/google_lookup.py` `GoogleLookup` uses Bright Data's Google search to fill shops' missing Instagram/TikTok/Facebook (`accounts_from_results`, accepted only when `handle_matches` the shop name) and to search for recent deal posts (Instagram post URLs fetched in full via `BrightDataClient.instagram_posts`, other results kept as second-hand SERP snippets); Bright Data failures never fail the job. Then one run per channel (Instagram, TikTok, Facebook, website crawler) for all shops, in parallel. `_attribute` marks posts from a shop's own account (`SourceDoc.shop`, rendered as "shop's own <channel>"); everything else is second-hand. Extraction reuses `extract_docs_batched` (sources split into parallel Claude calls that each fit `PROMPT_CHAR_BUDGET`) and `verify_docs` from `bd_pipeline.py`; deals are flagged `shop_own_post` or `second_hand`, then `app/linking.py` `link_deals` sets `Deal.shop_id` (own account → handle → fuzzy name → new `found_via: "deal"` Shop) and a stable `Deal.id`. `Shop.id` is `gmaps:<place_id>` / `ig:` / `tt:` / `name:`. These ids are the upsert keys for the Convex tables (README "Storing results"). Website docs carry a `prompt_text` excerpt (`deal_excerpt`) for Claude while verification uses the full page.
- **`/discover/shops`** → `ShopPipeline.discover` (background job): every shop in a circle (`lat`, `lng`, `radius_miles`) from Google Maps only, no posts and no Claude. One Maps run per search term, 3 at a time, with `customGeolocation` (`ApifyClient.find_shops(near=...)`; the Actor prefers `locationQuery`, so only one is sent), then deduped, filtered to the circle, sorted nearest first and capped at `max_shops` (250). Returns `provider: "apify_maps"` with `deals: []`. Convex keeps the list (`app/convex/areas.ts`); the API caches nothing for it.
- Apify caps memory across all running Actors (16 GB free plan). `ApifyClient.run` passes per-Actor `memory` (`ACTOR_MEMORY_MB`), waits on a process-wide `MemoryGate`, and retries 402 "memory limit" responses; out-of-credit 402s fail at once.
- **`/extract/photo`** → `app/photo.py` `PhotoExtractor`. Multipart upload; Claude gets the image and calls `record_photo_deals` with a full `transcript` plus deals (`PhotoRawDeal` adds `year_stated`). The transcript is passed to `verify_deals` as `source_texts`, so quotes are machine-checked like the Bright Data path. Dates without a year are fixed in Python (`resolve_missing_year`, nearest to `photo_date`) and flagged `year_inferred`; status is judged against today. `GET /demo` serves `demo/index.html`, a dependency-free phone-sized page that drives this endpoint from a webcam or upload.
- **`app/verify.py` `verify_deals`** is the AI-free gate every path goes through: rejects deals lacking a quote or citing a URL not in the fetched sources, strips promo codes not in the quote, assigns `live`/`needs_check`/`stale`/`expired`, dedupes, and sorts. The Bright Data path additionally passes `source_texts` and `authoritative_post_dates` (keyed by `normalize_url()`) so quotes must appear in the source text and Bright Data post dates override Claude's.
- **`app/schemas.py`**: `RawDeal` (what Claude emits) vs `Deal` (verified, adds `status`/`flags`); request/response models. Every endpoint returns `SearchResponse` with a `provider` field and links its deals with `app/linking.py` `link_deals` (stable `Deal.id`, `Deal.shop_id`, `shops`). `RawDeal` also carries display fields for the app (`headline`, `title`, `deal_types`, `kind`, `student_only`, `age_21`, `est_savings_cents`, `recurring_window`): never verified, and a bad value is cleared by a field validator rather than dropping the deal. `SearchResultSource` carries the full `text`, `origin` and `handle` so Convex can store sources. Convex mirrors these shapes in `../app/convex/lib/api.ts` and `../app/convex/ingest.ts` validators, and the Expo app in `../app/src/lib/types.ts` (`ApiDeal`); a new enum value (e.g. a `Category` or `DealType`) needs updating there too (`../app/src/lib/api.ts` `CATEGORY`, `../app/convex/schema.ts` `dealType`).
- **`app/elastic.py`** (optional, needs `ELASTIC_URL`):
  - **Indexing:** `main._indexed` writes every endpoint's verified deals (including the two jobs) to the `dibs-deals` index, keyed by `Deal.id` (or `linking.deal_id`). Indexing failures only add a `search_errors` note.
  - **Fields:** `search_text` is `semantic_text` pinned to Jina v5 and holds the original quote, so search works across languages. `ends_at` is the end instant in `DIBS_TIMEZONE`; compare against it, not `end_date`, because Elastic's "now" is UTC.
  - **Endpoints:** `DealIndex.search` (`/search/deals`) is an `rrf` retriever (semantic + `multi_match`); its `rank_window_size` must be at least `size`. `DibsAgent` (`/agent/ask`) calls Kibana's Agent Builder converse API.
  - **Setup:** `python -m app.elastic setup` recreates the agent and its ES|QL tools (agent first: tools in use can't be deleted).
  - **Workflows:** the YAML in `elastic/workflows/` is pasted into Kibana. The watch matcher calls `/alerts/check`, which pushes via Expo (`app/push.py`).
- **`app/errors.py` `http_error`** maps upstream exceptions (Anthropic, Bright Data, Apify, Elastic and Expo push errors) to HTTP status codes; `main._call` and `JobStore` both use it.

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
npx expo start --ios                                        # Expo Go on the iOS simulator (backend mode if .env.local has both keys)
npx expo start --clear                                      # after editing .env.local: env vars are read when Metro starts
npx tsc --noEmit && npx expo lint                           # run both before calling a change done (also covers convex/)
npm test                                                    # Convex backend tests (convex/**/*.test.ts)
```

There are no tests for the screens; the Convex backend has a convex-test suite. `.prettierrc` exists but older files aren't formatted, so format only the files you touch (`npx prettier --write <file>`).

### Architecture

- **Routes** (`src/app/`): `index` (Welcome) → `onboarding/sign-in|phone|verify|finish|log-in|create-account|username|interests|alerts` → `(tabs)`. Usernames are mandatory: Apple/Google/phone sign-ups go through `onboarding/username` (`?onboarding=1`), and `(tabs)/_layout.tsx` redirects any account with `needsUsername` (store) there. The tabs are Deals, Map, Friends, Earn, Alerts and Profile. `saved` and `leaderboard` also live in `(tabs)` with `href: null`, so they keep the tab bar with Profile lit (`PARENT_TAB` in `components/tab-bar.tsx`), and the tabs use `backBehavior="history"` so their back buttons work. Stack screens above the tabs: `filters` and `location` (modals), `deal/[id]`, `event/[id]`, `submission`, `find-friends` (`social.findPeople`: @username prefix, then names via the `search_display_name` index; backend only), `invite/[code]` (fills the invite code, then sign-in). Typed routes are on (`app.json`).
- **State**: `useStore()` (`src/lib/store.tsx`) has one interface and two providers, picked in `src/lib/providers.tsx`: `MockStoreProvider` (in memory, resets on restart) and `BackendStoreProvider` (`src/lib/backend-store.tsx`: Convex queries plus optimistic mutations, Clerk sign-in). It holds account, interests, alert radius and place, filters, saved/used/followed/liked sets, reminders, submissions, credits, line reports, XP, votes, confirmations and lists.
- **Data**: `src/lib/api.ts` hooks (`useDeals`, `useDeal`, `useEvent`, `useSaved`, `useSpotsWatched`) read the Convex feed in backend mode and mock data otherwise; `src/lib/feed.ts` maps Convex deal views onto the app's `Deal`/`DealEvent`. `src/lib/social-data.ts` serves Profile, Friends and Leaderboard in the shapes of `src/lib/social.ts` (the mocks). `src/lib/photo.ts` uploads Earn photos to Convex storage (`photos.submit`) and the result screen follows the submission. `src/lib/clerk-auth.ts` holds the sign-in flows (Clerk classic API via `@clerk/expo/legacy`, SSO for Apple/Google). Hooks that differ by mode are chosen once at module load (`usingBackend ? useX : useY`) so hook order stays stable. `src/lib/types.ts` mirrors `api/app/schemas.py` (`ApiDeal`); a new API enum value needs a `CATEGORY` entry.
- **Taxonomy**: `src/lib/interests.ts` is the one list of 72 store types in sections, plus 8 deal types. It drives Pick interests, Filters, the Deals chips and alert matching. Nightlife and 21+ shops stay locked until the birthday shows 21+; accounts without one are asked for it (`src/lib/age-gate.ts`). Store-type keys are shared with the backend through `convex/catalog.ts`.
- **Device features**: `src/lib/notifications.ts` (local deal alerts with Get Directions / Save / Remind Me actions) and `src/lib/line-check.ts` (geofence prompt "How long is the line?", the store's `geofence_m` (75 m by default) for 2 minutes while the Map is open; reports go to Convex `lineChecks.report`). `src/lib/push.ts` registers the Expo push token after sign-in (needs an EAS `projectId`).

### Conventions

- Figma is the source of truth. Screens and components carry a comment naming their Figma frame and node id, e.g. `// 17 · Friends (Figma 102:2466)`; look the node up with the Figma MCP before changing a screen.
- Colours, fonts (Plus Jakarta Sans), radii and shadows come from `src/theme.ts`; text goes through `components/text.tsx` (`weight`, `size`, `tracking`, `color`).
- Icons are Figma SVGs in `assets/icons/`, registered in `components/icon.tsx` in alphabetical order. `.svgrrc` maps `#16161A` to `currentColor`, so a new icon must be drawn in `#16161A` to take a `color`.
- Rewards are dibs credits (500 per verified deal, `CREDITS_PER_DEAL` in `src/lib/photo.ts`), never dollars or gift cards. Dollar amounts appear only as money saved on deals.

## Convex (`app/convex/`)

Paths in this section are relative to `app/`. Setup (cloud deployment, Clerk, API key, tunnel) is in `convex/README.md`. Read `convex/_generated/ai/guidelines.md` before writing Convex code.

```bash
cd app
npx convex dev                                   # deploy + codegen (CONVEX_AGENT_MODE=anonymous for a local backend, no account)
npm test                                         # convex-test + vitest, convex/**/*.test.ts
npx vitest run convex/photos.test.ts -t "credits"   # one test
npx tsc --noEmit && npx expo lint                # app typecheck + lint (also covers convex/)
```

- Convex owns storage and auth; the API writes nothing. `convex/ingest.ts` upserts a `SearchResponse`: `stores` by `external_id` (= `Shop.id`, else Instagram handle, else name within `scan_area_key`; a `gmaps:` shop never matches another `gmaps:` store, so chain branches stay apart), `sources` by normalized URL (only cited ones), `deals` by `deal_evidence.evidence_key` (= `Deal.id`) then `dedupe_key` (store id + offer + code). `convex/lib/text.ts` ports `normalize_url`, `names_match` and `SequenceMatcher.ratio`; `convex/lib/status.ts` ports `verify.py` status rules (plus `upcoming`, `hidden`). Keep them in step with the Python and keep api/README "Storing results" in sync.
- `convex/areas.ts`: a saved location joins a `scan_areas` circle (`assignArea`: reuse a covering area, widen one centred within 0.5 mi, else create one; `saved_locations.scan_area_key` = the area's `key`, so the old text-keyed paths keep working). Each area's shop list is `area_stores` (area ↔ store), filled by `/discover/shops` (`via: "maps"`) and by deal scans (`via: "scan"`). A list is fresh for `DISCOVERY_TTL` (7 days); `claimDiscovery` checks freshness and in-flight runs in one transaction. Discovery runs set `agent_runs.scan_area_id` and not `area`, so the `by_area` "scanned recently" checks ignore them, and they don't bump `stores.last_scanned_at` (the deal-scan clock; new stores start at 0).
- `convex/scans.ts` runs `/extract/shops` as an API job and polls by rescheduling itself every 15 s (actions aren't retried and time out); `agent_runs` mirrors each job (`api_job_id`), `scan_cache` skips repeats within 6 h. `pollShops` also polls `/discover/shops` jobs (picked by `provider`). The API's `JobStore` and `ShopCache` stay in the API.
- Convex has no unique indexes: every "unique" is an index plus `.unique()` check inside the writing mutation. `ctx.db.get/patch/delete` take the table name first (Convex 1.48 style). Geo queries use the `@convex-dev/geospatial` component (`dealGeo` for active deals, `locationGeo` for saved places); `deals.geo_indexed` tracks membership. Push goes straight to Expo's API over the `devices` table (multi-device), not the expo-push component.
- Files with two dots (`*.test.ts`, `test.setup.ts`) aren't deployed. Tests use `makeTest()` from `convex/test.setup.ts` (registers the components), `t.withIdentity`, `stubFetch` for the API and Expo, and fake timers + `finishInProgressScheduledFunctions` for scheduled work. Pure helpers live in `convex/lib/` so tests can import them without loading Convex runtime code.
- The app imports Convex code via the `@convex/*` path alias (generated `api`, `catalog.ts`).
- Auth: the API's only auth is the shared `DIBS_API_KEY` (`main.require_key`); Convex sends it as `X-Dibs-Key`. Convex verifies each call's Clerk session token (`auth.config.ts`, `CLERK_JWT_ISSUER_DOMAIN`, Clerk's Convex integration). `http.ts` `/clerk-users-webhook` (Svix-signed, `CLERK_WEBHOOK_SECRET`) syncs users, verifies `.edu` students, grants referral credits and handles deletion.
- Not built yet from the doc's design: daily per-store deal scans of each area's shop list (`DEAL_SCAN_TTL` in `areas.ts` is reserved for it; `/extract/shops` still takes shop names, not known stores), `scan_areas` local run times and budgets (scans run hourly for saved areas, at most every 6 h each), the 90-day purge of expired deals, and `sponsored_placements`. Badges and weekly challenges exist in the backend (`lib/gamify.ts`, `challenges.ts`) but the current Figma screens don't show them.
