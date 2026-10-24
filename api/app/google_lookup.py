"""Bright Data's Google search, two ways, for /extract/shops:

1. Account lookup. Google Maps only knows the social links a shop put on its listing or website; live, most shops
   had no TikTok and several no Instagram. One Google search per such shop ("<name>" <city> instagram) usually
   shows the accounts: a facebook.com/<page> link, an @handle in a snippet. A handle is only taken when it
   matches the shop's name, so a creator's account isn't mistaken for the shop's.
2. Deal search. A few Google searches for recent deals in the area. Instagram posts in the results are fetched
   in full (Bright Data's Instagram scraper, by URL); other results (Yelp, Reddit, Daily Bruin...) stay as
   snippets, which are short and second-hand.
"""
from __future__ import annotations

import logging
import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import date
from typing import Optional

from .apify import SocialPost, facebook_page, instagram_handle, tiktok_handle
from .bd_pipeline import usable_results
from .brightdata import BrightDataAuthError, BrightDataClient, BrightDataError, RequestCounter, SerpResult, ig_shortcode
from .schemas import Shop, ShopsRequest

log = logging.getLogger(__name__)

LOOKUP_WORKERS = 4
MAX_LOOKUPS = 20  # shops per run
DEAL_QUERY_TERMS = 2  # Google deal searches for the first N search terms (2 queries each)
MAX_POSTS_FETCHED = 10  # Instagram posts from Google results fetched in full
POST_FETCH_WAIT_S = 240  # runs alongside the Apify channels (2 to 4 min); live, 7 posts weren't ready after 90 s

_AT_HANDLE = re.compile(r"@([A-Za-z0-9._]{2,30})")
_STOPWORDS = {"the", "and", "cafe", "co", "inc", "llc", "shop", "store", "la", "of"}


