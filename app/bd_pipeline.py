"""Bright Data fetches public pages; Claude only extracts deals from those exact pages; verify.py checks them.

Unlike /extract/search, Claude has no web_search tool here, and because we hold every source's full
text, verification can require each quote to really appear in its source.
"""
from __future__ import annotations

import logging
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from typing import Any, Callable, Optional
from urllib.parse import urlsplit

import anthropic

from .brightdata import IG_MAX_WAIT_S, BrightDataAuthError, BrightDataClient, BrightDataError, RequestCounter, SerpResult
from .extractor import (
    DEAL_RULES,
    DEAL_TYPES,
    DEFAULT_MODEL,
    RECORD_TOOL_NAME,
    _parse_raw_deals,
    _today,
    build_user_prompt,
    record_tool_definition,
)
from .schemas import (
    Category,
    InstagramRequest,
    Provider,
    RawDeal,
    SearchRequest,
    SearchResponse,
    SerpSearchRequest,
    Usage,
)
from .sources import SourceDoc, from_instagram, from_serp, post_dates, source_texts, to_search_sources
from .verify import verify_deals

log = logging.getLogger(__name__)

SERP_WORKERS = 4
_SITE = re.compile(r"\bsite:(\S+)", re.I)
DOC_CHAR_LIMIT = 1500  # per source shown to Claude; verification still uses the full text
PROMPT_CHAR_BUDGET = 120_000  # roughly 30k tokens of sources per call

EXTRACTION_PROMPT = (
    DEAL_TYPES
    + """
You don't search. Bright Data already fetched the public pages in the user message, numbered [S1], [S2]... \
Read them and record the deals they contain.

Rules for every deal you record:
- Use ONLY the numbered sources. source_url must be exactly one of their URLs.
- verbatim_quote must be copied exactly from that source's text, word for word. It is checked by machine.
- Google results are short snippets. If a snippet doesn't show the whole offer, use confidence "low".
- For Instagram sources, the posted date is given; use it as source_post_date and set shop_handle to the account.
"""
    + DEAL_RULES
    + """
Call the record_deals tool exactly once with every deal you found. If you found none, call it with an empty list.
"""
)


def build_serp_queries(req: SerpSearchRequest) -> list[str]:
    if req.queries:
        return [q.strip() for q in req.queries if q.strip()][: req.max_queries]
    # "Westwood" alone also matches Westwood NJ, MA, KS... (seen live 2026-10-23), so keep the city.
    loc = req.location
    area = f"{loc.neighborhood} {loc.city}" if loc.neighborhood else loc.city
    queries = [f"site:instagram.com {area} deal", f"{area} grand opening special"]
    queries += [f"{area} {c.value} BOGO" for c in (req.categories or [Category.food])]
    if req.shop:
        # Put the shop query first so trimming to max_queries never drops it.
        queries.insert(0, f"{req.shop} promo code")
    return list(dict.fromkeys(queries))[: req.max_queries]


def usable_results(query: str, results: list[SerpResult]) -> list[SerpResult]:
    """Keep results with a real http(s) URL, on the requested site: if the query names one.

    Live, Bright Data sometimes returns Google redirect links ("/goto?url=CAES...") that can't be
    decoded, and Google sometimes ignores site: and returns unrelated pages.
    """
    site = _SITE.search(query)
    domain = site.group(1).lower().removeprefix("www.") if site else None
    kept = []
    for r in results:
        parts = urlsplit(r.link)
        host = (parts.hostname or "").removeprefix("www.")
        if parts.scheme not in ("http", "https") or not host:
            continue
        if domain and host != domain and not host.endswith("." + domain):
            continue
        kept.append(r)
    return kept


def render_sources(docs: list[SourceDoc], errors: list[str]) -> str:
    blocks: list[str] = []
    used = 0
    for d in docs:
        header = f"[{d.id}] {d.url} | {d.origin}"
        if d.handle:
            header += f" | @{d.handle}"
        if d.post_date:
            header += f" | posted: {d.post_date.isoformat()}"
        elif d.page_age:
            header += f" | posted: {d.page_age} (date shown by Google)"
        else:
            header += " | posted: unknown"
        text = d.text if len(d.text) <= DOC_CHAR_LIMIT else d.text[:DOC_CHAR_LIMIT] + " [truncated]"
        block = f"{header}\n{text}"
        if used + len(block) > PROMPT_CHAR_BUDGET:
            errors.append(f"only the first {len(blocks)} of {len(docs)} sources fit in one Claude call")
            break
        blocks.append(block)
        used += len(block)
    return "\n\n".join(blocks)


