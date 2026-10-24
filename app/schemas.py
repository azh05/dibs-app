"""Data models for extracted deals and API requests/responses."""
from __future__ import annotations

from datetime import date
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


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


class SearchResponse(BaseModel):
    as_of: date
    deals: list[Deal]
    rejected: list[RejectedDeal]
    queries: list[str]
    sources: list[SearchResultSource]
    search_errors: list[str] = Field(default_factory=list)
    usage: Usage
