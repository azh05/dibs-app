"""FastAPI app: POST /extract/search returns verified deal JSON."""
from __future__ import annotations

import logging
from functools import lru_cache

import anthropic
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .extractor import DealExtractor
from .schemas import SearchRequest, SearchResponse

logging.basicConfig(level=logging.INFO)

app = FastAPI(
    title="Deal Extractor",
    description="Claude web search + extraction of short-lived local deals, with deterministic verification.",
    version="0.1.0",
)

# Open CORS so the frontend can call this during the hackathon. Tighten before any real launch.
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@lru_cache
def get_extractor() -> DealExtractor:
    return DealExtractor()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/extract/search", response_model=SearchResponse)
def extract_search(req: SearchRequest, extractor: DealExtractor = Depends(get_extractor)) -> SearchResponse:
    try:
        return extractor.search(req)
    except anthropic.AuthenticationError:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY is missing or invalid")
    except anthropic.RateLimitError:
        raise HTTPException(status_code=429, detail="Claude rate limit hit; retry shortly")
    except anthropic.APIError as exc:
        raise HTTPException(status_code=502, detail=f"Claude API error: {exc}")
