"""Data models for extracted deals and API requests/responses."""
from __future__ import annotations

import re
from datetime import date, datetime, time
from enum import Enum
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


class Category(str, Enum):
    food = "food"
    drink = "drink"
    retail = "retail"
    entertainment = "entertainment"
    beauty = "beauty"    # barbershops, hair and nail salons
    fitness = "fitness"  # gyms, boxing, yoga
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


class DealType(str, Enum):
    """Same values as the app's "Deal types" chips and the Convex deal_type_follows table."""

    bogo = "bogo"
    percent_off = "percent_off"
    free = "free"
    student = "student"
    happy_hour = "happy_hour"
    late_night = "late_night"
    new_opening = "new_opening"
    event = "event"


class RecurringWindow(BaseModel):
    """A deal that repeats, e.g. "20% off before 10 AM on weekdays"."""

    days: list[Literal["mon", "tue", "wed", "thu", "fri", "sat", "sun"]] = Field(
        default_factory=list, description="Days it runs; empty = every day"
    )
    start_time: Optional[time] = Field(None, description="Local HH:MM")
    end_time: Optional[time] = Field(None, description="Local HH:MM")


HEADLINE_MAX = 12
TITLE_MAX = 40


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
    # Display fields for the app. Never verified and never trusted for status; a bad value is cleared, not fatal.
    headline: Optional[str] = Field(
        None, description=f"Map-pin text, at most {HEADLINE_MAX} characters: 'BOGO', '30% off', '$9', 'Free drink'"
    )
    title: Optional[str] = Field(None, description=f"Short name, at most {TITLE_MAX} characters: 'BOGO on all milk teas'")
    deal_types: list[DealType] = Field(default_factory=list, description="Every type that applies; empty if none fit")
    kind: Literal["deal", "event"] = Field(
        "deal", description="event: a dated pop-up, collab, opening party or similar happening, rather than a discount"
    )
    student_only: bool = Field(False, description="Only for students (student ID or .edu required)")
    age_21: bool = Field(False, description="Alcohol, cannabis or anything else 21+ only")
    est_savings_cents: Optional[int] = Field(
        None,
        description="What one person saves using it once, in US cents, only when the source states the prices "
        "(e.g. BOGO on a $6 drink = 600). Null when prices aren't stated; never guessed",
    )
    recurring_window: Optional[RecurringWindow] = Field(None, description="Only for deals that repeat on a schedule")

    @field_validator("headline", "title", mode="before")
    @classmethod
    def _short_text(cls, value: Any, info: Any) -> Optional[str]:
        if not isinstance(value, str) or not value.strip():
            return None
        limit = HEADLINE_MAX if info.field_name == "headline" else TITLE_MAX
        value = " ".join(value.split())
        return value if len(value) <= limit else value[: limit - 1].rstrip() + "…"

    @field_validator("deal_types", mode="before")
    @classmethod
    def _known_types(cls, value: Any) -> list[str]:
        known = {t.value for t in DealType}
        if not isinstance(value, list):
            return []
        return list(dict.fromkeys(v for v in value if isinstance(v, str) and v in known))

    @field_validator("kind", mode="before")
    @classmethod
    def _kind(cls, value: Any) -> str:
        return value if value in ("deal", "event") else "deal"

    @field_validator("student_only", "age_21", mode="before")
    @classmethod
    def _flag(cls, value: Any) -> bool:
        return value is True

    @field_validator("est_savings_cents", mode="before")
    @classmethod
    def _cents(cls, value: Any) -> Optional[int]:
        if isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0:
            return None
        return int(value)

    @field_validator("recurring_window", mode="before")
    @classmethod
    def _window(cls, value: Any) -> Any:
        if value is None:
            return None
        try:
            return RecurringWindow.model_validate(value)
        except ValueError:
            return None


class Deal(RawDeal):
    """A deal after deterministic verification."""

    status: DealStatus
    flags: list[str] = Field(default_factory=list)
    id: Optional[str] = Field(None, description="Stable id (same source post + quote + code = same id across runs), for upserts")
    shop_id: Optional[str] = Field(None, description="Id of the Shop in `shops` this deal is at")


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
    text: Optional[str] = Field(
        None, description="Full text we read (caption, snippet, page or photo transcript); null for Claude web search"
    )
    origin: Optional[Literal["serp", "instagram", "tiktok", "facebook", "website", "photo"]] = None
    handle: Optional[str] = Field(None, description="Account that posted it, without @ (social posts)")


