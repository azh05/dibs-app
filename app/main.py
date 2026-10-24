"""FastAPI app: verified deal JSON from Claude web search (/extract/search) or Bright Data (/extract/serp, /extract/instagram)."""
from __future__ import annotations

import logging
from functools import lru_cache
from typing import Callable, TypeVar

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .bd_pipeline import BrightDataPipeline
from .errors import http_error
from .extractor import DealExtractor
from .jobs import JobStore
from .schemas import InstagramRequest, JobCreated, JobStatus, SearchRequest, SearchResponse, SerpSearchRequest

logging.basicConfig(level=logging.INFO)

app = FastAPI(
    title="Dibs",
    description="Short-lived local deals from Claude web search or Bright Data public web data, with deterministic verification.",
    version="0.2.0",
)

# Open CORS so the frontend can call this during the hackathon. Tighten before any real launch.
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

T = TypeVar("T")


@lru_cache
def get_extractor() -> DealExtractor:
    return DealExtractor()


@lru_cache
def get_pipeline() -> BrightDataPipeline:
    return BrightDataPipeline()


@lru_cache
def get_jobs() -> JobStore:
    return JobStore()


def _call(fn: Callable[[], T]) -> T:
    try:
        return fn()
    except Exception as exc:
        mapped = http_error(exc)
        if mapped is None:
            raise
        raise HTTPException(status_code=mapped[0], detail=mapped[1]) from exc


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/extract/search", response_model=SearchResponse)
def extract_search(req: SearchRequest, extractor: DealExtractor = Depends(get_extractor)) -> SearchResponse:
    return _call(lambda: extractor.search(req))


@app.post("/extract/serp", response_model=SearchResponse)
def extract_serp(req: SerpSearchRequest, pipeline: BrightDataPipeline = Depends(get_pipeline)) -> SearchResponse:
    """Google results via Bright Data's SERP API, then Claude extraction over those snippets. Takes 5 to 30 s."""
    return _call(lambda: pipeline.run_serp(req))


@app.post("/extract/instagram", status_code=202, response_model=JobCreated)
def extract_instagram(
    req: InstagramRequest,
    pipeline: BrightDataPipeline = Depends(get_pipeline),
    jobs: JobStore = Depends(get_jobs),
) -> JobCreated:
    """Start a background job: recent public posts from these shops' Instagram profiles. Poll status_url (2 to 5 min)."""
    _call(pipeline.check_ready)
    job_id = jobs.submit(lambda on_progress: pipeline.run_instagram(req, on_progress=on_progress))
    return JobCreated(job_id=job_id, status_url=f"/extract/instagram/{job_id}")


@app.get("/extract/instagram/{job_id}", response_model=JobStatus)
def instagram_job(job_id: str, jobs: JobStore = Depends(get_jobs)) -> JobStatus:
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="unknown job_id (jobs are kept in memory and lost on restart)")
    return job
