"""Bright Data fetches public pages; Claude only extracts deals from those exact pages; verify.py checks them.

Unlike /extract/search, Claude has no web_search tool here, and because we hold every source's full
text, verification can require each quote to really appear in its source.
"""
from __future__ import annotations

import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from typing import Any, Callable, Optional
from urllib.parse import urlsplit

import anthropic

from .brightdata import (
    IG_MAX_WAIT_S,
    IG_MIN_RETRY_S,
    BrightDataAuthError,
    BrightDataClient,
    BrightDataError,
    BrightDataTimeout,
    IgPost,
    RequestCounter,
    SerpResult,
    ig_shortcode,
)
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
from .linking import link_deals
from .verify import verify_deals

log = logging.getLogger(__name__)

SERP_WORKERS = 4
ENRICH_MAX_POSTS = 5  # Instagram posts to fetch in full per /extract/serp call
ENRICH_WAIT_S = 60
_SITE = re.compile(r"\bsite:(\S+)", re.I)
DOC_CHAR_LIMIT = 1500  # per source shown to Claude; verification still uses the full text
PROMPT_CHAR_BUDGET = 120_000  # roughly 30k tokens of sources per call

EXTRACTION_PROMPT = (
    DEAL_TYPES
    + """
You don't search. The public pages in the user message were already fetched, numbered [S1], [S2]... \
Read them and record the deals they contain.

Rules for every deal you record:
- Use ONLY the numbered sources. source_url must be exactly one of their URLs.
- verbatim_quote must be copied exactly from that source's text, word for word. It is checked by machine.
- Google results are short snippets. If a snippet doesn't show the whole offer, use confidence "low".
- When a source's posted date is given, use it as source_post_date.
- An Instagram post is first-hand only if the shop posted it or co-posted it ("co-posted with @shop" in the \
header); then set shop_handle to the shop's account. A post by another account (an influencer, a food blog) \
is second-hand: record its deals too, with shop_name set to the shop the post is about. Use confidence \
"medium" at most when it names the shop and states a concrete offer, "low" when it's vague.
- A source marked "shop's own" (the shop's website, Instagram, TikTok or Facebook) is first-hand for that \
shop. A post by any other account is second-hand, as above.
- Website text shows only the lines that look like offers. A menu price alone is not a deal.
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
        if d.coauthors:
            header += " | co-posted with " + ", ".join(f"@{c}" for c in d.coauthors)
        if d.shop:
            header += f" | shop's own {d.origin}: {d.shop}"
        if d.post_date:
            header += f" | posted: {d.post_date.isoformat()}"
        elif d.page_age:
            header += f" | posted: {d.page_age} (date shown by Google)"
        else:
            header += " | posted: unknown"
        text = d.prompt_text or d.text
        text = text if len(text) <= DOC_CHAR_LIMIT else text[:DOC_CHAR_LIMIT] + " [truncated]"
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


def extract_docs(
    client: Any,
    model: str,
    docs: list[SourceDoc],
    context: SearchRequest,
    today: date,
    errors: list[str],
    on_progress: Optional[Callable[[str], None]] = None,
    provider_name: str = "Bright Data",
) -> tuple[list[RawDeal], Usage]:
    """extract_from_docs, or a note in errors when there is nothing to read."""
    if not docs:
        errors.append(f"{provider_name} returned no usable sources, so there was nothing to extract")
        return [], Usage()
    if on_progress:
        on_progress(f"extracting deals from {len(docs)} source(s) with Claude")
    return extract_from_docs(client, model, docs, build_user_prompt(context, today), errors)


def batch_docs(docs: list[SourceDoc], budget: int = PROMPT_CHAR_BUDGET, max_docs: int = 60) -> list[list[SourceDoc]]:
    """Split docs into groups that each fit one Claude call (same size estimate as render_sources)."""
    batches: list[list[SourceDoc]] = [[]]
    used = 0
    for d in docs:
        size = 120 + min(len(d.prompt_text or d.text), DOC_CHAR_LIMIT + 12)
        if batches[-1] and (used + size > budget or len(batches[-1]) >= max_docs):
            batches.append([])
            used = 0
        batches[-1].append(d)
        used += size
    return [b for b in batches if b]


def extract_docs_batched(
    client: Any,
    model: str,
    docs: list[SourceDoc],
    context: SearchRequest,
    today: date,
    errors: list[str],
    on_progress: Optional[Callable[[str], None]] = None,
    provider_name: str = "Bright Data",
    workers: int = 4,
) -> tuple[list[RawDeal], Usage]:
    """Like extract_docs, but any number of sources: one Claude call per batch, run in parallel."""
    batches = batch_docs(docs)
    if len(batches) <= 1:
        return extract_docs(client, model, docs, context, today, errors, on_progress, provider_name)
    if on_progress:
        on_progress(f"extracting deals from {len(docs)} source(s) with Claude, {len(batches)} calls in parallel")
    prompt = build_user_prompt(context, today)
    raw: list[RawDeal] = []
    usage = Usage()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(extract_from_docs, client, model, b, prompt, errors) for b in batches]
        for fut in futures:
            try:
                part, part_usage = fut.result()
            except anthropic.APIError as exc:
                errors.append(f"one extraction call failed ({exc.__class__.__name__}); its sources were skipped")
                continue
            raw += part
            usage.input_tokens += part_usage.input_tokens
            usage.output_tokens += part_usage.output_tokens
    return raw, usage


def verify_docs(docs: list[SourceDoc], raw: list[RawDeal], today: date):
    """verify_deals with the full fetched text and the scrapers' post dates. Returns (sources, deals, rejected)."""
    sources = to_search_sources(docs)
    deals, rejected = verify_deals(
        raw, sources, today, source_texts=source_texts(docs), authoritative_post_dates=post_dates(docs)
    )
    return sources, deals, rejected


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

    def _search(
        self, queries: list[str], past_month: bool, counter: RequestCounter, errors: list[str]
    ) -> tuple[dict[str, list[SerpResult]], list[BrightDataError]]:
        """Run Google queries in parallel (total time = slowest query). Failures are noted, not raised,
        except a bad key."""
        self.bd.zone()  # resolve the zone once, before the parallel calls
        by_query: dict[str, list[SerpResult]] = {}
        failures: list[BrightDataError] = []
        with ThreadPoolExecutor(max_workers=min(SERP_WORKERS, len(queries))) as pool:
            futures = [pool.submit(self.bd.serp_search, q, past_month, counter) for q in queries]
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
                by_query[q] = usable
        return by_query, failures

    def run_serp(self, req: SerpSearchRequest, today: Optional[date] = None) -> SearchResponse:
        today = today or _today(req.location.timezone)
        queries = build_serp_queries(req)
        counter = RequestCounter()
        errors: list[str] = []
        by_query, failures = self._search(queries, req.past_month, counter, errors)
        if failures and len(failures) == len(queries):
            raise failures[0]

        docs = from_serp(r for q in queries for r in by_query.get(q, []))
        context = SearchRequest(
            location=req.location, radius_miles=req.radius_miles, categories=req.categories, shop=req.shop, query=req.query
        )
        raw, usage = self._extract(docs, context, today, errors)
        fetched_codes: set[str] = set()
        if req.enrich_instagram and raw:
            docs, raw, fetched_codes = self._enrich_instagram(docs, raw, context, today, req.location.timezone, errors, counter, usage)
        return self._respond(docs, raw, usage, today, errors, counter, queries, "brightdata_serp", fetched_codes)

    def _enrich_instagram(
        self,
        docs: list[SourceDoc],
        raw: list[RawDeal],
        context: SearchRequest,
        today: date,
        tz: str,
        errors: list[str],
        counter: RequestCounter,
        usage: Usage,
    ) -> tuple[list[SourceDoc], list[RawDeal], set[str]]:
        """Google snippets are cut off and undated. For deals that cite an Instagram post, fetch the whole
        post (full caption, real post date), then re-extract those deals from it."""
        doc_codes = {ig_shortcode(d.url) for d in docs} - {None}
        targets: dict[str, str] = {}
        for deal in raw:
            code = ig_shortcode(deal.source_url)
            if code in doc_codes and code not in targets and len(targets) < ENRICH_MAX_POSTS:
                targets[code] = f"https://www.instagram.com/p/{code}/"
        if not targets:
            return docs, raw, set()
        try:
            fetched = self.bd.instagram_posts(list(targets.values()), max_wait_s=ENRICH_WAIT_S, counter=counter)
        except BrightDataAuthError:
            raise
        except BrightDataError as exc:
            errors.append(f"kept Google snippets; could not fetch the full Instagram posts: {exc}")
            return docs, raw, set()
        errors += fetched.errors
        ig_docs = from_instagram(fetched.posts, tz)
        codes = {ig_shortcode(d.url) for d in ig_docs} & set(targets)
        ig_docs = [d for d in ig_docs if ig_shortcode(d.url) in codes]
        if not ig_docs:
            return docs, raw, set()

        # The full post replaces its snippet: re-extract from it, and drop what the snippet said.
        more, more_usage = extract_from_docs(self.anthropic, self.model, ig_docs, build_user_prompt(context, today), errors)
        usage.input_tokens += more_usage.input_tokens
        usage.output_tokens += more_usage.output_tokens
        kept_docs = [d for d in docs if ig_shortcode(d.url) not in codes]
        kept_raw = [r for r in raw if ig_shortcode(r.source_url) not in codes]
        return kept_docs + ig_docs, kept_raw + more, codes

    def run_instagram(
        self,
        req: InstagramRequest,
        on_progress: Optional[Callable[[str], None]] = None,
        today: Optional[date] = None,
        max_wait_s: float = IG_MAX_WAIT_S,
    ) -> SearchResponse:
        """Google finds each shop's recent post URLs, Bright Data fetches those posts by URL (seconds).
        Profile discovery (minutes; returned 0 records for every account on 2026-10-23) is only a
        fallback for shops Google finds nothing for."""
        progress = on_progress or (lambda _msg: None)
        deadline = time.monotonic() + max_wait_s
        today = today or _today(req.location.timezone)
        since = today - timedelta(days=req.since_days)
        counter = RequestCounter()
        errors: list[str] = []
        wanted = {h.lower(): h for h in req.handles}

        # 1. Google: recent posts that mention each handle (post snippets read "<handle> on October 4, 2026: ...").
        queries = {h: f'site:instagram.com "{h}"' for h in req.handles}
        progress(f"searching Google for recent posts from {len(req.handles)} profile(s)")
        by_query, _ = self._search(list(queries.values()), req.since_days <= 31, counter, errors)
        post_urls: dict[str, str] = {}
        for h, q in queries.items():
            codes = [c for c in dict.fromkeys(ig_shortcode(r.link) for r in by_query.get(q, [])) if c]
            for code in codes[: req.num_of_posts]:
                post_urls.setdefault(code, f"https://www.instagram.com/p/{code}/")

        # 2. Bright Data: fetch those posts. Prefer each shop's own posts. A shop's captions rarely contain
        #    its own handle, so the query mostly finds other accounts tagging it (live 2026-10-24: 5 of 5 were
        #    influencer posts). Those are still about the shop: use them when the shop has none of its own.
        #    Claude rates second-hand sources "low", so they come back needs_check, never live.
        posts: list[IgPost] = []
        covered: set[str] = set()
        if post_urls:
            progress(f"fetching {len(post_urls)} post(s) found on Google")
            try:
                fetched = self.bd.instagram_posts(list(post_urls.values()), max(deadline - time.monotonic(), 1), progress, counter)
                errors += fetched.errors
                # A collab post the shop co-published counts as its own (live 2026-10-24: the BOGO post was
                # by an influencer with @26vietcafe.usa as a coauthor).
                authors = lambda p: {(p.handle or "").lower()} | {c.lower() for c in p.coauthors}
                own = [p for p in fetched.posts if authors(p) & set(wanted)]
                own_handles = {h for p in own for h in authors(p) & set(wanted)}
                tagged = [
                    p for p in fetched.posts
                    if p not in own and any(f"@{h}" in p.caption.lower() and h not in own_handles for h in wanted)
                ]
                if tagged:
                    progress(f"using {len(tagged)} post(s) by other accounts that tag the shop (second-hand)")
                posts += own + tagged
                covered = own_handles | {h for h in wanted for p in tagged if f"@{h}" in p.caption.lower()}
            except BrightDataAuthError:
                raise
            except BrightDataError as exc:
                errors.append(f"could not fetch posts found on Google: {exc}")

        # 3. Fallback: profile discovery for shops with nothing yet, if there's time left.
        missing = [h for h in req.handles if h.lower() not in covered]
        if missing and deadline - time.monotonic() >= IG_MIN_RETRY_S:
            progress(f"no posts by or about {', '.join('@' + h for h in missing)} on Google; trying Bright Data profile discovery")
            try:
                found = self.bd.instagram_recent_posts(
                    [f"https://www.instagram.com/{h}/" for h in missing], req.num_of_posts, since,
                    deadline - time.monotonic(), progress, counter,
                )
                posts += found.posts
                errors += found.errors
            except BrightDataTimeout as exc:
                errors.append(f"profile discovery ran out of time: {exc}")
        elif missing:
            errors += [f"@{h}: no recent posts found" for h in missing]

        recent = [p for p in posts if p.posted_at is None or p.posted_at.date() >= since]
        if len(recent) < len(posts):
            progress(f"dropped {len(posts) - len(recent)} post(s) older than {since.isoformat()}")
        docs = from_instagram(recent, req.location.timezone)
        context = SearchRequest(location=req.location, radius_miles=req.radius_miles)
        raw, usage = self._extract(docs, context, today, errors, progress)
        return self._respond(docs, raw, usage, today, errors, counter, [f"@{h}" for h in req.handles], "brightdata_instagram")

    def _extract(
        self,
        docs: list[SourceDoc],
        context: SearchRequest,
        today: date,
        errors: list[str],
        on_progress: Optional[Callable[[str], None]] = None,
    ) -> tuple[list[RawDeal], Usage]:
        return extract_docs(self.anthropic, self.model, docs, context, today, errors, on_progress)

    def _respond(
        self,
        docs: list[SourceDoc],
        raw: list[RawDeal],
        usage: Usage,
        today: date,
        errors: list[str],
        counter: RequestCounter,
        queries: list[str],
        provider: Provider,
        fetched_codes: Optional[set[str]] = None,
    ) -> SearchResponse:
        sources, deals, rejected = verify_docs(docs, raw, today)
        for d in deals:
            if fetched_codes and ig_shortcode(d.source_url) in fetched_codes:
                d.flags.append("full_post_fetched")
        shops = link_deals(deals, docs, [])
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
            shops=shops,
        )