class Usage(BaseModel):
    input_tokens: int = 0
    output_tokens: int = 0
    web_search_requests: int = 0


Provider = Literal["claude_web_search", "brightdata_serp", "brightdata_instagram", "user_photo", "apify_shops", "apify_maps"]

Channel = Literal["instagram", "tiktok", "facebook", "website"]


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


class OpeningHours(BaseModel):
    day: str = Field(..., description="As Google Maps writes it, e.g. 'Monday'")
    hours: str = Field(..., description="As Google Maps writes it, e.g. '11 AM to 10 PM' or 'Closed'")


class Shop(BaseModel):
    """A shop found on Google Maps, with the social accounts its listing or website links to."""

    id: str = Field("", description="Stable id: gmaps:<place_id>, else ig:/tt:<handle>, else name:<slug>")
    name: str
    address: Optional[str] = None
    category: Optional[str] = None
    maps_url: Optional[str] = None
    place_id: Optional[str] = Field(None, description="Google Maps place id")
    lat: Optional[float] = None
    lng: Optional[float] = None
    website: Optional[str] = None
    instagram: Optional[str] = Field(None, description="Handle without @")
    tiktok: Optional[str] = Field(None, description="Handle without @")
    facebook: Optional[str] = Field(None, description="Page URL")
    hours: Optional[list[OpeningHours]] = Field(None, description="Opening hours from Google Maps, one entry per day")
    found_via: Literal["google_maps", "named", "mention", "deal"] = Field(
        "google_maps", description="mention: tagged in a creator post; deal: only known from a deal that named it"
    )

    @model_validator(mode="after")
    def _default_id(self) -> "Shop":
        if not self.id:
            if self.place_id:
                self.id = f"gmaps:{self.place_id}"
            elif self.instagram:
                self.id = f"ig:{self.instagram.lower()}"
            elif self.tiktok:
                self.id = f"tt:{self.tiktok.lower()}"
            else:
                self.id = f"name:{_slug(self.name)}"
        return self


class KnownShop(BaseModel):
    """A shop Convex already has on an area's list, scraped as it is: no Google Maps search."""

    id: str = Field(..., min_length=1, description="Its Shop.id: gmaps:<place_id>, ig:/tt:<handle>, name:<slug>")
    name: str
    category: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    website: Optional[str] = None
    instagram: Optional[str] = Field(None, description="Handle without @")
    tiktok: Optional[str] = Field(None, description="Handle without @")
    facebook: Optional[str] = Field(None, description="Page URL")
    found_via: Literal["google_maps", "named", "mention", "deal"] = "google_maps"
    since: Optional[date] = Field(None, description="Only this shop's posts from this day on (its last scan). Default: the request's days")
    lookup: bool = Field(False, description="Look up its missing Instagram/TikTok/Facebook on Google (Bright Data)")

    def shop(self) -> Shop:
        return Shop.model_validate(self.model_dump(exclude={"since", "lookup"}))


class ScannedShop(BaseModel):
    """What one known shop's own channels showed in a store batch, so Convex can schedule its next scan."""

    id: str
    posts: int = Field(0, description="Own posts inside the window")
    latest_post_date: Optional[date] = Field(None, description="Newest own post seen, inside the window or not")
    deals: int = 0


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
    shops: list[Shop] = Field(default_factory=list, description="Shops the deals link to (apify_shops: also every shop that was scraped)")
    scanned: list[ScannedShop] = Field(default_factory=list, description="apify_shops with stores: one entry per store sent")
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


MAX_BATCH_STORES = 60
MAX_SWEEP_STORES = 500


