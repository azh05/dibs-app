"""FastAPI app: verified deal JSON from Claude web search (/extract/search), Bright Data (/extract/serp,
/extract/instagram), Apify shop scraping (/extract/shops), or a user's photo of an in-store deal (/extract/photo).
/discover/shops lists every shop in a circle from Google Maps (no deals) for Convex's per-area shop list.
With ELASTIC_URL set, every result is indexed in Elastic for /search/deals and the /agent/ask agent."""
from __future__ import annotations

import logging
import os
import secrets
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Callable, Optional, TypeVar
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .bd_pipeline import BrightDataPipeline
from .brightdata import BrightDataClient
from .elastic import DealIndex, DibsAgent, ElasticClient
from .errors import http_error
from .extractor import DealExtractor, _today
from .jobs import JobStore
from .photo import MAX_IMAGE_BYTES, PhotoExtractor, sniff_media_type
from .push import ExpoPush
from .shop_pipeline import ShopPipeline
from .schemas import (
    AskRequest,
    AskResponse,
    DealSearchRequest,
    DealSearchResponse,
    DiscoverRequest,
    InstagramRequest,
    JobCreated,
    JobStatus,
    SearchRequest,
    SearchResponse,
    SerpSearchRequest,
    ShopsRequest,
    WatchCheckRequest,
    WatchCheckResponse,
)

logging.basicConfig(level=logging.INFO)

OPEN_PATHS = {"/health", "/demo"}


def require_key(request: Request, x_dibs_key: Annotated[Optional[str], Header()] = None) -> None:
    """Shared secret for callers outside this machine (Convex, Elastic workflows). Off when DIBS_API_KEY is unset,
    so local development keeps working without it. /health and /demo stay open."""
    expected = os.getenv("DIBS_API_KEY")
    if expected and request.url.path not in OPEN_PATHS and not (x_dibs_key and secrets.compare_digest(x_dibs_key, expected)):
        raise HTTPException(status_code=401, detail="missing or wrong X-Dibs-Key header")