def _squash(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def handle_matches(handle: str, shop_name: str, place_words: tuple[str, ...] = ()) -> bool:
    """'juicecrafters' ~ 'Juice Crafters', 'loklhaus' ~ 'LOKL HAUS', 'chichasanchen.sawtelle' ~ 'CHICHA San Chen -
    Sawtelle', 'milksha_ca' ~ 'Milksha Westwood' (with place_words=("westwood",)). The handle must contain the
    whole name, or every significant word of it; location words in the name are optional."""
    h = _squash(handle)
    if len(h) < 3:
        return False
    words = [w for w in re.findall(r"[a-z0-9]+", shop_name.lower()) if w not in _STOPWORDS]
    core = [w for w in words if w not in place_words] or words
    if not core:
        return False
    if "".join(core) in h:
        return True
    significant = [w for w in core if len(w) >= 3]
    return bool(significant) and all(w in h for w in significant)


@dataclass
class FoundAccounts:
    instagram: Optional[str] = None
    tiktok: Optional[str] = None
    facebook: Optional[str] = None


def place_words(req: ShopsRequest) -> tuple[str, ...]:
    loc = req.location
    return tuple(w for part in (loc.neighborhood, loc.city) if part for w in re.findall(r"[a-z0-9]+", part.lower()))


def accounts_from_results(results: list[SerpResult], shop_name: str, place: tuple[str, ...] = ()) -> FoundAccounts:
    """Profile links first (most reliable), then @handles in titles and snippets."""
    found = FoundAccounts()
    matches = lambda h: handle_matches(h, shop_name, place)
    for r in results:
        ig, tt = instagram_handle(r.link), tiktok_handle(r.link)
        fb = facebook_page(r.link)
        if ig and not found.instagram and matches(ig):
            found.instagram = ig
        if tt and not found.tiktok and matches(tt):
            found.tiktok = tt
        if fb and not found.facebook and "profile.php" not in fb and matches(fb.rstrip("/").rsplit("/", 1)[-1]):
            found.facebook = fb
    for r in results:
        for h in _AT_HANDLE.findall(f"{r.title} {r.description}"):
            h = h.rstrip(".").lower()
            if not matches(h):
                continue
            if "tiktok.com" in r.link and not found.tiktok:
                found.tiktok = h
            elif not found.instagram:
                found.instagram = h  # shops nearly always use the same handle on Instagram
    return found


def lookup_query(shop: Shop, req: ShopsRequest) -> str:
    return f'"{shop.name}" {req.location.city} instagram tiktok'


def deal_queries(req: ShopsRequest, terms: list[str]) -> list[str]:
    loc = req.location
    area = f"{loc.neighborhood} {loc.city}" if loc.neighborhood else loc.city
    queries: list[str] = []
    for t in terms[:DEAL_QUERY_TERMS] or ["food"]:
        queries += [f"site:instagram.com {area} {t} deal", f"{area} {t} deal"]
    return list(dict.fromkeys(queries))


@dataclass
class GoogleFindings:
    posts: list[SocialPost] = field(default_factory=list)  # Instagram posts from Google results, fetched in full
    snippets: list[SerpResult] = field(default_factory=list)  # every other usable result
    labels: list[str] = field(default_factory=list)


class GoogleLookup:
    def __init__(self, bd: BrightDataClient):
        self.bd = bd
        self.counter = RequestCounter()

    def _search(self, query: str, past_month: bool, errors: list[str]) -> list[SerpResult]:
        try:
            return usable_results(query, self.bd.serp_search(query, past_month=past_month, counter=self.counter))
        except BrightDataAuthError:
            raise
        except BrightDataError as exc:
            errors.append(f"google search failed for {query!r}: {exc}")
            return []

    def fill_accounts(self, shops: list[Shop], req: ShopsRequest, errors: list[str]) -> list[str]:
        """Fill missing instagram/tiktok/facebook on Maps shops, in place. Returns what was added, for progress."""
        todo = [s for s in shops if s.found_via in ("google_maps", "named") and not (s.instagram and s.tiktok and s.facebook)]
        todo = todo[:MAX_LOOKUPS]
        if not todo:
            return []
        self.bd.zone()  # resolve once, before the parallel calls
        with ThreadPoolExecutor(max_workers=LOOKUP_WORKERS) as pool:
            results = list(pool.map(lambda s: self._search(lookup_query(s, req), False, errors), todo))
        added: list[str] = []
        for shop, res in zip(todo, results):
            found = accounts_from_results(res, shop.name, place_words(req))
            for platform in ("instagram", "tiktok", "facebook"):
                value = getattr(found, platform)
                if value and not getattr(shop, platform):
                    setattr(shop, platform, value)
                    added.append(f"{shop.name}: {platform} {value}")
        return added

    def find_deals(self, req: ShopsRequest, terms: list[str], since: date, errors: list[str]) -> GoogleFindings:
        out = GoogleFindings()
        queries = deal_queries(req, terms)
        out.labels = [f"google: {q}" for q in queries]
        self.bd.zone()
        with ThreadPoolExecutor(max_workers=LOOKUP_WORKERS) as pool:
            results = list(pool.map(lambda q: self._search(q, True, errors), queries))
        post_urls: dict[str, str] = {}
        ig_snippets: dict[str, SerpResult] = {}
        for res in results:
            for r in res:
                code = ig_shortcode(r.link)
                if code:
                    if code not in post_urls and len(post_urls) < MAX_POSTS_FETCHED:
                        post_urls[code] = f"https://www.instagram.com/p/{code}/"
                        ig_snippets[code] = r
                else:
                    out.snippets.append(r)
        if post_urls:
            try:
                fetched = self.bd.instagram_posts(list(post_urls.values()), max_wait_s=POST_FETCH_WAIT_S, counter=self.counter)
                errors += fetched.errors
                out.posts = [
                    SocialPost("instagram", p.url, (p.handle or "").lower() or None, p.caption, p.posted_at, coauthors=p.coauthors)
                    for p in fetched.posts
                ]
            except BrightDataAuthError:
                raise
            except BrightDataError as exc:
                errors.append(f"couldn't fetch the {len(post_urls)} Instagram post(s) Google found, kept their snippets: {exc}")
            fetched_codes = {ig_shortcode(p.url) for p in out.posts}
            out.snippets += [r for code, r in ig_snippets.items() if code not in fetched_codes]
        return out
