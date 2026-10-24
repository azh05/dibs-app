"""One document shape for everything Bright Data fetched, so extraction and verification don't care where it came from."""
from __future__ import annotations

import re
from datetime import date
from typing import Iterable, Literal, Optional
from zoneinfo import ZoneInfo

from pydantic import BaseModel

from .brightdata import IgPost, SerpResult
from .schemas import SearchResultSource
from .verify import normalize_url


class SourceDoc(BaseModel):
    id: str  # "S1", "S2"...
    url: str
    title: Optional[str]
    text: str  # SERP: title + description; Instagram: caption
    post_date: Optional[date]  # Instagram: date_posted in the shop's timezone; SERP: None
    page_age: Optional[str] = None  # SERP: the date Google prints before a snippet ('Oct 7, 2026', '3 days ago')
    origin: Literal["serp", "instagram"]
    handle: Optional[str]


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
        )
        for p in posts
    )


def to_search_sources(docs: list[SourceDoc]) -> list[SearchResultSource]:
    return [
        SearchResultSource(url=d.url, title=d.title, page_age=d.post_date.isoformat() if d.post_date else d.page_age)
        for d in docs
    ]


def source_texts(docs: list[SourceDoc]) -> dict[str, str]:
    return {normalize_url(d.url): d.text for d in docs}


def post_dates(docs: list[SourceDoc]) -> dict[str, date]:
    """Scraper timestamps (Instagram only). They override Claude's reading; Google's snippet dates don't."""
    return {normalize_url(d.url): d.post_date for d in docs if d.post_date}
