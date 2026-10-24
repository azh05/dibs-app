# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Dibs finds short-lived local deals, has Claude extract them as structured JSON, and checks every deal with deterministic Python rules before returning it. This is a monorepo: the FastAPI backend lives in `api/` and the Expo mobile app (screens built from the Figma design) lives in `app/` (see `app/README.md` and `app/AGENTS.md`). A Convex backend comes next and is not in the repo yet: the app will read and write through Convex (Clerk sign-in, the tables in the "Backend data model" doc), and Convex actions will call this API and store what it returns. The API itself stays stateless. Neither the app nor Convex calls Anthropic, Bright Data or Apify directly; only `api/` holds those keys. Until Convex exists the app calls the API directly via `EXPO_PUBLIC_API_URL`.

`docs/apis-and-auth.md` lists every outside API, how it is authenticated, and the sign-in options (mirrors the "APIs & auth" tab of the Dibs App doc).

`api/README.md` documents the HTTP API, verification rules tables, and Bright Data setup in detail; keep it in sync when behavior changes. The root `README.md` only describes the folder layout.

All paths below are relative to `api/`, and every command runs from there.

## Commands

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

## Architecture

Five extract endpoints, one shared verification layer:

- **`/extract/search`** → `app/extractor.py` `DealExtractor`. A single multi-turn Claude call with two tools: server-side `web_search` (`web_search_20250305`) and the client tool `record_deals`, whose input schema is generated from `RawDeal` (refs inlined by `_inline_refs`). The loop (max `MAX_TURNS`=4) handles `pause_turn` by resending the assistant turn unchanged, and nudges once if Claude answers in prose. Sources for verification are the URLs the web search actually returned.
- **`/extract/serp`** and **`/extract/instagram`** → `app/bd_pipeline.py` `BrightDataPipeline`. `app/brightdata.py` fetches (SERP API with retries; Instagram posts scraped by URL). `/extract/instagram` finds each shop's posts through Google first, then fetches them by URL, because Bright Data's profile discovery is unreliable; `/extract/serp` re-extracts deals that cite an Instagram post from the full caption (`enrich_instagram`), `app/sources.py` normalizes everything into `SourceDoc`, then `extract_from_docs` makes a Claude call with **only** `record_deals` over numbered sources `[S1]`, `[S2]`.... Instagram runs as a background job via `app/jobs.py` `JobStore` (in-memory, thread pool; `POST` returns 202 + `status_url`).
- **`/extract/shops`** → `app/shop_pipeline.py` `ShopPipeline` (background job). `app/apify.py` `ApifyClient` runs public Store Actors through `run-sync-get-dataset-items` (one parser per Actor's output). Google Maps (`compass/crawler-google-places`, `scrapeContacts`) finds shops with their Instagram/TikTok/Facebook links, cached per area by `ShopCache` (`api/.cache/shops.json`, 7 days); a keyword sweep (TikTok search + Instagram hashtags) runs alongside and its @mentions become extra shops; with `BRIGHTDATA_API_KEY` set (`main.get_shop_pipeline` passes a `BrightDataClient`), `app/google_lookup.py` `GoogleLookup` uses Bright Data's Google search to fill shops' missing Instagram/TikTok/Facebook (`accounts_from_results`, accepted only when `handle_matches` the shop name) and to search for recent deal posts (Instagram post URLs fetched in full via `BrightDataClient.instagram_posts`, other results kept as second-hand SERP snippets); Bright Data failures never fail the job. Then one run per channel (Instagram, TikTok, Facebook, website crawler) for all shops, in parallel. `_attribute` marks posts from a shop's own account (`SourceDoc.shop`, rendered as "shop's own <channel>"); everything else is second-hand. Extraction reuses `extract_docs_batched` (sources split into parallel Claude calls that each fit `PROMPT_CHAR_BUDGET`) and `verify_docs` from `bd_pipeline.py`; deals are flagged `shop_own_post` or `second_hand`, then `app/linking.py` `link_deals` sets `Deal.shop_id` (own account → handle → fuzzy name → new `found_via: "deal"` Shop) and a stable `Deal.id`. `Shop.id` is `gmaps:<place_id>` / `ig:` / `tt:` / `name:`. These ids are the upsert keys for the planned Convex tables (README "Storing results"). Website docs carry a `prompt_text` excerpt (`deal_excerpt`) for Claude while verification uses the full page.
- Apify caps memory across all running Actors (16 GB free plan). `ApifyClient.run` passes per-Actor `memory` (`ACTOR_MEMORY_MB`), waits on a process-wide `MemoryGate`, and retries 402 "memory limit" responses; out-of-credit 402s fail at once.
- **`/extract/photo`** → `app/photo.py` `PhotoExtractor`. Multipart upload; Claude gets the image and calls `record_photo_deals` with a full `transcript` plus deals (`PhotoRawDeal` adds `year_stated`). The transcript is passed to `verify_deals` as `source_texts`, so quotes are machine-checked like the Bright Data path. Dates without a year are fixed in Python (`resolve_missing_year`, nearest to `photo_date`) and flagged `year_inferred`; status is judged against today. `GET /demo` serves `demo/index.html`, a dependency-free phone-sized page that drives this endpoint from a webcam or upload.
- **`app/verify.py` `verify_deals`** is the AI-free gate every path goes through: rejects deals lacking a quote or citing a URL not in the fetched sources, strips promo codes not in the quote, assigns `live`/`needs_check`/`stale`/`expired`, dedupes, and sorts. The Bright Data path additionally passes `source_texts` and `authoritative_post_dates` (keyed by `normalize_url()`) so quotes must appear in the source text and Bright Data post dates override Claude's.
- **`app/schemas.py`**: `RawDeal` (what Claude emits) vs `Deal` (verified, adds `status`/`flags`); request/response models. Every endpoint returns `SearchResponse` with a `provider` field. `../app/src/lib/types.ts` in the Expo app mirrors `Deal` (`ApiDeal`), so a new enum value (e.g. a `Category`) also needs an entry in `../app/src/lib/api.ts` `CATEGORY`.
- **`app/errors.py` `http_error`** maps upstream exceptions (Anthropic, Bright Data and Apify auth/timeout/other errors) to HTTP status codes; `main._call` and `JobStore` both use it.

### Convex integration (planned)

- Convex owns storage and auth; the API writes nothing. The README "Storing results (Convex)" section is the contract: `agent_runs`, `stores` (upsert by `Shop.id` as `external_id`), `sources` (by normalized URL), `deals` (by `dedupe_key`, same rule as `verify.py`) and `deal_evidence` (by `Deal.id`). Field names stay snake_case as the API returns them; keep that section in sync with `schemas.py` and the "Backend data model" doc.
- Convex actions call the slow endpoints as jobs (`POST /extract/shops` or `/extract/instagram`, then poll the `status_url`); `JobStore` is in-memory and is what `agent_runs` replaces. `ShopCache` (`.cache/shops.json`) is the piece that moves into `stores`.
- The API has no auth yet. Before Convex calls it from the cloud, add a shared-secret check (planned `DIBS_API_KEY`); the unmerged `auth` branch holds an OIDC token check (SpacetimeAuth, works with Clerk's issuer) if the app ever needs to call the API directly.

### Non-obvious constraints

- `claude-opus-5-5` rejects forced `tool_choice` (`{"type": "tool"}` / `"any"`) with a 400, so every pipeline uses `tool_choice: auto`, name the tool in the prompt, and fall back to one nudge turn. Assistant turns are sent back via `model_dump(exclude_none=True)` so thinking blocks round-trip unchanged.
- Dates Claude can't express as `YYYY-MM-DD` become `null` (never guessed); other malformed fields drop only that deal, with a note in `search_errors`.
- `tests/test_extractor.py::test_system_prompt_unchanged_by_refactor` pins a SHA-256 of `SYSTEM_PROMPT`. Editing `DEAL_TYPES`/`SEARCH_INSTRUCTIONS`/`DEAL_RULES`/`SEARCH_FINISH` intentionally requires updating that hash. `DEAL_RULES` is shared with the Bright Data `EXTRACTION_PROMPT`.
- Bright Data sources are truncated to `DOC_CHAR_LIMIT` per doc / `PROMPT_CHAR_BUDGET` total for the prompt, but verification checks against the full text.

## Testing approach

- Claude is faked with objects returning real `anthropic` SDK `Message` objects (see `msg()`/`FakeClient` in `tests/test_extractor.py`); constructors accept injected clients (`DealExtractor(client=...)`, `BrightDataPipeline(bd=..., anthropic_client=...)`).
- Bright Data and Apify are faked with `httpx.MockTransport`; `tests/test_shop_pipeline.py` uses a `FakeApify` with one method per Actor and `ShopCache(None)` (disabled).
- API tests use `app.dependency_overrides` on `get_extractor`/`get_pipeline`/`get_jobs` and a `JobStore(executor=InlineExecutor())` to run jobs synchronously.