def extract_from_docs(
    client: Any, model: str, docs: list[SourceDoc], context: str, errors: list[str]
) -> tuple[list[RawDeal], Usage]:
    """Ask Claude to call record_deals over the fetched docs. No web_search tool.

    claude-opus-5-5 rejects a forced tool_choice ({"type": "tool"} / "any") with a 400, so tool_choice
    is auto, the prompt names the tool, and a prose answer gets one nudge turn.
    """
    messages: list[dict[str, Any]] = [{"role": "user", "content": f"{context}\n\nSources:\n\n{render_sources(docs, errors)}"}]
    usage = Usage()
    for attempt in range(2):
        resp = client.messages.create(
            model=model,
            max_tokens=16000,
            system=EXTRACTION_PROMPT,
            tools=[record_tool_definition()],
            tool_choice={"type": "auto"},
            messages=messages,
        )
        usage.input_tokens += getattr(resp.usage, "input_tokens", 0) or 0
        usage.output_tokens += getattr(resp.usage, "output_tokens", 0) or 0
        call = next((b for b in resp.content if b.type == "tool_use" and b.name == RECORD_TOOL_NAME), None)
        if call is not None:
            if resp.stop_reason == "max_tokens":
                errors.append("Claude hit max_tokens; some deals may be missing")
            return _parse_raw_deals((call.input or {}).get("deals", []), errors), usage
        if resp.stop_reason == "max_tokens" or attempt:
            break
        # Thinking blocks must go back unchanged, so send the whole assistant turn, then nudge.
        messages.append({"role": "assistant", "content": [b.model_dump(exclude_none=True) for b in resp.content]})
        messages.append({"role": "user", "content": "Now call record_deals with every deal you found, or an empty list."})
    errors.append("Claude never called record_deals")
    return [], usage


class BrightDataPipeline:
    def __init__(
        self,
        bd: Optional[BrightDataClient] = None,
        anthropic_client: Optional[anthropic.Anthropic] = None,
        model: str = DEFAULT_MODEL,
    ):
        self.bd = bd or BrightDataClient()
        self._anthropic = anthropic_client
        self.model = model

    @property
    def anthropic(self) -> Any:
        if self._anthropic is None:
            self._anthropic = anthropic.Anthropic()
        return self._anthropic

    def check_ready(self) -> None:
        """Fail fast (before queueing a slow job) if the Bright Data key is missing."""
        self.bd.require_key()

    def run_serp(self, req: SerpSearchRequest, today: Optional[date] = None) -> SearchResponse:
        today = today or _today(req.location.timezone)
        queries = build_serp_queries(req)
        counter = RequestCounter()
        errors: list[str] = []
        self.bd.zone()  # resolve the zone once, before the parallel calls

        results = []
        failures: list[BrightDataError] = []
        with ThreadPoolExecutor(max_workers=min(SERP_WORKERS, len(queries))) as pool:
            futures = [pool.submit(self.bd.serp_search, q, req.past_month, counter) for q in queries]
            for q, fut in zip(queries, futures):
                try:
                    found = fut.result()
                except BrightDataAuthError:
                    raise
                except BrightDataError as exc:
                    failures.append(exc)
                    errors.append(str(exc))
                    continue
                usable = usable_results(q, found)
                if len(usable) < len(found):
                    errors.append(f"dropped {len(found) - len(usable)} of {len(found)} Google results for {q!r} (redirect links or off-site)")
                if not usable:
                    errors.append(f"no Google results for {q!r}")
                results += usable
        if failures and len(failures) == len(queries):
            raise failures[0]

        context = SearchRequest(
            location=req.location, radius_miles=req.radius_miles, categories=req.categories, shop=req.shop, query=req.query
        )
        return self._finish(from_serp(results), context, today, errors, counter, queries, "brightdata_serp")

    def run_instagram(
        self,
        req: InstagramRequest,
        on_progress: Optional[Callable[[str], None]] = None,
        today: Optional[date] = None,
        max_wait_s: float = IG_MAX_WAIT_S,
    ) -> SearchResponse:
        today = today or _today(req.location.timezone)
        counter = RequestCounter()
        urls = [f"https://www.instagram.com/{h}/" for h in req.handles]
        fetched = self.bd.instagram_recent_posts(
            urls, req.num_of_posts, today - timedelta(days=req.since_days), max_wait_s, on_progress, counter
        )
        docs = from_instagram(fetched.posts, req.location.timezone)
        context = SearchRequest(location=req.location, radius_miles=req.radius_miles)
        return self._finish(
            docs, context, today, fetched.errors, counter, [f"@{h}" for h in req.handles], "brightdata_instagram", on_progress
        )

    def _finish(
        self,
        docs: list[SourceDoc],
        context: SearchRequest,
        today: date,
        errors: list[str],
        counter: RequestCounter,
        queries: list[str],
        provider: Provider,
        on_progress: Optional[Callable[[str], None]] = None,
    ) -> SearchResponse:
        raw: list[RawDeal] = []
        usage = Usage()
        if not docs:
            errors.append("Bright Data returned no usable sources, so there was nothing to extract")
        else:
            if on_progress:
                on_progress(f"extracting deals from {len(docs)} source(s) with Claude")
            raw, usage = extract_from_docs(self.anthropic, self.model, docs, build_user_prompt(context, today), errors)

        sources = to_search_sources(docs)
        deals, rejected = verify_deals(
            raw, sources, today, source_texts=source_texts(docs), authoritative_post_dates=post_dates(docs)
        )
        return SearchResponse(
            as_of=today,
            deals=deals,
            rejected=rejected,
            queries=queries,
            sources=sources,
            search_errors=errors,
            usage=usage,
            provider=provider,
            brightdata_requests=counter.count,
        )
