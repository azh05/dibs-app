"""Find shops on Google Maps, scrape each shop's own channels (website, Instagram, TikTok, Facebook) with Apify,
then extract and verify deals exactly like the Bright Data path.

1. Shops: Google Maps search for the area (cached per area for a week), each with the social links from its
   listing or website. In parallel, a keyword sweep (TikTok search + Instagram hashtags) finds posts by other
   accounts; shops they @mention are scraped too.
2. One Apify run per channel covering every shop, all channels in parallel.
3. Posts from a shop's own account are first-hand; everything else is second-hand (confidence low, never live).
"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
from collections import Counter
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Optional

import anthropic

from .apify import (
    ApifyAuthError,
    ApifyClient,
    ApifyError,
    ApifyTimeout,
    RunCounter,
    SocialPost,
    WebPage,
    facebook_page,
    site_host,
)
from .bd_pipeline import extract_docs, verify_docs
from .extractor import DEFAULT_MODEL, _today
from .schemas import Category, SearchRequest, SearchResponse, Shop, ShopsRequest
from .sources import combine, from_social, from_website
from .verify import normalize_url

log = logging.getLogger(__name__)

CATEGORY_TERMS: dict[Category, list[str]] = {
    Category.food: ["restaurant"],
    Category.drink: ["boba", "coffee shop"],
    Category.retail: ["store"],
    Category.entertainment: ["entertainment"],
    Category.other: [],
}
DEFAULT_TERMS = ["restaurant", "boba", "coffee shop"]
PAGES_PER_SITE = 4
SWEEP_TIKTOK_RESULTS = 20
SWEEP_HASHTAG_RESULTS = 15
MAX_MENTIONED_SHOPS = 5
CACHE_TTL = timedelta(days=7)
DEFAULT_CACHE = Path(__file__).resolve().parent.parent / ".cache" / "shops.json"
_SOCIAL_HOSTS = ("instagram.com", "facebook.com", "tiktok.com", "fb.com")


def search_terms(req: ShopsRequest) -> list[str]:
    if req.search_terms:
        return list(dict.fromkeys(t.strip() for t in req.search_terms if t.strip()))
    terms = [t for c in req.categories for t in CATEGORY_TERMS[c]]
    return list(dict.fromkeys(terms)) or DEFAULT_TERMS


def area(req: ShopsRequest) -> str:
    loc = req.location
    return ", ".join(p for p in (loc.neighborhood, loc.city, loc.region) if p)


def sweep_targets(req: ShopsRequest, terms: list[str]) -> tuple[list[str], list[str]]:
    """(TikTok searches, Instagram hashtags) for the keyword sweep."""
    place = req.location.neighborhood or req.location.city
    queries = req.search_queries or [f"{place} {terms[0]} deal" if terms else f"{place} deals"]
    tag = re.sub(r"[^a-z0-9]", "", place.lower())
    hashtags = [h.lstrip("#").lower() for h in req.hashtags] or [f"{tag}eats", f"{tag}food"]
    return queries, hashtags


class ShopCache:
    """Google Maps results per area, in a JSON file, so repeat runs only pay for the post scrapes."""

    def __init__(self, path: Optional[Path] = DEFAULT_CACHE, ttl: timedelta = CACHE_TTL, clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc)):
        self.path = path
        self.ttl = ttl
        self.clock = clock
        self._lock = threading.Lock()

    @staticmethod
    def key(req: ShopsRequest, terms: list[str]) -> str:
        loc = req.location
        what = "named:" + ",".join(sorted(s.lower() for s in req.shops)) if req.shops else ",".join(sorted(t.lower() for t in terms))
        return f"{loc.country}|{loc.region}|{loc.city}|{loc.neighborhood or ''}|{what}|{req.max_shops}".lower()

    def _load(self) -> dict[str, Any]:
        try:
            return json.loads(self.path.read_text()) if self.path and self.path.exists() else {}
        except (OSError, ValueError):
            log.warning("shop cache %s unreadable; ignoring it", self.path)
            return {}

    def get(self, key: str) -> Optional[list[Shop]]:
        if self.path is None:
            return None
        with self._lock:
            entry = self._load().get(key)
        if not entry:
            return None
        try:
            saved = datetime.fromisoformat(entry["saved_at"])
            if self.clock() - saved > self.ttl:
                return None
            return [Shop.model_validate(s) for s in entry["shops"]]
        except (KeyError, ValueError, TypeError):
            return None

    def put(self, key: str, shops: list[Shop]) -> None:
        if self.path is None:
            return
        with self._lock:
            data = self._load()
            data[key] = {"saved_at": self.clock().isoformat(), "shops": [s.model_dump() for s in shops]}
            try:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                self.path.write_text(json.dumps(data, indent=1))
            except OSError:
                log.warning("couldn't write shop cache %s", self.path)


def _cache_from_env() -> ShopCache:
    path = os.getenv("DIBS_SHOP_CACHE")
    if path is not None and path.strip().lower() in ("", "off", "none"):
        return ShopCache(None)
    return ShopCache(Path(path) if path else DEFAULT_CACHE)


def mentioned_shops(posts: list[SocialPost], known: set[str], limit: int = MAX_MENTIONED_SHOPS) -> list[Shop]:
    """Accounts the sweep posts @mention most, that aren't already shops. Influencers tag the shop they review."""
    counts: Counter[tuple[str, str]] = Counter()
    for p in posts:
        for m in p.mentions:
            if m not in known and m != p.handle:
                counts[(p.platform, m)] += 1
    shops: dict[str, Shop] = {}
    for (platform, handle), _n in counts.most_common():
        if handle not in shops and len(shops) >= limit:
            continue
        shop = shops.setdefault(handle, Shop(name=f"@{handle}", found_via="mention"))
        if platform == "instagram":
            shop.instagram = handle
        elif platform == "tiktok":
            shop.tiktok = handle
    return list(shops.values())