class ShopsRequest(BaseModel):
    location: Location = Field(default_factory=Location)
    radius_miles: float = Field(1.0, gt=0, le=25)
    categories: list[Category] = Field(default_factory=list)
    search_terms: list[str] = Field(
        default_factory=list,
        max_length=12,
        description="Google Maps searches, e.g. ['boba', 'coffee shop']. Default: from categories",
        examples=[["boba"]],
    )
    shops: list[str] = Field(
        default_factory=list, max_length=60, description="Scrape these shops instead of searching, e.g. ['Milksha Westwood']"
    )
    stores: list[KnownShop] = Field(
        default_factory=list,
        max_length=MAX_SWEEP_STORES,
        description=f"Scrape these known shops (up to {MAX_BATCH_STORES}) instead of searching Google Maps. No keyword "
        "sweep or Google deal search (those are area-wide: see sweep_only)",
    )
    sweep_only: bool = Field(
        False,
        description="Only the area-wide searches: the keyword sweep and the Google deal search, no shop channels. "
        "stores, if given, are the area's known shops, so their posts count as first-hand",
    )
    max_shops: int = Field(20, ge=1, le=60, description="Shops from Google Maps, split across the search terms")
    days: int = Field(14, ge=1, le=60, description="Only posts from the last N days")
    posts_per_shop: int = Field(6, ge=1, le=20, description="Newest posts per shop per platform")
    channels: list[Channel] = Field(default_factory=lambda: ["instagram", "tiktok", "facebook", "website"])
    sweep: bool = Field(True, description="Also search TikTok and Instagram hashtags for the area (second-hand posts)")
    hashtags: list[str] = Field(
        default_factory=list, max_length=8, description="Sweep hashtags. Default: <neighborhood>eats, food, deals + one per search term"
    )
    search_queries: list[str] = Field(
        default_factory=list, max_length=5, description="Sweep TikTok searches. Default: '<neighborhood> <term> deal' for the first 3 terms"
    )
    refresh_shops: bool = Field(False, description="Ignore the cached shop list for this area and search Google Maps again")
    google: bool = Field(
        True,
        description="Bright Data Google search: find shops' missing Instagram/TikTok/Facebook accounts, and recent deal "
        "posts in the area. Skipped when BRIGHTDATA_API_KEY isn't set",
    )

    @model_validator(mode="after")
    def _batch_size(self) -> "ShopsRequest":
        # A sweep only uses the shops for attribution; a batch scrapes each one, and its Actor runs must finish in 4 min.
        if not self.sweep_only and len(self.stores) > MAX_BATCH_STORES:
            raise ValueError(f"at most {MAX_BATCH_STORES} stores per batch (sweep_only takes up to {MAX_SWEEP_STORES})")
        return self


class DiscoverRequest(BaseModel):
    """Every shop within a circle, from Google Maps only (no posts, no Claude). Convex keeps the list per area."""

    location: Location = Field(default_factory=Location, description="Names the area and sets the timezone")
    lat: float = Field(ge=-90, le=90, examples=[34.0628])
    lng: float = Field(ge=-180, le=180, examples=[-118.4455])
    radius_miles: float = Field(1.0, gt=0, le=5)
    categories: list[Category] = Field(default_factory=list)
    search_terms: list[str] = Field(
        default_factory=list, max_length=12, description="Google Maps searches. Default: from categories, else food and drink"
    )
    max_shops: int = Field(250, ge=1, le=400, description="Nearest shops kept, across all search terms")
    per_term: int = Field(60, ge=1, le=120, description="Google Maps results per search term")


class DealSearchRequest(BaseModel):
    """Hybrid search over indexed deals: meaning (Jina) + keywords, filtered by status, distance and category."""

    query: str = Field("", description="Free text in any language, e.g. 'cheap haircut'. Empty: newest deals")
    lat: Optional[float] = None
    lng: Optional[float] = None
    radius_miles: float = Field(1.0, gt=0, le=25)
    categories: list[Category] = Field(default_factory=list)
    statuses: list[DealStatus] = Field(default_factory=lambda: [DealStatus.live, DealStatus.needs_check])
    limit: int = Field(20, ge=1, le=50)


class DealSearchResponse(BaseModel):
    deals: list[Deal]
    total: int


class AskRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=500)
    conversation_id: Optional[str] = Field(None, description="From a previous answer, to continue the chat")
    lat: Optional[float] = None
    lng: Optional[float] = None
    push_token: Optional[str] = Field(None, description="Expo push token, so the agent's watch tool can alert you")


class AskResponse(BaseModel):
    answer: str
    conversation_id: Optional[str] = None
    deal_ids: list[str] = Field(default_factory=list, description="Deals the agent's tools returned")
    deals: list[Deal] = Field(default_factory=list, description="Those deals in full, for cards in the app")


class WatchCheckRequest(BaseModel):
    """From the dibs-watch-matcher workflow: check one saved watch for new matching deals."""

    watch_id: str


class WatchCheckResponse(BaseModel):
    matched: list[str] = Field(default_factory=list, description="Deal ids pushed to the watch's device")
    sent: int = 0


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
