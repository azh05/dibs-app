"""Claude call: web search for local deals, then return them through a strict tool schema."""
from __future__ import annotations

import copy
import logging
import os
from datetime import date, datetime
from typing import Any, Optional
from zoneinfo import ZoneInfo

import anthropic
from pydantic import ValidationError

from .schemas import (
    RawDeal,
    SearchRequest,
    SearchResponse,
    SearchResultSource,
    Usage,
)
from .verify import verify_deals

log = logging.getLogger(__name__)

DEFAULT_MODEL = os.getenv("DIBS_MODEL", "claude-opus-5-5")
WEB_SEARCH_TOOL_TYPE = "web_search_20250305"
RECORD_TOOL_NAME = "record_deals"
MAX_TURNS = 4
DATE_FIELDS = ("start_date", "end_date", "source_post_date", "start_time", "end_time")

DEAL_TYPES = """\
You find current, short-lived deals at small local businesses: grand-opening specials, \
BOGO offers, promo codes, sign-up bonuses, collab drinks, happy hours, limited-time menu deals.
"""

SEARCH_INSTRUCTIONS = """
How to work:
- Use web search. Instagram posts from shops are often the best source, so try queries like \
"<shop or neighborhood> deal", "<neighborhood> grand opening", "<shop> promo code", and \
site:instagram.com searches.
- Prefer independent and small local shops over national chains.
- Stay within the user's area and radius.

Rules for every deal you record:
- Only record deals you saw in a search result in this conversation. source_url must be the exact \
URL of that result.
"""

# Shared with the Bright Data pipeline (bd_pipeline.py), which supplies its own source rule.
DEAL_RULES = """\
- verbatim_quote must be copied word for word from the source and must support the offer. If a \
promo code is recorded, the code must appear in the quote.
- Never infer or guess an end_date. If the source doesn't state one, use null.
- source_post_date is when the post or page was published, only if the source shows it.
- Put fine print in conditions: in-store only, first order only, minimum spend, while supplies last, \
app sign-up required, and so on.
- If an old post and a new post disagree, record them as separate deals with their own dates. \
Don't merge them.
- Use confidence "low" when the source is ambiguous, second-hand, or you're unsure the deal is current.
- One deal per distinct offer. Skip anything that isn't a deal (menus, reviews, general posts).
"""

SEARCH_FINISH = """
When you're done searching, call the record_deals tool exactly once with every deal you found. \
If you found none, call it with an empty list.
"""

SYSTEM_PROMPT = DEAL_TYPES + SEARCH_INSTRUCTIONS + DEAL_RULES + SEARCH_FINISH


def _inline_refs(schema: dict[str, Any]) -> dict[str, Any]:
    """Pydantic emits $defs/$ref; inline them so the tool schema is self-contained."""
    defs = schema.pop("$defs", {})

    def resolve(node: Any) -> Any:
        if isinstance(node, dict):
            if "$ref" in node:
                name = node["$ref"].split("/")[-1]
                return resolve(copy.deepcopy(defs[name]))
            return {k: resolve(v) for k, v in node.items()}
        if isinstance(node, list):
            return [resolve(v) for v in node]
        return node

    return resolve(schema)


def record_tool_definition() -> dict[str, Any]:
    deal_schema = _inline_refs(RawDeal.model_json_schema())
    return {
        "name": RECORD_TOOL_NAME,
        "description": "Record every deal found in this search session. Call exactly once.",
        "input_schema": {
            "type": "object",
            "properties": {"deals": {"type": "array", "items": deal_schema}},
            "required": ["deals"],
        },
    }


def web_search_tool_definition(req: SearchRequest) -> dict[str, Any]:
    loc = req.location
    tool: dict[str, Any] = {
        "type": WEB_SEARCH_TOOL_TYPE,
        "name": "web_search",
        "max_uses": req.max_searches,
        "user_location": {
            "type": "approximate",
            "city": loc.city,
            "region": loc.region,
            "country": loc.country,
            "timezone": loc.timezone,
        },
    }
    if req.allowed_domains:
        tool["allowed_domains"] = req.allowed_domains
    return tool


def build_user_prompt(req: SearchRequest, today: date) -> str:
    loc = req.location
    area = f"{loc.neighborhood}, {loc.city}" if loc.neighborhood else loc.city
    lines = [
        f"Today is {today.isoformat()}.",
        f"Find deals within about {req.radius_miles:g} miles of {area}, {loc.region}.",
    ]
    if req.categories:
        lines.append("Categories: " + ", ".join(c.value for c in req.categories) + ".")
    if req.shop:
        lines.append(f"Focus on this shop: {req.shop}.")
    if req.query:
        lines.append(f"Also: {req.query}")
    return "\n".join(lines)


