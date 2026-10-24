"""FastAPI app: verified deal JSON from Claude web search (/extract/search), Bright Data (/extract/serp,
/extract/instagram), or a user's photo of an in-store deal (/extract/photo)."""
from __future__ import annotations

import logging
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Callable, Optional, TypeVar
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .bd_pipeline import BrightDataPipeline
from .errors import http_error
from .extractor import DealExtractor, _today
from .jobs import JobStore
from .photo import MAX_IMAGE_BYTES, PhotoExtractor, sniff_media_type
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

DEMO_PAGE = Path(__file__).resolve().parent.parent / "demo" / "index.html"


@lru_cache
def get_extractor() -> DealExtractor:
    return DealExtractor()


@lru_cache
def get_pipeline() -> BrightDataPipeline:
    return BrightDataPipeline()


@lru_cache
def get_jobs() -> JobStore:
    return JobStore()


@lru_cache
def get_photo_extractor() -> PhotoExtractor:
    return PhotoExtractor()


def _call(fn: Callable[[], T]) -> T:
    try:
        return fn()
    except Exception as exc:
        mapped = http_error(exc)
        if mapped is None:
            raise
        raise HTTPException(status_code=mapped[0], detail=mapped[1]) from exc


@app.get("/demo", include_in_schema=False)
def demo() -> FileResponse:
    """Phone-sized demo of the photo flow (camera or upload -> /extract/photo). Served here so it's same-origin."""
    return FileResponse(DEMO_PAGE)


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


@app.post("/extract/photo", response_model=SearchResponse)
def extract_photo(
    image: Annotated[UploadFile, File(description="JPEG, PNG, WebP or GIF, up to 5 MB")],
    shop: Annotated[Optional[str], Form(description="Shop name hint, e.g. 'Chipotle Westwood'")] = None,
    photo_date: Annotated[Optional[date], Form(description="When the photo was taken. Default: today")] = None,
    timezone: Annotated[str, Form()] = "America/Los_Angeles",
    extractor: PhotoExtractor = Depends(get_photo_extractor),
) -> SearchResponse:
    """A user's photo of a poster, window sign or menu board: what the deal is and when it runs. Takes 5 to 20 s."""
    try:
        ZoneInfo(timezone)
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(status_code=422, detail=f"unknown timezone {timezone!r}")
    data = image.file.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="image is over 5 MB")
    media_type = sniff_media_type(data)
    if media_type is None:
        raise HTTPException(status_code=415, detail="image must be JPEG, PNG, WebP or GIF")
    today = _today(timezone)
    return _call(lambda: extractor.extract(data, media_type, photo_date or today, shop=shop, filename=image.filename, today=today))
