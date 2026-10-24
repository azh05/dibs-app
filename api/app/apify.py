"""Apify client: Google Maps (find shops + their social links), Instagram, TikTok, Facebook and website scrapers.

Each scrape is one synchronous Actor run (run-sync-get-dataset-items, capped at 300 s by Apify). Inputs and
output fields follow each Actor's public README; parsing is defensive because Actors add and rename fields.
"""
from __future__ import annotations

import logging
import os
import re
import threading
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any, Callable, Iterable, Optional
from urllib.parse import urlsplit, urlunsplit

import httpx

from .schemas import Shop

log = logging.getLogger(__name__)

API_BASE = "https://api.apify.com/v2"
MAPS_ACTOR = "compass~crawler-google-places"
INSTAGRAM_ACTOR = "apify~instagram-scraper"
INSTAGRAM_HASHTAG_ACTOR = "apify~instagram-hashtag-scraper"
TIKTOK_ACTOR = "clockworks~tiktok-scraper"
FACEBOOK_ACTOR = "apify~facebook-posts-scraper"
WEBSITE_ACTOR = "apify~website-content-crawler"

RUN_TIMEOUT_S = 240  # Actor run limit; the sync endpoint itself gives up at 300 s
HTTP_TIMEOUT_S = 310
# Pages worth reading on a shop's site, besides its home page.
WEBSITE_KEYWORDS = ("deal", "special", "promo", "offer", "happy", "menu", "event", "news", "student", "discount", "sale", "coupon")


class ApifyError(Exception):
    """Any Apify failure we can't recover from."""


class ApifyAuthError(ApifyError):
    """APIFY_TOKEN missing or invalid."""


class ApifyTimeout(ApifyError):
    """The Actor run didn't finish within the sync endpoint's limit."""


@dataclass
class SocialPost:
    platform: str  # instagram | tiktok | facebook
    url: str
    handle: Optional[str]  # author account (Facebook: page name)
    text: str
    posted_at: Optional[datetime]  # UTC
    mentions: list[str] = field(default_factory=list)
    coauthors: list[str] = field(default_factory=list)
    input_url: Optional[str] = None  # Facebook: the page URL we asked for, to attribute the post to a shop


@dataclass
class WebPage:
    url: str
    title: Optional[str]
    text: str


class RunCounter:
    """Counts Actor runs for one API request (thread-safe; channels run in parallel)."""

    def __init__(self) -> None:
        self.count = 0
        self._lock = threading.Lock()

    def add(self) -> None:
        with self._lock:
            self.count += 1


# --- link parsing --------------------------------------------------------------------

_IG_RESERVED = {"p", "reel", "reels", "tv", "explore", "stories", "accounts", "direct", "share"}
_FB_RESERVED = {"sharer", "sharer.php", "plugins", "tr", "dialog", "share", "login", "groups", "events", "watch"}
_HANDLE = re.compile(r"^[A-Za-z0-9._]{1,30}$")


def instagram_handle(url: str) -> Optional[str]:
    """'https://www.instagram.com/Milksha_CA/?hl=en' -> 'milksha_ca'. None for post links and non-profile URLs."""
    parts = urlsplit(url if "//" in url else "https://" + url)
    if not (parts.hostname or "").endswith("instagram.com"):
        return None
    first = parts.path.strip("/").split("/")[0].lstrip("@")
    return first.lower() if first and first.lower() not in _IG_RESERVED and _HANDLE.match(first) else None


def tiktok_handle(url: str) -> Optional[str]:
    """'https://www.tiktok.com/@milksha.ca?lang=en' -> 'milksha.ca'."""
    parts = urlsplit(url if "//" in url else "https://" + url)
    if not (parts.hostname or "").endswith("tiktok.com"):
        return None
    first = parts.path.strip("/").split("/")[0]
    if not first.startswith("@"):
        return None
    name = first[1:]
    return name.lower() if _HANDLE.match(name) else None


def facebook_page(url: str) -> Optional[str]:
    """Canonical page URL without query string, or None for share/login/plugin links."""
    parts = urlsplit(url if "//" in url else "https://" + url)
    host = (parts.hostname or "").lower()
    if not (host == "facebook.com" or host.endswith(".facebook.com") or host == "fb.com"):
        return None
    path = parts.path.strip("/")
    first = path.split("/")[0].lower()
    if not path or first in _FB_RESERVED:
        return None
    if first == "profile.php":
        return urlunsplit(("https", "www.facebook.com", "/profile.php", parts.query, ""))
    return f"https://www.facebook.com/{path.split('/')[0]}/"