def _today(tz: str) -> date:
    return datetime.now(ZoneInfo(tz)).date()


def _parse_raw_deals(items: list[Any], errors: list[str], model: type[RawDeal] = RawDeal) -> list[RawDeal]:
    """Validate each deal on its own so one bad field doesn't drop the batch."""
    deals: list[RawDeal] = []
    for item in items:
        if not isinstance(item, dict):
            errors.append("dropped a deal that wasn't an object")
            continue
        try:
            deals.append(model.model_validate(item))
            continue
        except ValidationError as exc:
            bad = {str(e["loc"][0]) for e in exc.errors() if e.get("loc")}
        # Unparseable dates and times become null (never guessed); anything else drops the deal.
        if bad and bad <= set(DATE_FIELDS):
            fixed = {**item, **{f: None for f in bad}}
            try:
                deals.append(model.model_validate(fixed))
                errors.append(f"cleared unparseable {', '.join(sorted(bad))} for {item.get('shop_name', '?')}")
                continue
            except ValidationError:
                pass
        errors.append(f"dropped malformed deal from {item.get('shop_name', '?')}: invalid {', '.join(sorted(bad)) or 'fields'}")
    return deals


class DealExtractor:
    def __init__(self, client: Optional[anthropic.Anthropic] = None, model: str = DEFAULT_MODEL):
        self.client = client or anthropic.Anthropic()
        self.model = model

    def search(self, req: SearchRequest, today: Optional[date] = None) -> SearchResponse:
        today = today or _today(req.location.timezone)
        tools = [web_search_tool_definition(req), record_tool_definition()]
        messages: list[dict[str, Any]] = [{"role": "user", "content": build_user_prompt(req, today)}]
        tool_choice: dict[str, Any] = {"type": "auto"}

        usage = Usage()
        queries: list[str] = []
        sources: dict[str, SearchResultSource] = {}
        errors: list[str] = []
        recorded: Optional[list[Any]] = None

        for _ in range(MAX_TURNS):
            resp = self.client.messages.create(
                model=self.model,
                max_tokens=8000,
                system=SYSTEM_PROMPT,
                tools=tools,
                tool_choice=tool_choice,
                messages=messages,
            )
            self._collect(resp, usage, queries, sources, errors)

            call = next(
                (b for b in resp.content if b.type == "tool_use" and b.name == RECORD_TOOL_NAME),
                None,
            )
            if call is not None:
                recorded = (call.input or {}).get("deals", [])
                break

            # Send the assistant turn back unchanged (web search blocks must not be altered).
            messages.append({"role": "assistant", "content": [b.model_dump(exclude_none=True) for b in resp.content]})
            if resp.stop_reason == "pause_turn":
                continue
            # Claude answered in prose: ask for the structured tool on the next turn. (Forcing it with
            # tool_choice {"type": "tool"} returns a 400 on claude-opus-5-5, so tool_choice stays auto.)
            messages.append({"role": "user", "content": "Now call record_deals with every deal you found, or an empty list."})

        if recorded is None:
            errors.append("Claude never called record_deals")
            recorded = []

        raw = _parse_raw_deals(recorded, errors)
        deals, rejected = verify_deals(raw, list(sources.values()), today)
        return SearchResponse(
            as_of=today,
            deals=deals,
            rejected=rejected,
            queries=queries,
            sources=list(sources.values()),
            search_errors=errors,
            usage=usage,
        )

    @staticmethod
    def _collect(resp: Any, usage: Usage, queries: list[str], sources: dict[str, SearchResultSource], errors: list[str]) -> None:
        u = getattr(resp, "usage", None)
        if u is not None:
            usage.input_tokens += getattr(u, "input_tokens", 0) or 0
            usage.output_tokens += getattr(u, "output_tokens", 0) or 0
            stu = getattr(u, "server_tool_use", None)
            usage.web_search_requests += (getattr(stu, "web_search_requests", 0) or 0) if stu else 0

        for block in resp.content:
            if block.type == "server_tool_use" and block.name == "web_search":
                q = (block.input or {}).get("query")
                if q:
                    queries.append(q)
            elif block.type == "web_search_tool_result":
                content = block.content
                if isinstance(content, list):
                    for r in content:
                        if getattr(r, "type", None) == "web_search_result" and r.url not in sources:
                            sources[r.url] = SearchResultSource(url=r.url, title=r.title, page_age=r.page_age)
                else:
                    errors.append(f"web search error: {getattr(content, 'error_code', 'unknown')}")
