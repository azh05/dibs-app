# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Dibs is a FastAPI service that finds short-lived local deals, has Claude extract them as structured JSON, and checks every deal with deterministic Python rules before returning it. README.md documents the HTTP API, verification rules table, and Bright Data setup in detail; keep it in sync when behavior changes.

## Commands

Uses [uv](https://docs.astral.sh/uv/) (Python 3.13, pinned in `.python-version`).

```bash
uv sync                                                    # install deps
uv run --env-file .env uvicorn app.main:app --reload --port 8000   # dev server, docs at /docs
uv run pytest -q                                           # all tests
uv run pytest tests/test_verify.py::test_name -q           # single test
```

Add dependencies with `uv add <pkg>` (dev-only: `uv add --dev <pkg>`), never pip; commit `uv.lock` with the change.

`pytest.ini` sets `pythonpath = .`, so tests import `app.*` directly. Tests need no API keys or credits. There is no linter/formatter configured.

Env vars (see `.env.example`): `ANTHROPIC_API_KEY`, `DIBS_MODEL` (default `claude-opus-5-5`), `BRIGHTDATA_API_KEY` (or `BRIGHTDATA_API_TOKEN`), `BRIGHTDATA_SERP_ZONE`. The `/extract/serp` and `/extract/instagram` endpoints spend real Bright Data credits and have no auth — keep uvicorn bound to 127.0.0.1.

## Architecture

Three endpoints, two fetch strategies, one shared verification layer:

- **`/extract/search`** → `app/extractor.py` `DealExtractor`. A single multi-turn Claude call with two tools: server-side `web_search` (`web_search_20250305`) and the client tool `record_deals`, whose input schema is generated from `RawDeal` (refs inlined by `_inline_refs`). The loop (max `MAX_TURNS`=4) handles `pause_turn` by resending the assistant turn unchanged, and nudges once if Claude answers in prose. Sources for verification are the URLs the web search actually returned.
- **`/extract/serp`** and **`/extract/instagram`** → `app/bd_pipeline.py` `BrightDataPipeline`. `app/brightdata.py` fetches (SERP API with retries; Instagram Web Scraper dataset with trigger/poll), `app/sources.py` normalizes everything into `SourceDoc`, then `extract_from_docs` makes a Claude call with **only** `record_deals` over numbered sources `[S1]`, `[S2]`.... Instagram runs as a background job via `app/jobs.py` `JobStore` (in-memory, thread pool; `POST` returns 202 + `status_url`).
- **`app/verify.py` `verify_deals`** is the AI-free gate both paths go through: rejects deals lacking a quote or citing a URL not in the fetched sources, strips promo codes not in the quote, assigns `live`/`needs_check`/`stale`/`expired`, dedupes, and sorts. The Bright Data path additionally passes `source_texts` and `authoritative_post_dates` (keyed by `normalize_url()`) so quotes must appear in the source text and Bright Data post dates override Claude's.
- **`app/schemas.py`**: `RawDeal` (what Claude emits) vs `Deal` (verified, adds `status`/`flags`); request/response models. Both pipelines return `SearchResponse` with a `provider` field.
- **`app/errors.py` `http_error`** maps upstream exceptions (Anthropic, `BrightDataAuthError`/`BrightDataTimeout`/`BrightDataError`) to HTTP status codes; `main._call` and `JobStore` both use it.

### Non-obvious constraints

- `claude-opus-5-5` rejects forced `tool_choice` (`{"type": "tool"}` / `"any"`) with a 400, so both pipelines use `tool_choice: auto`, name the tool in the prompt, and fall back to one nudge turn. Assistant turns are sent back via `model_dump(exclude_none=True)` so thinking blocks round-trip unchanged.
- Dates Claude can't express as `YYYY-MM-DD` become `null` (never guessed); other malformed fields drop only that deal, with a note in `search_errors`.
- `tests/test_extractor.py::test_system_prompt_unchanged_by_refactor` pins a SHA-256 of `SYSTEM_PROMPT`. Editing `DEAL_TYPES`/`SEARCH_INSTRUCTIONS`/`DEAL_RULES`/`SEARCH_FINISH` intentionally requires updating that hash. `DEAL_RULES` is shared with the Bright Data `EXTRACTION_PROMPT`.
- Bright Data sources are truncated to `DOC_CHAR_LIMIT` per doc / `PROMPT_CHAR_BUDGET` total for the prompt, but verification checks against the full text.

## Testing approach

- Claude is faked with objects returning real `anthropic` SDK `Message` objects (see `msg()`/`FakeClient` in `tests/test_extractor.py`); constructors accept injected clients (`DealExtractor(client=...)`, `BrightDataPipeline(bd=..., anthropic_client=...)`).
- Bright Data is faked with `httpx.MockTransport`.
- API tests use `app.dependency_overrides` on `get_extractor`/`get_pipeline`/`get_jobs` and a `JobStore(executor=InlineExecutor())` to run jobs synchronously.
