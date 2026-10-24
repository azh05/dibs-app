"""Tie every verified deal to a Shop record, and give deals stable ids, so results can be upserted into a database
(shops by Shop.id, deals by Deal.id) without duplicates across runs."""
from __future__ import annotations

import hashlib
import re
from difflib import SequenceMatcher
from typing import Optional

from .schemas import Deal, Shop
from .sources import SourceDoc
from .verify import normalize_url

NAME_MATCH_RATIO = 0.85


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def _quote_key(text: str) -> str:
    return re.sub(r"\s+", " ", text.lower()).strip()[:200]


def deal_id(deal: Deal) -> str:
    """Same source post + same quoted text = same deal. The quote is copied from the source, so it is steadier
    across runs than Claude's paraphrased `offer`."""
    key = f"{normalize_url(deal.source_url)}|{_quote_key(deal.verbatim_quote)}|{(deal.code or '').upper()}"
    return "deal:" + hashlib.sha256(key.encode()).hexdigest()[:16]


def names_match(a: str, b: str) -> bool:
    """'Milksha' ~ 'Milksha Westwood', 'CHICHA San Chen - Sawtelle' ~ 'Chicha San Chen'."""
    a, b = _norm(a), _norm(b)
    if not a or not b:
        return False
    if a == b:
        return True
    short, long = sorted((a, b), key=len)
    if len(short) >= 4 and f" {short} " in f" {long} ":
        return True
    return SequenceMatcher(None, a, b).ratio() >= NAME_MATCH_RATIO


def _find(deal: Deal, shops: list[Shop]) -> Optional[Shop]:
    handle = (deal.shop_handle or "").lstrip("@").lower()
    if handle:
        for s in shops:
            if handle in {(s.instagram or "").lower(), (s.tiktok or "").lower()}:
                return s
    return next((s for s in shops if names_match(deal.shop_name, s.name)), None)


def link_deals(deals: list[Deal], docs: list[SourceDoc], shops: list[Shop]) -> list[Shop]:
    """Set deal.id and deal.shop_id on every deal (in place). Returns the shops, plus a new Shop (found_via
    "deal") for each place a deal names that isn't on the list, e.g. a cafe an influencer reviewed."""
    shops = list(shops)
    by_name = {s.name: s for s in shops}
    own = {normalize_url(d.url): by_name.get(d.shop) for d in docs if d.shop}
    for deal in deals:
        shop = own.get(normalize_url(deal.source_url)) or _find(deal, shops)
        if shop is None:
            handle = (deal.shop_handle or "").lstrip("@").lower() or None
            shop = Shop(name=deal.shop_name, address=deal.address, instagram=handle, found_via="deal")
            existing = next((s for s in shops if s.id == shop.id), None)
            if existing:
                shop = existing
            else:
                shops.append(shop)
        deal.shop_id = shop.id
        if not deal.address and shop.address:
            deal.address = shop.address
        deal.id = deal_id(deal)
    return shops
