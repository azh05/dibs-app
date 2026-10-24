# Dibs (Claude extraction MVP)

Finds short-lived local deals with Claude's web search, returns them as structured JSON, and checks each one with plain Python rules before anyone sees it.

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

## Tests

```bash
uv run pytest -q
```

29 tests: every verification rule, the multi-turn tool loop (pause_turn, forced tool, give-up), malformed output, search errors, and the API. They use a fake client returning real SDK `Message` objects, so no key or credits are needed.

## Cost and settings

- Web search: $10 per 1,000 searches, plus tokens. `max_searches` defaults to 5 (max 10).
- Model: `DIBS_MODEL` env var, default `claude-opus-5-5`. Any model that supports the web search tool works; a smaller model is cheaper for frequent runs.
- Web search tool version: `web_search_20250305`, the basic version that works with direct calls.

## Not in this MVP

Image upload (story screenshots, window signs), Instagram story mentions, storage, scheduling, and the frontend. CORS is wide open for the hackathon; tighten it before launch.

## Layout

```
app/schemas.py    Pydantic models: RawDeal (from Claude), Deal (verified), request/response
app/extractor.py  Claude call, tool definitions, prompt, turn loop
app/verify.py     Deterministic verification rules
app/main.py       FastAPI app
tests/            pytest suite
```
