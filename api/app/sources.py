"""One document shape for everything Bright Data or Apify fetched, so extraction and verification don't care where it came from."""
from __future__ import annotations

import re
from datetime import date
from typing import Iterable, Literal, Optional
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

from pydantic import BaseModel

from .apify import SocialPost, WebPage
from .brightdata import IgPost, SerpResult
from .schemas import SearchResultSource
from .verify import normalize_url


class SourceDoc(BaseModel):
    id: str  # "S1", "S2"...
    url: str
    title: Optional[str]
    text: str  # SERP: title + description; social: caption (+ image text); website: page text
    post_date: Optional[date]  # social: posted date in the shop's timezone; SERP and websites: None
    page_age: Optional[str] = None  # SERP: the date Google prints before a snippet ('Oct 7, 2026', '3 days ago')
    origin: Literal["serp", "instagram", "tiktok", "facebook", "website"]
    handle: Optional[str]
    coauthors: list[str] = []  # Instagram collab posts: accounts that co-published it
    shop: Optional[str] = None  # set when this is the shop's own channel (first-hand), to that shop's name
    prompt_text: Optional[str] = None  # shorter text shown to Claude (long web pages); verification uses `text`


# Google starts many snippets with a date: "Oct 7, 2026 — SEO for Westwood cafés...".
_SNIPPET_DATE = re.compile(
    r"^\s*([A-Z][a-z]{2,8} \d{1,2}, \d{4}|\d+ (?:minute|hour|day|week|month|year)s? ago)\s+[\u2014\u2013-]\s+"
)


def snippet_date(description: str) -> Optional[str]:
    m = _SNIPPET_DATE.match(description or "")
    return m.group(1) if m else None


def _number(docs: Iterable[SourceDoc]) -> list[SourceDoc]:
    """Drop repeat URLs (first one wins) and number what's left S1..Sn."""
    seen: set[str] = set()
    out: list[SourceDoc] = []
    for doc in docs:
        key = normalize_url(doc.url)
        if key in seen or not doc.text.strip():
            continue
        seen.add(key)
        out.append(doc.model_copy(update={"id": f"S{len(out) + 1}"}))
    return out


def from_serp(results: Iterable[SerpResult]) -> list[SourceDoc]:
    return _number(
        SourceDoc(
            id="",
            url=r.link,
            title=r.title or None,
            text="\n".join(t for t in (r.title, r.description) if t),
            post_date=None,  # no reliable post date; Google's snippet date is only a fallback (page_age)
            page_age=snippet_date(r.description),
            origin="serp",
            handle=None,
        )
        for r in results
    )


def from_instagram(posts: Iterable[IgPost], tz: str = "America/Los_Angeles") -> list[SourceDoc]:
    # date_posted is UTC; a post at 8pm in LA is "tomorrow" in UTC, so convert to the shop's local date.
    zone = ZoneInfo(tz)
    return _number(
        SourceDoc(
            id="",
            url=p.url,
            title=f"@{p.handle} on Instagram" if p.handle else "Instagram post",
            text=p.caption,
            post_date=p.posted_at.astimezone(zone).date() if p.posted_at else None,
            origin="instagram",
            handle=p.handle,
            coauthors=p.coauthors,
        )
        for p in posts
    )


def _local_date(posted, zone: ZoneInfo) -> Optional[date]:
    return posted.astimezone(zone).date() if posted else None


def from_social(posts: Iterable[SocialPost], shop_of: dict[str, str], tz: str = "America/Los_Angeles") -> list[SourceDoc]:
    """shop_of maps a post URL to the shop whose own account posted it; other posts are second-hand."""
    zone = ZoneInfo(tz)
    names = {"instagram": "Instagram", "tiktok": "TikTok", "facebook": "Facebook"}
    return _number(
        SourceDoc(
            id="",
            url=p.url,
            title=f"@{p.handle} on {names[p.platform]}" if p.handle else f"{names[p.platform]} post",
            text=p.text,
            post_date=_local_date(p.posted_at, zone),
            origin=p.platform,
            handle=p.handle,
            coauthors=p.coauthors,
            shop=shop_of.get(p.url),
        )
        for p in posts
    )


# Lines on a web page that look like an offer. Websites are long (menus, footers); Claude sees only these.
_DEALISH = re.compile(
    r"%|\$\s?\d|\bbogo\b|\bfree\b|\bdeal|\bspecial|\bhappy hour|\bpromo|\bdiscount|\bsale\b|\boff\b|\boffer"
    r"|\bcoupon|\bcode\b|\blimited\b|\bgrand opening|\bbuy one|\bstudent",
    re.I,
)
EXCERPT_CHARS = 1500


def deal_excerpt(text: str, limit: int = EXCERPT_CHARS) -> str:
    """Deal-looking lines with one line of context each, in page order, up to `limit` characters."""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    keep: set[int] = set()
    for i, ln in enumerate(lines):
        if _DEALISH.search(ln):
            keep.update({i - 1, i, i + 1})
    picked = [lines[i] for i in sorted(keep) if 0 <= i < len(lines)] or lines[:20]
    out = "\n".join(picked)
    return out if len(out) <= limit else out[:limit] + " [truncated]"


def from_website(pages: Iterable[WebPage], shop_of: dict[str, str]) -> list[SourceDoc]:
    """shop_of maps a site host ('milksha.com') to its shop."""
    docs = []
    for p in pages:
        host = (urlsplit(p.url).hostname or "").lower().removeprefix("www.")
        docs.append(
            SourceDoc(
                id="",
                url=p.url,
                title=p.title,
                text=p.text,
                prompt_text=deal_excerpt(p.text),
                post_date=None,  # pages carry no reliable publish date
                origin="website",
                handle=None,
                shop=shop_of.get(host),
            )
        )
    return _number(docs)


def combine(*groups: Iterable[SourceDoc]) -> list[SourceDoc]:
    """Merge docs from several adapters into one list, deduped and renumbered S1..Sn in the order given."""
    return _number(d for g in groups for d in g)


def to_search_sources(docs: list[SourceDoc]) -> list[SearchResultSource]:
    return [
        SearchResultSource(
            url=d.url,
            title=d.title,
            page_age=d.post_date.isoformat() if d.post_date else d.page_age,
            text=d.text,
            origin=d.origin,
            handle=d.handle,
        )
        for d in docs
    ]


def source_texts(docs: list[SourceDoc]) -> dict[str, str]:
    return {normalize_url(d.url): d.text for d in docs}


def post_dates(docs: list[SourceDoc]) -> dict[str, date]:
    """Scraper timestamps (social posts). They override Claude's reading; Google's snippet dates don't."""
    return {normalize_url(d.url): d.post_date for d in docs if d.post_date}
