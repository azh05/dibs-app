"""Data models for extracted deals and API requests/responses."""
from __future__ import annotations

import re
from datetime import date, datetime, time
from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator


class Category(str, Enum):
    food = "food"
    drink = "drink"
    retail = "retail"
    entertainment = "entertainment"
    other = "other"


class Confidence(str, Enum):
    high = "high"
    medium = "medium"
    low = "low"


class DealStatus(str, Enum):
    live = "live"                # has a current end date, or a recent post
    needs_check = "needs_check"  # no dates we can trust; ask users to confirm
    stale = "stale"              # no end date and the post is old
    expired = "expired"          # end date has passed


class RawDeal(BaseModel):
    """What Claude returns through the record_deals tool. Never trusted as-is."""

    shop_name: str
    shop_handle: Optional[str] = Field(None, description="Instagram handle without @, if known")
    address: Optional[str] = None
    category: Category = Category.other
    offer: str = Field(..., description="Plain-language offer, e.g. 'Buy 1 drink, get the 2nd 50% off'")
    code: Optional[str] = Field(None, description="Promo code exactly as written in the source")
    conditions: list[str] = Field(default_factory=list, description="Fine print: in-store only, first order, min spend...")
    start_date: Optional[date] = None
    end_date: Optional[date] = Field(None, description="Only if the source states it. Never inferred.")
    start_time: Optional[time] = Field(None, description="Local start time as HH:MM, only if stated, e.g. '3PM' -> 15:00")
    end_time: Optional[time] = Field(None, description="Local end time as HH:MM, only if stated. 'Until close' -> null plus a condition")
    source_url: str
    source_post_date: Optional[date] = Field(None, description="When the source was posted, if shown")
    verbatim_quote: str = Field(..., description="Exact text from the source that supports the offer")
    confidence: Confidence = Confidence.medium


class Deal(RawDeal):
    """A deal after deterministic verification."""

    status: DealStatus
    flags: list[str] = Field(default_factory=list)


class RejectedDeal(BaseModel):
    deal: RawDeal
    reason: str


class Location(BaseModel):
    city: str = "Los Angeles"
    region: str = "California"
    country: str = "US"
    timezone: str = "America/Los_Angeles"
    neighborhood: Optional[str] = Field(None, examples=["Westwood"])


class SearchRequest(BaseModel):
    location: Location = Field(default_factory=Location)
    radius_miles: float = Field(1.0, gt=0, le=25)
    categories: list[Category] = Field(default_factory=list)
    shop: Optional[str] = Field(None, description="Focus on one shop, e.g. 'Milksha Westwood'")
    query: Optional[str] = Field(None, description="Free-text extra instructions, e.g. 'boba BOGO'")
    max_searches: int = Field(5, ge=1, le=10)
    allowed_domains: Optional[list[str]] = Field(
        None,
        description="Restrict search to these domains, e.g. ['instagram.com']. Default: no restriction, "
        "since shop websites vary.",
    )


class SearchResultSource(BaseModel):
    url: str
    title: Optional[str] = None
    page_age: Optional[str] = None


class Usage(BaseModel):
    input_tokens: int = 0
    output_tokens: int = 0
    web_search_requests: int = 0


Provider = Literal["claude_web_search", "brightdata_serp", "brightdata_instagram", "user_photo", "apify_shops"]

Channel = Literal["instagram", "tiktok", "facebook", "website"]


class Shop(BaseModel):
    """A shop found on Google Maps, with the social accounts its listing or website links to."""

    name: str
    address: Optional[str] = None
    category: Optional[str] = None
    maps_url: Optional[str] = None
    website: Optional[str] = None
    instagram: Optional[str] = Field(None, description="Handle without @")
    tiktok: Optional[str] = Field(None, description="Handle without @")
    facebook: Optional[str] = Field(None, description="Page URL")
    found_via: Literal["google_maps", "named", "mention"] = "google_maps"


