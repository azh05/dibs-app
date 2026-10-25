"""Find shops on Google Maps, scrape each shop's own channels (website, Instagram, TikTok, Facebook) with Apify,
then extract and verify deals exactly like the Bright Data path.

1. Shops: Google Maps search for the area (cached per area for a week), each with the social links from its
   listing or website. In parallel, a keyword sweep (TikTok search + Instagram hashtags) finds posts by other
   accounts; shops they @mention are scraped too.
2. One Apify run per channel covering every shop, all channels in parallel.
3. Posts from a shop's own account are first-hand. Everything else (creators, food blogs) is second-hand: still
   recorded, at most medium confidence, and flagged `second_hand` so the app can show it as less verified.
"""
from __future__ import annotations

import json
import logging
import math
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
from .bd_pipeline import extract_docs_batched, verify_docs
from .brightdata import BrightDataClient, BrightDataError
from .extractor import DEFAULT_MODEL, _today
from .google_lookup import GoogleFindings, GoogleLookup
from .linking import link_deals
from .schemas import Category, DiscoverRequest, SearchRequest, SearchResponse, Shop, ShopsRequest, Usage
from .sources import combine, from_serp, from_social, from_website
from .verify import normalize_url

log = logging.getLogger(__name__)

# Google Maps searches per section. More terms = more distinct shops (each term's results are capped).
CATEGORY_TERMS: dict[Category, list[str]] = {
    Category.food: ["restaurant", "fast food", "pizza", "dessert"],
    Category.drink: ["boba", "coffee shop", "juice bar"],
    Category.retail: ["clothing store", "thrift store", "bookstore"],
    Category.entertainment: ["bowling alley", "karaoke", "movie theater"],
    Category.beauty: ["barbershop", "hair salon", "nail salon"],
    Category.fitness: ["gym", "boxing gym", "yoga studio"],
    Category.other: [],
}
DEFAULT_TERMS = CATEGORY_TERMS[Category.food] + CATEGORY_TERMS[Category.drink]
PAGES_PER_SITE = 2  # live, 12 sites x 4 pages ran past the 4 min limit
SWEEP_QUERY_TERMS = 3  # TikTok searches for the first N terms
SWEEP_TIKTOK_RESULTS = 15  # search has no date filter: live, 82 of 90 results were too old
SWEEP_HASHTAG_RESULTS = 25
MAX_MENTIONED_SHOPS = 15
DISCOVER_PARALLEL = 3  # Maps runs at once in /discover/shops (2 GB each), leaving Apify memory for deal scans
KM_PER_MILE = 1.609344
CACHE_TTL = timedelta(days=7)
DEFAULT_CACHE = Path(__file__).resolve().parent.parent / ".cache" / "shops.json"
_SOCIAL_HOSTS = ("instagram.com", "facebook.com", "tiktok.com", "fb.com")


def search_terms(req: ShopsRequest | DiscoverRequest) -> list[str]:
    if req.search_terms:
        return list(dict.fromkeys(t.strip() for t in req.search_terms if t.strip()))
    terms = [t for c in req.categories for t in CATEGORY_TERMS[c]]
    return list(dict.fromkeys(terms)) or DEFAULT_TERMS


def area(req: ShopsRequest | DiscoverRequest) -> str:
    loc = req.location
    return ", ".join(p for p in (loc.neighborhood, loc.city, loc.region) if p)


def sweep_targets(req: ShopsRequest, terms: list[str]) -> tuple[list[str], list[str]]:
    """(TikTok searches, Instagram hashtags) for the keyword sweep."""
    place = req.location.neighborhood or req.location.city
    queries = req.search_queries or [f"{place} {t} deal" for t in terms[:SWEEP_QUERY_TERMS]] or [f"{place} deals"]
    squash = lambda text: re.sub(r"[^a-z0-9]", "", text.lower())
    tag = squash(place)
    default_tags = [f"{tag}eats", f"{tag}food", f"{tag}deals"] + [f"{tag}{squash(t)}" for t in terms[:SWEEP_QUERY_TERMS]]
    hashtags = [h.lstrip("#").lower() for h in req.hashtags] or list(dict.fromkeys(default_tags))[:8]
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


