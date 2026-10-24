# Dibs

Short-lived local deals (grand-opening specials, BOGO offers, promo codes) found on the public web, extracted by Claude, and checked with plain Python rules before anyone sees them.

| Folder | What | Docs |
| --- | --- | --- |
| [`api/`](api/) | FastAPI backend: Claude web search and Bright Data (Google + public Instagram posts) pipelines, deterministic verification | [api/README.md](api/README.md) |
| `mobile/` | Mobile app (coming next) | |
| [`docs/`](docs/) | Team notes: [outside APIs, keys and user sign-in options](docs/apis-and-auth.md) | |

## Quick start (API)

```bash
cd api
uv sync
cp .env.example .env        # add ANTHROPIC_API_KEY and BRIGHTDATA_API_KEY
uv run --env-file .env uvicorn app.main:app --reload --port 8000
```

Then open http://localhost:8000/docs. Tests: `cd api && uv run pytest -q`.

API keys live only in `api/.env` (gitignored). The app should only ever call this API, never Anthropic or Bright Data directly.
