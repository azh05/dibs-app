# Dibs (Claude extraction MVP)

Finds short-lived local deals, returns them as structured JSON, and checks each one with plain Python rules before anyone sees it. Two ways to fetch: Claude's own web search (`/extract/search`), or Bright Data public web data (`/extract/serp` for Google results, `/extract/instagram` for shops' public posts) with Claude doing extraction only.

## Run it

Needs [uv](https://docs.astral.sh/uv/). It installs Python 3.13 and the dependencies for you.

```bash
uv sync
cp .env.example .env                       # then add your ANTHROPIC_API_KEY
uv run --env-file .env uvicorn app.main:app --reload --port 8000
```

Interactive docs: http://localhost:8000/docs

```bash
curl -s -X POST localhost:8000/extract/search \
  -H 'content-type: application/json' \
  -d '{
        "location": {"neighborhood": "Westwood", "city": "Los Angeles", "region": "California"},
        "radius_miles": 1,
        "categories": ["drink", "food"],
        "max_searches": 5
      }' | python -m json.tool
```

Other request fields: `shop` ("Milksha Westwood"), `query` ("boba BOGO"), `allowed_domains` (["instagram.com"]).

## How it works

1. **One Claude call, two tools.** `web_search` (server-side, capped by `max_searches`, located to the request's city) and `record_deals`, a client tool whose input schema is the deal JSON. Claude searches, then calls `record_deals` once.
   - `pause_turn` → the assistant turn is sent back unchanged and Claude continues.
   - Plain-text answer → one follow-up turn forces `record_deals`.
   - Gives up after 4 turns and reports it in `search_errors`.
2. **Per-deal validation.** A date Claude can't express as `YYYY-MM-DD` becomes `null`, never a guess. Other bad fields drop that one deal, not the batch.
3. **Verification** (`app/verify.py`, no AI):

| Rule | Result |
| --- | --- |
| No verbatim quote | rejected: `missing_quote` |
| `source_url` isn't a URL the search returned | rejected: `source_not_in_search_results` |
| Promo code not in the quote | code removed, flag `code_not_in_quote` |
| No post date from Claude | uses the search result's `page_age`, flag `post_date_from_page_age` |
| End date passed | `expired` |
| End date in the future | `live` |
| No end date, post over 14 days old | `stale`, flag `no_end_date` |
| No end date, recent post | `live`, flag `no_end_date` |
| No dates at all | `needs_check`, flag `no_dates` |
| Confidence `low` | never `live`; `needs_check`, flag `low_confidence` |
| Same shop + offer + code | deduped, newest post kept |

Deals come back sorted live → needs_check → stale → expired.

## Response

```json
{
  "as_of": "2026-10-23",
  "deals": [{
    "shop_name": "Milksha Westwood", "shop_handle": "milksha_ca", "address": "1009 Broxton Ave",
    "category": "drink", "offer": "Buy 1 drink, get the 2nd 50% off", "code": "BOGO50",
    "conditions": ["in-store only"], "start_date": null, "end_date": "2026-10-31",
    "source_url": "https://www.instagram.com/p/...", "source_post_date": "2026-10-01",
    "verbatim_quote": "Buy 1 drink and get the second 50% off...", "confidence": "high",
    "status": "live", "flags": []
  }],
  "rejected": [{"deal": {"...": "..."}, "reason": "source_not_in_search_results"}],
  "queries": ["Westwood boba deal October", "..."],
  "sources": [{"url": "...", "title": "...", "page_age": "October 1, 2026"}],
  "search_errors": [],
  "usage": {"input_tokens": 0, "output_tokens": 0, "web_search_requests": 0}
}
```

## Bright Data pipelines

Bright Data fetches the pages; Claude only extracts from them (no web search tool, one forced `record_deals` call over numbered sources `[S1]`, `[S2]`...). Because we hold each source's full text, verification is stricter than on `/extract/search`:

| Extra rule | Result |
| --- | --- |
| Quote isn't in the source text (case, spacing and curly quotes ignored) | rejected: `quote_not_in_source` |
| Instagram post date differs from what Claude read | Bright Data's `date_posted` wins, flag `post_date_from_source` |

All the rules in the table above still apply. Google snippets carry no dates, so SERP deals without a stated end date come back `needs_check`.

### `POST /extract/serp` (blocking, 5 to 30 s)

Bright Data SERP API, queries run in parallel. Body: `location`, `radius_miles`, `categories`, `shop`, `query`, `queries` (your own Google queries), `max_queries` (default 4, max 8), `past_month` (default true, adds `tbs=qdr:m`). Automatic queries, where `{area}` is "neighborhood city" (plain "Westwood" also matches Westwood NJ, MA and KS): `{shop} promo code` (if `shop`), `site:instagram.com {area} deal`, `{area} grand opening special`, `{area} {category} BOGO`.

Checked live on 2026-10-23:
- Bright Data returns the parsed Google page as a JSON object (`organic[]` items have `title, link, description, global_rank`).
- `tbs=qdr:m` passes through: with it, every snippet was from Sep to Oct 2026; without it, results went back to May 2025.
- Good answers take 8 to 15 s. Blocked ones hang about 60 s and come back empty (`x-brd-error-code: expect_element`), so each attempt is cut off at 30 s and retried, up to 3 times.
- Some results are undecodable Google redirects (`/goto?url=...`), and `site:` is sometimes ignored. Both are dropped and counted in `search_errors`.
- Many snippets start with a date ("Oct 15, 2026 — ...", "6 days ago — ..."). It is used as a fallback post date, the same as `page_age` on `/extract/search`. Instagram snippets carry none.

### `POST /extract/instagram` (background job, 2 to 5 min)

Bright Data Instagram posts scraper (`gd_lk5ns7kz21pck8jpis`, discover by profile URL). Public, logged-out posts only; no comments or follower data. Body: `handles` (1 to 20, `@name`, `name` or profile URL), `num_of_posts` (default 6, max 20), `since_days` (default 30), `location`. Returns `202 {"job_id", "status_url"}`; poll `GET /extract/instagram/{job_id}` until `status` is `done` (with `result`) or `failed` (with `error.status_code`). Jobs live in memory and are lost on restart.

Handled for you: profiles that come back with zero posts and no error are retried once (a known Bright Data quirk), error rows inside a 200 are reported in `search_errors`, pinned posts older than `since_days` are dropped, and UTC timestamps are converted to the shop's local date.

Both return the usual response plus `provider` (`claude_web_search`, `brightdata_serp`, `brightdata_instagram`) and `brightdata_requests` (billable calls: SERP attempts including retries, Instagram job triggers). No results is a 200 with `deals: []` and a note in `search_errors`.

| Error | HTTP |
| --- | --- |
| Bright Data key missing or rejected | 500 `BRIGHTDATA_API_KEY missing or invalid` |
| Bright Data timed out | 504 |
| Other Bright Data failure (every SERP query failed, job `failed`, ...) | 502 |
| One of several SERP queries failed | 200, noted in `search_errors` |

## Bright Data setup

1. Sign up with the Cal Hacks promo ($300 credits): https://brightdata.com/?promo=calhack2026&hs_signup=1
2. Create an API key in account settings and put it in `.env` as `BRIGHTDATA_API_KEY` (`BRIGHTDATA_API_TOKEN` also works).
3. Create a SERP API zone in the dashboard and put its name in `.env` as `BRIGHTDATA_SERP_ZONE`. A Web Unlocker zone works too. Left blank, the app uses the account's first `serp` or `unblocker` zone.
4. The Instagram scraper needs no zone, only the API key. The Web Scraper API needs an active account: if a job fails with `Customer is not active`, finish account activation (billing details / verification) in the Bright Data dashboard.
5. Smoke tests (keep uvicorn on 127.0.0.1, its default: these endpoints spend your Bright Data credits and have no auth):

```bash
set -a; source .env; set +a
curl -s -H "Authorization: Bearer $BRIGHTDATA_API_KEY" -H "Content-Type: application/json" \
  -d '{"zone":"'$BRIGHTDATA_SERP_ZONE'","url":"https://www.google.com/search?q=westwood+boba+deal&hl=en&gl=us&brd_json=1","format":"raw","country":"us"}' \
  https://api.brightdata.com/request | head -c 400

curl -s -X POST localhost:8000/extract/serp -H 'content-type: application/json' \
  -d '{"location":{"neighborhood":"Westwood"},"categories":["drink"],"max_queries":2}' | python -m json.tool

JOB=$(curl -s -X POST localhost:8000/extract/instagram -H 'content-type: application/json' \
  -d '{"handles":["milksha_ca"],"num_of_posts":5}' | python -c 'import json,sys; print(json.load(sys.stdin)["status_url"])')
curl -s localhost:8000$JOB | python -m json.tool   # repeat until "status": "done"
```

## Tests

```bash
uv run pytest -q
```

88 tests: every verification rule, the multi-turn tool loop (pause_turn, forced tool, give-up), malformed output, search errors, the Bright Data client (retries, polling, timeouts, error rows), both Bright Data pipelines, the job flow, and the API. They use a fake Claude client returning real SDK `Message` objects and `httpx.MockTransport` for Bright Data, so no keys or credits are needed.

## Cost and settings

- Web search: $10 per 1,000 searches, plus tokens. `max_searches` defaults to 5 (max 10).
- Model: `DIBS_MODEL` env var, default `claude-opus-5-5`. Any model that supports the web search tool works; a smaller model is cheaper for frequent runs.
- Web search tool version: `web_search_20250305`, the basic version that works with direct calls.
- Bright Data: billed per request on your account; `brightdata_requests` in each response shows how many were made. Check usage in the Bright Data dashboard.

## Not in this MVP

Image upload (story screenshots, window signs), Instagram story mentions, storage, scheduling, and the frontend. CORS is wide open for the hackathon; tighten it before launch.

## Layout

```
app/schemas.py    Pydantic models: RawDeal (from Claude), Deal (verified), request/response
app/extractor.py  Claude web search call, tool definitions, prompt, turn loop
app/brightdata.py Bright Data client: SERP API, Instagram posts scraper
app/sources.py    SourceDoc: one shape for everything Bright Data fetched
app/bd_pipeline.py Bright Data fetch -> Claude extraction -> verification
app/jobs.py       In-memory background jobs (Instagram)
app/errors.py     Upstream error -> HTTP status mapping
app/verify.py     Deterministic verification rules
app/main.py       FastAPI app
tests/            pytest suite
```