app = FastAPI(
    title="Dibs",
    description="Short-lived local deals from Claude web search, Bright Data or Apify public web data, with deterministic verification.",
    version="0.3.0",
    dependencies=[Depends(require_key)],
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
def get_shop_pipeline() -> ShopPipeline:
    # Bright Data is optional for /extract/shops: without a key the Google steps are skipped.
    bd = BrightDataClient() if os.getenv("BRIGHTDATA_API_KEY") or os.getenv("BRIGHTDATA_API_TOKEN") else None
    return ShopPipeline(bd=bd)


@lru_cache
def get_photo_extractor() -> PhotoExtractor:
    return PhotoExtractor()


@lru_cache
def get_elastic() -> Optional[ElasticClient]:
    """None without ELASTIC_URL: indexing is skipped and the search/agent endpoints answer 503."""
    client = ElasticClient()
    return client if client.configured else None


def get_deal_index() -> Optional[DealIndex]:
    client = get_elastic()
    return DealIndex(client) if client else None


def get_agent() -> Optional[DibsAgent]:
    client = get_elastic()
    return DibsAgent(client) if client and client.kibana_url else None


@lru_cache
def get_push() -> ExpoPush:
    return ExpoPush()


def _indexed(index: Optional[DealIndex], resp: SearchResponse, area: Optional[str]) -> SearchResponse:
    """Index the verified deals in Elastic; a failure is noted in search_errors, never raised."""
    if index is not None:
        note = index.index_response(resp, area)
        if note:
            resp.search_errors.append(note)
    return resp


def _area(location) -> Optional[str]:
    return location.neighborhood or location.city


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
def extract_search(
    req: SearchRequest,
    extractor: DealExtractor = Depends(get_extractor),
    index: Optional[DealIndex] = Depends(get_deal_index),
) -> SearchResponse:
    return _indexed(index, _call(lambda: extractor.search(req)), _area(req.location))


@app.post("/extract/serp", response_model=SearchResponse)
def extract_serp(
    req: SerpSearchRequest,
    pipeline: BrightDataPipeline = Depends(get_pipeline),
    index: Optional[DealIndex] = Depends(get_deal_index),
) -> SearchResponse:
    """Google results via Bright Data's SERP API, then Claude extraction over those snippets. Takes 5 to 30 s."""
    return _indexed(index, _call(lambda: pipeline.run_serp(req)), _area(req.location))


@app.post("/extract/instagram", status_code=202, response_model=JobCreated)
def extract_instagram(
    req: InstagramRequest,
    pipeline: BrightDataPipeline = Depends(get_pipeline),
    jobs: JobStore = Depends(get_jobs),
    index: Optional[DealIndex] = Depends(get_deal_index),
) -> JobCreated:
    """Start a background job: recent public posts from these shops' Instagram profiles. Poll status_url (2 to 5 min)."""
    _call(pipeline.check_ready)
    job_id = jobs.submit(
        lambda on_progress: _indexed(index, pipeline.run_instagram(req, on_progress=on_progress), _area(req.location))
    )
    return JobCreated(job_id=job_id, status_url=f"/extract/instagram/{job_id}")


@app.get("/extract/instagram/{job_id}", response_model=JobStatus)
def instagram_job(job_id: str, jobs: JobStore = Depends(get_jobs)) -> JobStatus:
    return _job(jobs, job_id)


@app.post("/extract/shops", status_code=202, response_model=JobCreated)
def extract_shops(
    req: ShopsRequest,
    pipeline: ShopPipeline = Depends(get_shop_pipeline),
    jobs: JobStore = Depends(get_jobs),
    index: Optional[DealIndex] = Depends(get_deal_index),
) -> JobCreated:
    """Start a background job: find shops on Google Maps, scrape their website, Instagram, TikTok and Facebook
    with Apify, plus a TikTok/hashtag sweep. Poll status_url (1 to 5 min)."""
    _call(pipeline.check_ready)
    job_id = jobs.submit(lambda on_progress: _indexed(index, pipeline.run(req, on_progress=on_progress), _area(req.location)))
    return JobCreated(job_id=job_id, status_url=f"/extract/shops/{job_id}")


@app.get("/extract/shops/{job_id}", response_model=JobStatus)
def shops_job(job_id: str, jobs: JobStore = Depends(get_jobs)) -> JobStatus:
    return _job(jobs, job_id)


@app.post("/discover/shops", status_code=202, response_model=JobCreated)
def discover_shops(
    req: DiscoverRequest,
    pipeline: ShopPipeline = Depends(get_shop_pipeline),
    jobs: JobStore = Depends(get_jobs),
) -> JobCreated:
    """Start a background job: every shop within radius_miles of (lat, lng) on Google Maps, nearest first, with the
    social links from each listing. No posts, no deals. Poll status_url (1 to 10 min)."""
    _call(pipeline.check_ready)
    job_id = jobs.submit(lambda on_progress: pipeline.discover(req, on_progress=on_progress))
    return JobCreated(job_id=job_id, status_url=f"/discover/shops/{job_id}")


@app.get("/discover/shops/{job_id}", response_model=JobStatus)
def discover_job(job_id: str, jobs: JobStore = Depends(get_jobs)) -> JobStatus:
    return _job(jobs, job_id)


def _job(jobs: JobStore, job_id: str) -> JobStatus:
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
    index: Optional[DealIndex] = Depends(get_deal_index),
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
    resp = _call(lambda: extractor.extract(data, media_type, photo_date or today, shop=shop, filename=image.filename, today=today))
    return _indexed(index, resp, None)


def _need(service, name: str):
    if service is None:
        raise HTTPException(status_code=503, detail=f"{name} is not configured (set ELASTIC_URL, KIBANA_URL, ELASTIC_API_KEY)")
    return service


@app.post("/search/deals", response_model=DealSearchResponse)
def search_deals(req: DealSearchRequest, index: Optional[DealIndex] = Depends(get_deal_index)) -> DealSearchResponse:
    """Hybrid search over every indexed deal: meaning (Jina embeddings, any language) + keywords, by distance."""
    return _call(lambda: _need(index, "Elastic").search(req))


@app.post("/agent/ask", response_model=AskResponse)
def agent_ask(
    req: AskRequest,
    agent: Optional[DibsAgent] = Depends(get_agent),
    index: Optional[DealIndex] = Depends(get_deal_index),
) -> AskResponse:
    """Ask the dibs Agent Builder agent; it answers from ES|QL tools and can watch for deals or scan an area."""
    resp = _call(lambda: _need(agent, "The Elastic agent").ask(req))
    if index is not None and resp.deal_ids:
        resp.deals = _call(lambda: index.get_deals(resp.deal_ids))
    return resp


@app.post("/alerts/check", response_model=WatchCheckResponse)
def alerts_check(
    req: WatchCheckRequest,
    index: Optional[DealIndex] = Depends(get_deal_index),
    push: ExpoPush = Depends(get_push),
) -> WatchCheckResponse:
    """Called hourly per watch by the dibs-watch-matcher workflow: push new matching deals through Expo."""
    idx = _need(index, "Elastic")
    watch, deals = _call(lambda: idx.match_watch(req.watch_id))
    if watch is None:
        raise HTTPException(status_code=404, detail="unknown watch_id")
    if not deals:
        return WatchCheckResponse()
    sent = _call(lambda: push.send(watch["push_token"], deals)) if watch.get("push_token") else 0
    _call(lambda: idx.mark_watch(req.watch_id))
    return WatchCheckResponse(matched=[d.id for d in deals if d.id], sent=sent)