def site_host(url: Optional[str]) -> Optional[str]:
    if not url:
        return None
    host = urlsplit(url if "//" in url else "https://" + url).hostname
    return host.lower().removeprefix("www.") if host else None


def _first(values: Any, parse: Callable[[str], Optional[str]]) -> Optional[str]:
    for v in values if isinstance(values, list) else [values]:
        if isinstance(v, str) and (parsed := parse(v)):
            return parsed
    return None


def _parse_time(value: Any) -> Optional[datetime]:
    if isinstance(value, (int, float)) and value > 0:
        return datetime.fromtimestamp(value, tz=timezone.utc)
    if not isinstance(value, str) or not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _names(values: Any) -> list[str]:
    """Mentions/coauthors arrive as ['@a', 'b'] or [{'username': 'a'}] depending on the Actor."""
    out: list[str] = []
    for v in values or []:
        name = v.get("username") or v.get("name") if isinstance(v, dict) else v
        if isinstance(name, str) and (name := name.strip().lstrip("@").lower()) and _HANDLE.match(name):
            out.append(name)
    return list(dict.fromkeys(out))


def _rows(items: Iterable[Any], errors: list[str], what: str) -> list[dict[str, Any]]:
    """Drop the error rows Actors emit for profiles they couldn't read, noting each one."""
    kept = []
    for row in items:
        if not isinstance(row, dict):
            continue
        if row.get("error") or row.get("errorDescription"):
            target = row.get("url") or row.get("inputUrl") or row.get("username") or "?"
            errors.append(f"{what}: {target}: {row.get('errorDescription') or row.get('error')}")
            continue
        kept.append(row)
    return kept


# --- parsers (one per Actor's output) ------------------------------------------------

def parse_places(items: Iterable[Any], errors: list[str], found_via: str = "google_maps") -> list[Shop]:
    shops: list[Shop] = []
    seen: set[str] = set()
    for row in _rows(items, errors, "google maps"):
        name = (row.get("title") or "").strip()
        if not name or row.get("permanentlyClosed"):
            continue
        key = row.get("placeId") or f"{name}|{row.get('address')}"
        if key in seen:
            continue
        seen.add(key)
        website = row.get("website") or None
        shops.append(
            Shop(
                name=name,
                address=row.get("address"),
                category=row.get("categoryName"),
                maps_url=row.get("url"),
                website=website,
                instagram=_first(row.get("instagrams"), instagram_handle) or (instagram_handle(website) if website else None),
                tiktok=_first(row.get("tiktoks"), tiktok_handle),
                facebook=_first(row.get("facebooks"), facebook_page),
                found_via=found_via,
            )
        )
    return shops


def parse_instagram(items: Iterable[Any], errors: list[str]) -> list[SocialPost]:
    posts = []
    for row in _rows(items, errors, "instagram"):
        url = row.get("url")
        if not url:
            continue
        caption = row.get("caption") or ""
        alt = row.get("alt")
        posts.append(
            SocialPost(
                platform="instagram",
                url=url,
                handle=(row.get("ownerUsername") or "").lower() or None,
                text=caption + (f"\n[image text] {alt}" if alt and alt not in caption else ""),
                posted_at=_parse_time(row.get("timestamp")),
                mentions=_names(row.get("mentions")),
                coauthors=_names(row.get("coauthorProducers")),
            )
        )
    return posts


def parse_tiktok(items: Iterable[Any], errors: list[str]) -> list[SocialPost]:
    posts = []
    for row in _rows(items, errors, "tiktok"):
        url = row.get("webVideoUrl")
        if not url:
            continue
        author = row.get("authorMeta") or {}
        posts.append(
            SocialPost(
                platform="tiktok",
                url=url,
                handle=(author.get("name") or "").lower() or None,
                text=row.get("text") or "",
                posted_at=_parse_time(row.get("createTimeISO") or row.get("createTime")),
                mentions=_names(row.get("mentions")),
            )
        )
    return posts


