"""Deterministic checks on what Claude extracted. No AI in this file.

Claude reads messy posts well, but it can misread fine print, guess dates, or
mix an old post with a new one. Every rule here exists to catch one of those.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from typing import Iterable, Optional
from urllib.parse import urlsplit

from .schemas import Confidence, Deal, DealStatus, RawDeal, RejectedDeal, SearchResultSource

STALE_AFTER_DAYS = 14

_STATUS_ORDER = {
    DealStatus.live: 0,
    DealStatus.needs_check: 1,
    DealStatus.stale: 2,
    DealStatus.expired: 3,
}


def normalize_url(url: str) -> str:
    """Compare URLs by host + path only: no scheme, www, query, fragment or trailing slash."""
    parts = urlsplit(url.strip())
    host = parts.netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    path = parts.path.rstrip("/")
    return f"{host}{path}".lower()


def _alnum(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


_DATE_FORMATS = ("%Y-%m-%d", "%B %d, %Y", "%b %d, %Y", "%d %B %Y", "%d %b %Y")
_RELATIVE = re.compile(r"^(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago$", re.I)
_UNIT_DAYS = {"minute": 0, "hour": 0, "day": 1, "week": 7, "month": 30, "year": 365}


def parse_page_age(page_age: Optional[str], today: date) -> Optional[date]:
    """Best-effort parse of the search result's page_age ('April 30, 2026', '3 days ago')."""
    if not page_age:
        return None
    text = page_age.strip()
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            pass
    m = _RELATIVE.match(text)
    if m:
        return today - timedelta(days=int(m.group(1)) * _UNIT_DAYS[m.group(2).lower()])
    return None


def verify_deals(
    raw_deals: Iterable[RawDeal],
    sources: list[SearchResultSource],
    today: date,
    stale_after_days: int = STALE_AFTER_DAYS,
) -> tuple[list[Deal], list[RejectedDeal]]:
    by_url = {normalize_url(s.url): s for s in sources}
    kept: list[Deal] = []
    rejected: list[RejectedDeal] = []

    for raw in raw_deals:
        # 1. Must quote the source.
        if not raw.verbatim_quote or not raw.verbatim_quote.strip():
            rejected.append(RejectedDeal(deal=raw, reason="missing_quote"))
            continue

        # 2. Source must be a page the search actually returned (blocks invented links).
        source = by_url.get(normalize_url(raw.source_url))
        if source is None:
            rejected.append(RejectedDeal(deal=raw, reason="source_not_in_search_results"))
            continue

        data = raw.model_dump()
        flags: list[str] = []

        # 3. A promo code must appear in the quote, or we drop it.
        if raw.code and _alnum(raw.code) not in _alnum(raw.verbatim_quote):
            data["code"] = None
            flags.append("code_not_in_quote")

        # 4. Post date: Claude's reading of the page, else the search result's page_age.
        post_date = raw.source_post_date
        if post_date is None:
            post_date = parse_page_age(source.page_age, today)
            if post_date is not None:
                data["source_post_date"] = post_date
                flags.append("post_date_from_page_age")
        if post_date and post_date > today + timedelta(days=1):
            flags.append("post_date_in_future")
            post_date = None
            data["source_post_date"] = None

        # 5. Status from dates. End dates are only ever what the source stated.
        if raw.end_date and raw.end_date < today:
            status = DealStatus.expired
        elif raw.end_date:
            status = DealStatus.live
        elif post_date and (today - post_date).days > stale_after_days:
            status = DealStatus.stale
            flags.append("no_end_date")
        elif post_date:
            status = DealStatus.live
            flags.append("no_end_date")
        else:
            status = DealStatus.needs_check
            flags.append("no_dates")

        if raw.start_date and raw.start_date > today:
            flags.append("starts_later")

        # 6. Low confidence never shows as live without a human check.
        if raw.confidence == Confidence.low:
            flags.append("low_confidence")
            if status == DealStatus.live:
                status = DealStatus.needs_check

        kept.append(Deal(**data, status=status, flags=flags))

    return _dedupe(kept), rejected


def _dedupe(deals: list[Deal]) -> list[Deal]:
    """Same shop + offer + code = one deal. Keep the one with the newest source post."""
    best: dict[tuple[str, str, str], Deal] = {}
    for d in deals:
        key = (_alnum(d.shop_name), _alnum(d.offer), _alnum(d.code or ""))
        current = best.get(key)
        if current is None or (d.source_post_date or date.min) > (current.source_post_date or date.min):
            best[key] = d
    return sorted(best.values(), key=lambda d: (_STATUS_ORDER[d.status], d.shop_name.lower()))