def distance_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    rad = math.pi / 180
    h = math.sin((lat2 - lat1) * rad / 2) ** 2 + math.cos(lat1 * rad) * math.cos(lat2 * rad) * math.sin((lng2 - lng1) * rad / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


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
        bd: Optional[BrightDataClient] = None,
    ):
        """bd: Bright Data for the Google steps (account lookup, deal search); None skips them."""
        self.apify = apify or ApifyClient()
        self.bd = bd
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

    def _google_deals(self, google: GoogleLookup, req: ShopsRequest, terms: list[str], since: date, errors: list[str]) -> GoogleFindings:
        try:
            return google.find_deals(req, terms, since, errors)
        except BrightDataError as exc:  # incl. a rejected key: Apify still covers the run
            errors.append(f"Bright Data Google deal search skipped: {exc}")
            return GoogleFindings()

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

        google = GoogleLookup(self.bd) if self.bd is not None and req.google else None

        with ThreadPoolExecutor(max_workers=7) as pool:
            # Step 1: shops, the keyword sweep and the Google deal search at the same time.
            sweep_futures, sweep_labels = self._sweep(req, terms, since, errors, counter, pool) if req.sweep else ({}, [])
            google_future = pool.submit(self._google_deals, google, req, terms, since, errors) if google else None
            shops = self._find_shops(req, terms, errors, counter, progress)
            if google:
                # Maps only knows the links a shop listed; Google usually shows the rest.
                try:
                    added = google.fill_accounts(shops, req, errors)
                except BrightDataError as exc:
                    added = []
                    errors.append(f"Bright Data account lookup skipped: {exc}")
                if added:
                    progress(f"Google found {len(added)} missing account(s): " + "; ".join(added))
                    self.cache.put(ShopCache.key(req, terms), shops)  # next run skips these lookups
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
            found = google_future.result() if google_future else GoogleFindings()
            if google_future:
                progress(f"google: {len(found.posts)} Instagram post(s) fetched in full, {len(found.snippets)} other result(s)")

        posts: list[SocialPost] = results.get("instagram", []) + results.get("tiktok", []) + results.get("facebook", [])
        sweep_posts += found.posts  # Instagram posts Google surfaced: first-hand when a shop posted them
        pages: list[WebPage] = results.get("website", [])
        own, shop_of = self._attribute(all_shops, posts + sweep_posts)
        dropped = [p for p in posts + sweep_posts if not recent(p)]
        if dropped:
            errors.append(f"dropped {len(dropped)} post(s) older than {req.days} days")

        # Shop's own posts first, so they survive the prompt budget; second-hand sweep posts last.
        first_hand = [p for p in posts + sweep_posts if recent(p) and p.url in own]
        second_hand = [p for p in posts + sweep_posts if recent(p) and p.url not in own]
        host_of = {site_host(s.website): s.name for s in all_shops if s.website and site_host(s.website)}
        docs = combine(
            from_social(first_hand, shop_of, tz),
            from_website(pages, host_of),
            from_social(second_hand, shop_of, tz),
            from_serp(found.snippets),  # Google snippets last: short and second-hand
        )

        context = SearchRequest(
            location=req.location,
            radius_miles=req.radius_miles,
            categories=req.categories,
            query="Shops were found by searching Google Maps for: " + ", ".join(req.shops or terms),
        )
        raw, usage = extract_docs_batched(self.anthropic, self.model, docs, context, today, errors, progress, provider_name="Apify")
        sources, deals, rejected = verify_docs(docs, raw, today)
        all_shops = link_deals(deals, docs, all_shops)
        # Own post: from a shop's own channel, or posted by the account of the shop the deal is linked to (a shop
        # Google's deal search found, e.g. a cafe's own grand-opening post, isn't on the list until linking).
        own_keys = {normalize_url(d.url) for d in docs if d.shop}
        author = {normalize_url(d.url): (d.handle or "").lower() for d in docs}
        handles = {s.id: {(s.instagram or "").lower(), (s.tiktok or "").lower()} - {""} for s in all_shops}
        for d in deals:
            key = normalize_url(d.source_url)
            own = key in own_keys or author.get(key, "") in handles.get(d.shop_id, set())
            d.flags.append("shop_own_post" if own else "second_hand")
        queries = [f"maps: {t}" for t in (req.shops or terms)] + sweep_labels + found.labels
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
            brightdata_requests=google.counter.count if google else 0,
            shops=all_shops,
        )

    def discover(self, req: DiscoverRequest, on_progress: Optional[Callable[[str], None]] = None) -> SearchResponse:
        """Every shop in the circle from Google Maps, nearest first. One Actor run per search term (each capped at
        per_term results), so a big area stays inside the 4 minute run limit. No posts and no Claude."""
        progress = on_progress or (lambda _msg: None)
        self.check_ready()
        terms = search_terms(req)
        radius_km = req.radius_miles * KM_PER_MILE
        counter = RunCounter()
        errors: list[str] = []
        name = area(req)
        found: dict[str, list[Shop]] = {}
        with ThreadPoolExecutor(max_workers=DISCOVER_PARALLEL) as pool:
            futures = {
                t: pool.submit(
                    self._channel,
                    lambda t=t: self.apify.find_shops([t], name, req.per_term, errors, counter, near=(req.lat, req.lng, radius_km)),
                )
                for t in terms
            }
            failed: list[str] = []
            for t, fut in futures.items():
                try:
                    found[t] = fut.result()
                except ApifyAuthError:
                    raise
                except ApifyError as exc:  # incl. a timeout: the other terms still count
                    failed.append(f"maps: {t} failed: {exc}")
                    found[t] = []
                    progress(f"maps: {t}: failed")
                    continue
                progress(f"maps: {t}: {len(found[t])} place(s)")
        if len(failed) == len(terms):
            raise ApifyError("every Google Maps search failed: " + "; ".join(failed[:3]))
        errors += failed

        shops: dict[str, tuple[float, Shop]] = {}
        outside = 0
        for t in terms:
            for s in found[t]:
                if s.id in shops:
                    continue
                if s.lat is None or s.lng is None:
                    errors.append(f"{s.name}: no coordinates on Google Maps; skipped")
                    continue
                km = distance_km(req.lat, req.lng, s.lat, s.lng)
                if km > radius_km:
                    outside += 1
                    continue
                shops[s.id] = (km, s)
        nearest = [s for _km, s in sorted(shops.values(), key=lambda pair: pair[0])]
        if outside:
            progress(f"dropped {outside} place(s) outside {req.radius_miles:g} mi")
        if len(nearest) > req.max_shops:
            errors.append(f"kept the nearest {req.max_shops} of {len(nearest)} shops")
        progress(f"found {min(len(nearest), req.max_shops)} shop(s) within {req.radius_miles:g} mi")
        return SearchResponse(
            as_of=_today(req.location.timezone),
            deals=[],
            rejected=[],
            queries=[f"maps: {t}" for t in terms],
            sources=[],
            usage=Usage(),
            search_errors=errors,
            provider="apify_maps",
            apify_runs=counter.count,
            shops=nearest[: req.max_shops],
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