def parse_facebook(items: Iterable[Any], errors: list[str]) -> list[SocialPost]:
    posts = []
    for row in _rows(items, errors, "facebook"):
        url = row.get("url") or row.get("topLevelUrl")
        if not url:
            continue
        text = row.get("text") or ""
        # Posters are often just an image: the Actor's OCR text is where the deal is.
        ocr = [m.get("ocrText") for m in row.get("media") or [] if isinstance(m, dict) and m.get("ocrText")]
        ocr = [o for o in ocr if not o.lower().startswith("may be ")]  # Facebook's generic alt text, not OCR
        if ocr:
            text += "\n[image text] " + "\n".join(ocr)
        user = row.get("user") or {}
        posts.append(
            SocialPost(
                platform="facebook",
                url=url,
                handle=row.get("pageName") or user.get("name"),
                text=text,
                posted_at=_parse_time(row.get("time") or row.get("timestamp")),
                input_url=row.get("facebookUrl") or row.get("inputUrl"),
            )
        )
    return posts


def parse_pages(items: Iterable[Any], errors: list[str]) -> list[WebPage]:
    pages = []
    for row in _rows(items, errors, "website"):
        url = row.get("url")
        text = row.get("text") or row.get("markdown") or ""
        if url and text.strip():
            pages.append(WebPage(url=url, title=(row.get("metadata") or {}).get("title"), text=text))
    return pages


# --- client --------------------------------------------------------------------------