class SearchResponse(BaseModel):
    as_of: date
    deals: list[Deal]
    rejected: list[RejectedDeal]
    queries: list[str]
    sources: list[SearchResultSource]
    search_errors: list[str] = Field(default_factory=list)
    usage: Usage
    provider: Provider = "claude_web_search"
    brightdata_requests: int = 0
    apify_runs: int = 0
    shops: list[Shop] = Field(default_factory=list, description="apify_shops only: the shops that were scraped")
    transcript: Optional[str] = Field(None, description="user_photo only: all text Claude read in the image")


class SerpSearchRequest(BaseModel):
    location: Location = Field(default_factory=Location)
    radius_miles: float = Field(1.0, gt=0, le=25)
    categories: list[Category] = Field(default_factory=list)
    shop: Optional[str] = Field(None, description="Focus on one shop, e.g. 'Milksha Westwood'")
    query: Optional[str] = Field(None, description="Free-text extra instructions for extraction")
    queries: list[str] = Field(default_factory=list, description="Google queries to run instead of the automatic ones")
    max_queries: int = Field(4, ge=1, le=8)
    past_month: bool = Field(True, description="Limit Google to the past month (tbs=qdr:m)")
    enrich_instagram: bool = Field(
        True,
        description="When a deal cites an Instagram post, fetch the full post (caption + real post date) and "
        "re-check the deal against it. Adds about 10 to 30 s.",
    )


_HANDLE = re.compile(r"^[A-Za-z0-9._]{1,30}$")


class InstagramRequest(BaseModel):
    handles: list[str] = Field(..., min_length=1, max_length=20, examples=[["milksha_ca"]])
    num_of_posts: int = Field(6, ge=1, le=20, description="Newest posts to fetch per profile")
    since_days: int = Field(30, ge=1, le=90)
    location: Location = Field(default_factory=Location)
    radius_miles: float = Field(1.0, gt=0, le=25)

    @field_validator("handles")
    @classmethod
    def _clean_handles(cls, handles: list[str]) -> list[str]:
        """Accept '@milksha_ca', 'milksha_ca' or a profile URL; only public profile handles get through."""
        cleaned: list[str] = []
        for h in handles:
            h = re.sub(r"^(https?://)?(www\.)?instagram\.com/", "", h.strip(), flags=re.I).strip("/").lstrip("@")
            if not _HANDLE.match(h):
                raise ValueError(f"not an Instagram handle: {h!r}")
            if h.lower() not in {c.lower() for c in cleaned}:
                cleaned.append(h)
        return cleaned


class ShopsRequest(BaseModel):
    location: Location = Field(default_factory=Location)
    radius_miles: float = Field(1.0, gt=0, le=25)
    categories: list[Category] = Field(default_factory=list)
    search_terms: list[str] = Field(
        default_factory=list,
        max_length=6,
        description="Google Maps searches, e.g. ['boba', 'coffee shop']. Default: from categories",
        examples=[["boba"]],
    )
    shops: list[str] = Field(
        default_factory=list, max_length=20, description="Scrape these shops instead of searching, e.g. ['Milksha Westwood']"
    )
    max_shops: int = Field(8, ge=1, le=20)
    days: int = Field(14, ge=1, le=60, description="Only posts from the last N days")
    posts_per_shop: int = Field(6, ge=1, le=20, description="Newest posts per shop per platform")
    channels: list[Channel] = Field(default_factory=lambda: ["instagram", "tiktok", "facebook", "website"])
    sweep: bool = Field(True, description="Also search TikTok and Instagram hashtags for the area (second-hand posts)")
    hashtags: list[str] = Field(default_factory=list, max_length=5, description="Sweep hashtags. Default: <neighborhood>eats, <neighborhood>food")
    search_queries: list[str] = Field(default_factory=list, max_length=3, description="Sweep TikTok searches. Default: '<area> deals'")
    refresh_shops: bool = Field(False, description="Ignore the cached shop list for this area and search Google Maps again")


class JobError(BaseModel):
    status_code: int
    detail: str


class JobStatus(BaseModel):
    job_id: str
    status: Literal["queued", "running", "done", "failed"]
    created_at: datetime
    progress: list[str] = Field(default_factory=list)
    result: Optional[SearchResponse] = None
    error: Optional[JobError] = None


class JobCreated(BaseModel):
    job_id: str
    status_url: str