class ShopPipeline:
    def __init__(
        self,
        apify: Optional[ApifyClient] = None,
        anthropic_client: Optional[anthropic.Anthropic] = None,
        model: str = DEFAULT_MODEL,
        cache: Optional[ShopCache] = None,
    ):
        self.apify = apify or ApifyClient()
        self._anthropic = anthropic_client
        self.model = model
        self.cache = cache if cache is not None else _cache_from_env()

    @property
    def anthropic(self) -> Any:
        if self._anthropic is None:
            self._anthropic = anthropic.Anthropic()
        return self._anthropic

    def check_ready(self) -> None:
        """Fail fast (before queueing a slow job) if the Apify token is missing."""
        self.apify.require_token()

    # --- steps -------------------------------------------------------------------------

    def _find_shops(self, req: ShopsRequest, terms: list[str], errors: list[str], counter: RunCounter, progress) -> list[Shop]:
        key = ShopCache.key(req, terms)
        if not req.refresh_shops and (cached := self.cache.get(key)) is not None:
            progress(f"using {len(cached)} cached shop(s) for {area(req)}")
            return cached
        if req.shops:
            found = self.apify.find_shops(req.shops, area(req), 1, errors, counter, found_via="named")
        else:
            per_term = -(-req.max_shops // len(terms))  # ceil
            found = self.apify.find_shops(terms, area(req), per_term, errors, counter)
        shops = found[: req.max_shops]
        progress(f"found {len(shops)} shop(s) on Google Maps")
        if shops:
            self.cache.put(key, shops)
        return shops

    def _sweep(self, req: ShopsRequest, terms: list[str], since: date, errors: list[str], counter: RunCounter, pool: ThreadPoolExecutor):
        queries, hashtags = sweep_targets(req, terms)
        futures: dict[str, Future] = {}
        if "tiktok" in req.channels:
            futures["tiktok search"] = pool.submit(self.apify.tiktok_search, queries, SWEEP_TIKTOK_RESULTS, errors, counter)
        if "instagram" in req.channels:
            futures["instagram hashtags"] = pool.submit(
                self.apify.instagram_hashtags, hashtags, since, SWEEP_HASHTAG_RESULTS, errors, counter
            )
        labels = [f"tiktok: {q}" for q in queries if "tiktok search" in futures]
        labels += [f"#{h}" for h in hashtags if "instagram hashtags" in futures]
        return futures, labels

    def _collect(self, name: str, fut: Future, errors: list[str], progress) -> list:
        try:
            items = fut.result()
        except ApifyAuthError:
            raise
        except ApifyError as exc:
            errors.append(f"{name} failed: {exc}")
            progress(f"{name}: failed")
            return []
        progress(f"{name}: {len(items)} item(s)")
        return items

    def _channel(self, fn: Callable[[], list]) -> list:
        """One retry for transient failures; a bad token or a timeout (already 4 minutes) is not retried."""
        try:
            return fn()
        except (ApifyAuthError, ApifyTimeout):
            raise
        except ApifyError as exc:
            log.warning("retrying Apify run once: %s", exc)
            return fn()

    def run(self, req: ShopsRequest, on_progress: Optional[Callable[[str], None]] = None, today: Optional[date] = None) -> SearchResponse:
        progress = on_progress or (lambda _msg: None)
        self.check_ready()
        tz = req.location.timezone
        today = today or _today(tz)
        since = today - timedelta(days=req.days)
        terms = search_terms(req)
        counter = RunCounter()
        errors: list[str] = []
        n = req.posts_per_shop
        # Profiles can return old pinned posts, and TikTok search has no date filter, so check dates here too.
        recent = lambda p: p.posted_at is None or p.posted_at.astimezone(timezone.utc).date() >= since - timedelta(days=1)

        with ThreadPoolExecutor(max_workers=6) as pool:
            # Step 1: shops and the keyword sweep at the same time.
            sweep_futures, sweep_labels = self._sweep(req, terms, since, errors, counter, pool) if req.sweep else ({}, [])
            shops = self._find_shops(req, terms, errors, counter, progress)
            sweep_posts: list[SocialPost] = []
            for name, fut in sweep_futures.items():
                sweep_posts += self._collect(name, fut, errors, progress)

            known = {h for s in shops for h in (s.instagram, s.tiktok) if h}
            # Only recent posts: live, 20 of 20 TikTok search results were months old.
            extra = mentioned_shops([p for p in sweep_posts if recent(p)], known)
            if extra:
                progress(f"adding {len(extra)} account(s) the sweep posts mention: " + ", ".join(s.name for s in extra))
            all_shops = shops + extra

            # Step 2: one run per channel, all shops at once.
            ig = list(dict.fromkeys(s.instagram for s in all_shops if s.instagram))
            tt = list(dict.fromkeys(s.tiktok for s in all_shops if s.tiktok))
            fb = list(dict.fromkeys(s.facebook for s in all_shops if s.facebook))
            sites = list(dict.fromkeys(
                s.website for s in all_shops if s.website and not (site_host(s.website) or "").endswith(_SOCIAL_HOSTS)
            ))
            jobs: dict[str, Callable[[], list]] = {}
            if "instagram" in req.channels and ig:
                jobs["instagram"] = lambda: self.apify.instagram_posts(ig, since, n, errors, counter)
            if "tiktok" in req.channels and tt:
                jobs["tiktok"] = lambda: self.apify.tiktok_videos(tt, since, n, errors, counter)
            if "facebook" in req.channels and fb:
                jobs["facebook"] = lambda: self.apify.facebook_posts(fb, since, n, errors, counter)
            if "website" in req.channels and sites:
                jobs["website"] = lambda: self.apify.website_pages(sites, PAGES_PER_SITE, errors, counter)
            if not jobs and not sweep_posts:
                errors.append("no shop had a website or social account to scrape")
            progress("scraping " + (", ".join(jobs) or "nothing") + f" for {len(all_shops)} shop(s)")
            futures = {name: pool.submit(self._channel, fn) for name, fn in jobs.items()}
            results = {name: self._collect(name, fut, errors, progress) for name, fut in futures.items()}

        posts: list[SocialPost] = results.get("instagram", []) + results.get("tiktok", []) + results.get("facebook", [])
        pages: list[WebPage] = results.get("website", [])
        own, shop_of = self._attribute(all_shops, posts + sweep_posts)
        dropped = [p for p in posts + sweep_posts if not recent(p)]
        if dropped:
            errors.append(f"dropped {len(dropped)} post(s) older than {req.days} days")

        # Shop's own posts first, so they survive the prompt budget; second-hand sweep posts last.
        first_hand = [p for p in posts + sweep_posts if recent(p) and p.url in own]
        second_hand = [p for p in posts + sweep_posts if recent(p) and p.url not in own]
        host_of = {site_host(s.website): s.name for s in all_shops if s.website and site_host(s.website)}
        docs = combine(from_social(first_hand, shop_of, tz), from_website(pages, host_of), from_social(second_hand, shop_of, tz))

        context = SearchRequest(location=req.location, radius_miles=req.radius_miles, categories=req.categories)
        raw, usage = extract_docs(self.anthropic, self.model, docs, context, today, errors, progress, provider_name="Apify")
        sources, deals, rejected = verify_docs(docs, raw, today)
        own_keys = {normalize_url(u) for u in own}
        for d in deals:
            if normalize_url(d.source_url) in own_keys:
                d.flags.append("shop_own_post")
        queries = [f"maps: {t}" for t in (req.shops or terms)] + sweep_labels
        return SearchResponse(
            as_of=today,
            deals=deals,
            rejected=rejected,
            queries=queries,
            sources=sources,
            search_errors=errors,
            usage=usage,
            provider="apify_shops",
            apify_runs=counter.count,
            shops=all_shops,
        )

    @staticmethod
    def _attribute(shops: list[Shop], posts: list[SocialPost]) -> tuple[set[str], dict[str, str]]:
        """Which posts came from a shop's own account: (their URLs, URL -> shop name)."""
        ig = {s.instagram: s.name for s in shops if s.instagram}
        tt = {s.tiktok: s.name for s in shops if s.tiktok}
        fb = {s.facebook: s.name for s in shops if s.facebook}
        shop_of: dict[str, str] = {}
        for p in posts:
            name = None
            if p.platform == "instagram":
                name = ig.get(p.handle or "") or next((ig[c] for c in p.coauthors if c in ig), None)
            elif p.platform == "tiktok":
                name = tt.get(p.handle or "")
            elif p.platform == "facebook" and p.input_url:
                name = fb.get(facebook_page(p.input_url) or "")
            if name:
                shop_of[p.url] = name
        return set(shop_of), shop_of