class ApifyClient:
    def __init__(self, token: Optional[str] = None, http: Optional[httpx.Client] = None, run_timeout_s: int = RUN_TIMEOUT_S):
        self.token = token or os.getenv("APIFY_TOKEN") or os.getenv("APIFY_API_TOKEN")
        self.http = http or httpx.Client(timeout=HTTP_TIMEOUT_S)
        self.run_timeout_s = run_timeout_s

    def require_token(self) -> None:
        if not self.token:
            raise ApifyAuthError("APIFY_TOKEN is not set")

    def run(self, actor: str, actor_input: dict[str, Any], max_items: int, counter: Optional[RunCounter] = None) -> list[Any]:
        """Run an Actor and return its dataset items. max_items caps what pay-per-result Actors bill."""
        self.require_token()
        if counter is not None:
            counter.add()
        try:
            resp = self.http.post(
                f"{API_BASE}/acts/{actor}/run-sync-get-dataset-items",
                params={"timeout": self.run_timeout_s, "maxItems": max_items, "format": "json", "clean": "true"},
                headers={"Authorization": f"Bearer {self.token}"},
                json=actor_input,
            )
        except httpx.TimeoutException as exc:
            raise ApifyTimeout(f"{actor} timed out") from exc
        except httpx.HTTPError as exc:
            raise ApifyError(f"{actor}: {exc}") from exc
        if resp.status_code in (401, 403):
            raise ApifyAuthError(f"Apify rejected APIFY_TOKEN: HTTP {resp.status_code}")
        if resp.status_code == 408:
            raise ApifyTimeout(f"{actor} didn't finish within {self.run_timeout_s} s")
        if resp.status_code >= 400:
            raise ApifyError(f"{actor}: HTTP {resp.status_code}: {_error_message(resp)}")
        try:
            data = resp.json()
        except ValueError as exc:
            raise ApifyError(f"{actor} returned something that isn't JSON") from exc
        if not isinstance(data, list):
            raise ApifyError(f"{actor} returned {type(data).__name__}, expected a list of items")
        return data

    # --- one method per Actor ----------------------------------------------------------

    def find_shops(
        self, terms: list[str], location: str, per_term: int, errors: list[str], counter: Optional[RunCounter] = None,
        found_via: str = "google_maps",
    ) -> list[Shop]:
        items = self.run(
            MAPS_ACTOR,
            {
                "searchStringsArray": terms,
                "locationQuery": location,
                "maxCrawledPlacesPerSearch": per_term,
                "language": "en",
                "skipClosedPlaces": True,
                "scrapeContacts": True,  # Instagram/Facebook/TikTok links read from each shop's website
                "scrapePlaceDetailPage": False,
                "maxReviews": 0,
                "maxImages": 0,
            },
            max_items=per_term * len(terms),
            counter=counter,
        )
        return parse_places(items, errors, found_via)

    def instagram_posts(
        self, handles: list[str], since: date, per_profile: int, errors: list[str], counter: Optional[RunCounter] = None
    ) -> list[SocialPost]:
        items = self.run(
            INSTAGRAM_ACTOR,
            {
                "directUrls": [f"https://www.instagram.com/{h}/" for h in handles],
                "resultsType": "posts",  # the posts feed includes reels (type "Video")
                "resultsLimit": per_profile,
                "onlyPostsNewerThan": since.isoformat(),
                "addParentData": False,
            },
            max_items=per_profile * len(handles),
            counter=counter,
        )
        return parse_instagram(items, errors)

    def instagram_hashtags(
        self, hashtags: list[str], since: date, limit: int, errors: list[str], counter: Optional[RunCounter] = None
    ) -> list[SocialPost]:
        items = self.run(
            INSTAGRAM_HASHTAG_ACTOR,
            {"hashtags": hashtags, "resultsType": "posts", "resultsLimit": limit, "onlyPostsNewerThan": since.isoformat()},
            max_items=limit * len(hashtags),
            counter=counter,
        )
        return parse_instagram(items, errors)

    def tiktok_videos(
        self, profiles: list[str], since: date, per_profile: int, errors: list[str], counter: Optional[RunCounter] = None
    ) -> list[SocialPost]:
        items = self.run(
            TIKTOK_ACTOR,
            {
                "profiles": profiles,
                "profileSorting": "latest",
                "excludePinnedPosts": False,
                "resultsPerPage": per_profile,
                "oldestPostDateUnified": since.isoformat(),
                "shouldDownloadVideos": False,
                "shouldDownloadCovers": False,
                "shouldDownloadSubtitles": False,
            },
            max_items=per_profile * len(profiles),
            counter=counter,
        )
        return parse_tiktok(items, errors)

    def tiktok_search(
        self, queries: list[str], limit: int, errors: list[str], counter: Optional[RunCounter] = None
    ) -> list[SocialPost]:
        items = self.run(
            TIKTOK_ACTOR,
            {
                "searchQueries": queries,
                "resultsPerPage": limit,
                "shouldDownloadVideos": False,
                "shouldDownloadCovers": False,
                "shouldDownloadSubtitles": False,
            },
            max_items=limit * len(queries),
            counter=counter,
        )
        return parse_tiktok(items, errors)

    def facebook_posts(
        self, pages: list[str], since: date, per_page: int, errors: list[str], counter: Optional[RunCounter] = None
    ) -> list[SocialPost]:
        items = self.run(
            FACEBOOK_ACTOR,
            {"startUrls": [{"url": p} for p in pages], "resultsLimit": per_page, "onlyPostsNewerThan": since.isoformat()},
            max_items=per_page * len(pages),
            counter=counter,
        )
        return parse_facebook(items, errors)

    def website_pages(
        self, sites: list[str], pages_per_site: int, errors: list[str], counter: Optional[RunCounter] = None
    ) -> list[WebPage]:
        """Each site's home page plus linked pages whose URL looks deal-related (one level deep)."""
        globs = []
        for site in sites:
            parts = urlsplit(site)
            origin = f"{parts.scheme or 'https'}://{parts.netloc}"
            globs += [{"glob": f"{origin}/**{kw}**"} for kw in WEBSITE_KEYWORDS]
        limit = pages_per_site * len(sites)
        items = self.run(
            WEBSITE_ACTOR,
            {
                "startUrls": [{"url": s} for s in sites],
                # Adaptive: plain HTTP when that works, a real browser for JS-built sites (live, a Wix-style
                # shop site gave cheerio no text at all).
                "crawlerType": "playwright:adaptive",
                "maxRequestRetries": 2,  # default 10 spent 100 s on one dead site (HTTP 502)
                "maxCrawlDepth": 1,
                "maxCrawlPages": limit,
                "includeUrlGlobs": globs,
                "saveMarkdown": False,
                "removeCookieWarnings": True,
            },
            max_items=limit,
            counter=counter,
        )
        return parse_pages(items, errors)


def _error_message(resp: httpx.Response) -> str:
    try:
        err = resp.json().get("error") or {}
        return err.get("message") or err.get("type") or resp.text[:200]
    except (ValueError, AttributeError):
        return resp.text[:200]
