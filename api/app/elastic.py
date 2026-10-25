"""Elastic Serverless as the search and agent layer: every verified deal is indexed with a Jina `semantic_text`
field, /search/deals runs hybrid (meaning + keyword + distance) search over it, and /agent/ask talks to an
Agent Builder agent whose tools are ES|QL queries over the same index. `python -m app.elastic setup` creates the
indices, tools and agent; the workflows in api/elastic/workflows/ are pasted into Kibana (see README "Elastic")."""
from __future__ import annotations

import json
import logging
import os
import re
import sys
from datetime import datetime, time, timezone
from zoneinfo import ZoneInfo
from pathlib import Path
from typing import Any, Optional

import httpx

from .linking import deal_id
from .schemas import (
    AskRequest,
    AskResponse,
    Deal,
    DealSearchRequest,
    DealSearchResponse,
    SearchResponse,
    Shop,
)

# A watch alerts only on deals this similar to what was asked for (Jina similarity; tune with real data).
WATCH_MIN_SCORE = float(os.getenv("DIBS_WATCH_MIN_SCORE", "0.75"))
WATCH_LOOKBACK = "now-1h"


log = logging.getLogger(__name__)

DEALS_INDEX = os.getenv("DIBS_DEALS_INDEX", "dibs-deals")
WATCHES_INDEX = os.getenv("DIBS_WATCHES_INDEX", "dibs-watches")
AGENT_ID = os.getenv("ELASTIC_AGENT_ID", "dibs")

# Pinned: Serverless's default semantic_text model today, multilingual. Elastic warns the default can change,
# and mixing models in one index ranks badly, so the mapping names it.
JINA_INFERENCE_ID = ".jina-embeddings-v5-text-small"

# Deals carry local dates and times without a zone; every launch area is in California.
DEAL_TZ = ZoneInfo(os.getenv("DIBS_TIMEZONE", "America/Los_Angeles"))

HTTP_TIMEOUT_S = 60
WORKFLOWS_DIR = Path(__file__).resolve().parent.parent / "elastic" / "workflows"
DEAL_ID_RE = re.compile(r"deal:[0-9a-f]{16}")


class ElasticError(Exception):
    """Any Elastic failure we can't recover from."""


class ElasticAuthError(ElasticError):
    """ELASTIC_API_KEY missing or rejected."""


class ElasticNotConfigured(ElasticError):
    """ELASTIC_URL (or KIBANA_URL for the agent) isn't set."""


class ElasticClient:
    """Raw REST calls to Elasticsearch and Kibana with one API key (`Authorization: ApiKey <encoded>`)."""

    def __init__(
        self,
        url: Optional[str] = None,
        kibana_url: Optional[str] = None,
        api_key: Optional[str] = None,
        http: Optional[httpx.Client] = None,
    ):
        self.url = (url or os.getenv("ELASTIC_URL") or "").rstrip("/")
        self.kibana_url = (kibana_url or os.getenv("KIBANA_URL") or "").rstrip("/")
        self.api_key = api_key or os.getenv("ELASTIC_API_KEY")
        self.http = http or httpx.Client(timeout=HTTP_TIMEOUT_S)

    @property
    def configured(self) -> bool:
        return bool(self.url and self.api_key)

    def es(self, method: str, path: str, body: Any = None, ndjson: Optional[str] = None, ok404: bool = False) -> Any:
        if not self.configured:
            raise ElasticNotConfigured("ELASTIC_URL and ELASTIC_API_KEY must be set")
        headers = {"Content-Type": "application/x-ndjson"} if ndjson is not None else {}
        return self._send(method, f"{self.url}{path}", body, ndjson, headers, ok404)

    def kibana(self, method: str, path: str, body: Any = None, ok404: bool = False) -> Any:
        if not (self.kibana_url and self.api_key):
            raise ElasticNotConfigured("KIBANA_URL and ELASTIC_API_KEY must be set")
        return self._send(method, f"{self.kibana_url}{path}", body, None, {"kbn-xsrf": "true"}, ok404)

    def _send(self, method: str, url: str, body: Any, content: Optional[str], headers: dict, ok404: bool) -> Any:
        headers = {"Authorization": f"ApiKey {self.api_key}", **headers}
        try:
            if content is not None:
                resp = self.http.request(method, url, content=content, headers=headers)
            else:
                resp = self.http.request(method, url, json=body, headers=headers)
        except httpx.HTTPError as exc:
            raise ElasticError(f"{method} {url}: {exc}") from exc
        if resp.status_code in (401, 403):
            raise ElasticAuthError(f"{resp.status_code} from Elastic: {resp.text[:200]}")
        if resp.status_code == 404 and ok404:
            return None
        if resp.status_code >= 400:
            raise ElasticError(f"{method} {url} -> {resp.status_code}: {resp.text[:300]}")
        return resp.json() if resp.content else {}


DEALS_MAPPING = {
    "properties": {
        "deal_id": {"type": "keyword"},
        "search_text": {"type": "semantic_text", "inference_id": JINA_INFERENCE_ID},
        "shop_name": {"type": "text", "fields": {"keyword": {"type": "keyword"}}},
        "offer": {"type": "text"},
        "conditions": {"type": "text"},
        "verbatim_quote": {"type": "text"},
        "code": {"type": "keyword"},
        "category": {"type": "keyword"},
        "status": {"type": "keyword"},
        "confidence": {"type": "keyword"},
        "flags": {"type": "keyword"},
        "provider": {"type": "keyword"},
        "shop_id": {"type": "keyword"},
        "area": {"type": "keyword"},
        "address": {"type": "text"},
        "source_url": {"type": "keyword"},
        "location": {"type": "geo_point"},
        "start_date": {"type": "date"},
        "end_date": {"type": "date"},
        "end_time": {"type": "keyword"},
        # The end as an instant (end_date + end_time, or the end of that day, in DEAL_TZ); compared against now.
        "ends_at": {"type": "date"},
        "source_post_date": {"type": "date"},
        "indexed_at": {"type": "date"},
        # The verified Deal exactly as the API returned it, so search results rebuild it without loss.
        "deal": {"type": "object", "enabled": False},
    }
}

WATCHES_MAPPING = {
    "properties": {
        "query": {"type": "semantic_text", "inference_id": JINA_INFERENCE_ID},
        "query_text": {"type": "keyword"},
        "location": {"type": "geo_point"},
        "radius_m": {"type": "integer"},
        "push_token": {"type": "keyword"},
        "created_at": {"type": "date"},
        "last_matched_at": {"type": "date"},
    }
}


def _iso(value: Any) -> Optional[str]:
    return value.isoformat() if value is not None else None


def ends_at(deal: Deal) -> Optional[str]:
    if not deal.end_date:
        return None
    at = deal.end_time or time(23, 59, 59)
    return datetime.combine(deal.end_date, at, tzinfo=DEAL_TZ).isoformat()


def deal_doc(deal: Deal, shop: Optional[Shop], provider: str, area: Optional[str], now: datetime) -> dict[str, Any]:
    """One index document. `search_text` holds the original quote, so a post in Chinese or Spanish is embedded
    as written and Jina matches it from an English query."""
    did = deal.id or deal_id(deal)
    lat = shop.lat if shop else None
    lng = shop.lng if shop else None
    text = " · ".join(
        part for part in [deal.offer, deal.shop_name, "; ".join(deal.conditions), deal.verbatim_quote] if part
    )
    return {
        "deal_id": did,
        "search_text": text,
        "shop_name": deal.shop_name,
        "offer": deal.offer,
        "conditions": deal.conditions,
        "verbatim_quote": deal.verbatim_quote,
        "code": deal.code,
        "category": deal.category.value,
        "status": deal.status.value,
        "confidence": deal.confidence.value,
        "flags": deal.flags,
        "provider": provider,
        "shop_id": deal.shop_id,
        "area": area,
        "address": deal.address or (shop.address if shop else None),
        "source_url": deal.source_url,
        "location": {"lat": lat, "lon": lng} if lat is not None and lng is not None else None,
        "start_date": _iso(deal.start_date),
        "end_date": _iso(deal.end_date),
        "end_time": deal.end_time.strftime("%H:%M") if deal.end_time else None,
        "ends_at": ends_at(deal),
        "source_post_date": _iso(deal.source_post_date),
        "indexed_at": now.isoformat(),
        "deal": deal.model_copy(update={"id": did}).model_dump(mode="json"),
    }


def _point(value: Any) -> Optional[dict[str, float]]:
    """A geo_point as the dibs-watch workflow writes it ("lat,lon") or as an object."""
    try:
        if isinstance(value, str) and "," in value:
            lat, lon = (float(p) for p in value.split(",", 1))
            return {"lat": lat, "lon": lon}
        if isinstance(value, dict) and value.get("lat") is not None and value.get("lon") is not None:
            return {"lat": float(value["lat"]), "lon": float(value["lon"])}
    except ValueError:
        pass
    return None


class DealIndex:
    def __init__(self, client: Optional[ElasticClient] = None, index: str = DEALS_INDEX):
        self.client = client or ElasticClient()
        self.index = index

    def ensure(self) -> None:
        """Create the deals and watches indices, or add any new fields to existing ones (existing fields can't
        change type in place; that needs a new index)."""
        for name, mapping in ((self.index, DEALS_MAPPING), (WATCHES_INDEX, WATCHES_MAPPING)):
            if self.client.es("HEAD", f"/{name}", ok404=True) is None:
                self.client.es("PUT", f"/{name}", {"mappings": mapping})
            else:
                self.client.es("PUT", f"/{name}/_mapping", mapping)

    def index_response(self, resp: SearchResponse, area: Optional[str] = None) -> Optional[str]:
        """Bulk-index every verified deal. Returns a note for search_errors on failure; never raises, so a
        search-index problem can't fail an extract the user already paid for."""
        if not resp.deals:
            return None
        shops = {s.id: s for s in resp.shops}
        now = datetime.now(timezone.utc)
        lines = []
        for deal in resp.deals:
            doc = deal_doc(deal, shops.get(deal.shop_id or ""), resp.provider, area, now)
            lines.append(json.dumps({"index": {"_index": self.index, "_id": doc["deal_id"]}}))
            lines.append(json.dumps(doc, ensure_ascii=False))
        try:
            result = self.client.es("POST", "/_bulk", ndjson="\n".join(lines) + "\n")
        except ElasticError as exc:
            log.warning("Elastic indexing failed: %s", exc)
            return f"elastic: could not index deals ({exc})"
        if result.get("errors"):
            failed = [i["index"].get("error", {}).get("reason") for i in result.get("items", []) if i["index"].get("error")]
            return f"elastic: {len(failed)} of {len(resp.deals)} deals not indexed ({failed[0]})"
        return None

    def search(self, req: DealSearchRequest) -> DealSearchResponse:
        filters: list[dict[str, Any]] = [
            {"terms": {"status": [s.value for s in req.statuses]}},
            # Deals without an end date stay in; the status rules already age those out.
            {"bool": {"should": [{"range": {"ends_at": {"gte": "now"}}}, {"bool": {"must_not": {"exists": {"field": "ends_at"}}}}]}},
        ]
        if req.categories:
            filters.append({"terms": {"category": [c.value for c in req.categories]}})
        if req.lat is not None and req.lng is not None:
            filters.append({"geo_distance": {"distance": f"{req.radius_miles}mi", "location": {"lat": req.lat, "lon": req.lng}}})

        q = req.query.strip()
        if q:
            body: dict[str, Any] = {
                "retriever": {
                    "rrf": {
                        # rrf ranks within this window, which must cover the page size.
                        "rank_window_size": max(50, req.limit),
                        "retrievers": [
                            {"standard": {"query": {"bool": {"must": {"semantic": {"field": "search_text", "query": q}}, "filter": filters}}}},
                            {
                                "standard": {
                                    "query": {
                                        "bool": {
                                            "must": {"multi_match": {"query": q, "fields": ["offer^2", "shop_name", "conditions"]}},
                                            "filter": filters,
                                        }
                                    }
                                }
                            },
                        ]
                    }
                },
                "size": req.limit,
            }
        else:
            body = {"query": {"bool": {"filter": filters}}, "sort": [{"indexed_at": "desc"}], "size": req.limit}
        result = self.client.es("POST", f"/{self.index}/_search", {**body, "_source": ["deal"]})
        hits = result.get("hits", {})
        deals = [Deal.model_validate(h["_source"]["deal"]) for h in hits.get("hits", []) if h.get("_source", {}).get("deal")]
        total = hits.get("total", {})
        return DealSearchResponse(deals=deals, total=total.get("value", len(deals)) if isinstance(total, dict) else total)

    def match_watch(self, watch_id: str) -> tuple[Optional[dict[str, Any]], list[Deal]]:
        """New deals since the watch last matched that are close to its query and within its radius."""
        found = self.client.es("GET", f"/{WATCHES_INDEX}/_doc/{watch_id}", ok404=True)
        if not found or not found.get("found"):
            return None, []
        watch = found["_source"]
        since = watch.get("last_matched_at") or WATCH_LOOKBACK
        filters: list[dict[str, Any]] = [
            {"terms": {"status": ["live", "needs_check"]}},
            {"range": {"indexed_at": {"gt": since}}},
        ]
        loc = _point(watch.get("location"))
        if loc:
            radius = int(float(watch.get("radius_m") or 1600))
            filters.append({"geo_distance": {"distance": f"{radius}m", "location": loc}})
        text = watch.get("query_text") or ""
        result = self.client.es(
            "POST",
            f"/{self.index}/_search",
            {
                "query": {"bool": {"must": {"semantic": {"field": "search_text", "query": text}}, "filter": filters}},
                "min_score": WATCH_MIN_SCORE,
                "size": 5,
                "_source": ["deal"],
            },
        )
        deals = [Deal.model_validate(h["_source"]["deal"]) for h in result.get("hits", {}).get("hits", [])]
        return watch, deals

    def mark_watch(self, watch_id: str) -> None:
        self.client.es(
            "POST",
            f"/{WATCHES_INDEX}/_update/{watch_id}",
            {"doc": {"last_matched_at": datetime.now(timezone.utc).isoformat()}},
        )

    def get_deals(self, ids: list[str]) -> list[Deal]:
        if not ids:
            return []
        result = self.client.es("POST", f"/{self.index}/_mget", {"ids": ids, "_source": ["deal"]})
        return [Deal.model_validate(d["_source"]["deal"]) for d in result.get("docs", []) if d.get("found")]


# ---- Agent Builder ----------------------------------------------------------------------------------------

LIVE = '(status IN ("live", "needs_check")) AND (ends_at IS NULL OR ends_at >= NOW())'
KEEP = "KEEP deal_id, shop_name, offer, status, end_date, end_time, address, source_url"

ESQL_TOOLS: list[dict[str, Any]] = [
    {
        "id": "dibs.search_deals",
        "description": "Find live deals by meaning, in any language (e.g. 'cheap haircut', 'boba buy one get one'). "
        "Use for any question about what deals exist.",
        "query": f"FROM {DEALS_INDEX} METADATA _score | WHERE MATCH(search_text, ?query) AND {LIVE} "
        f"| SORT _score DESC | {KEEP} | LIMIT 10",
        "params": {"query": {"type": "string", "description": "What the user is looking for, in their words"}},
    },
    {
        "id": "dibs.deals_near",
        "description": "Live deals within a distance of a point, nearest first. Use when the user gives or implies "
        "a location ('near me', 'by UCLA'); the question says 'User is at lat,lng' when known.",
        "query": f"FROM {DEALS_INDEX} | WHERE {LIVE} AND location IS NOT NULL "
        '| EVAL distance_m = ST_DISTANCE(location, TO_GEOPOINT(CONCAT("POINT(", TO_STRING(?lng), " ", TO_STRING(?lat), ")"))) '
        f"| WHERE distance_m <= ?meters | SORT distance_m ASC | {KEEP}, distance_m | LIMIT 10",
        "params": {
            "lat": {"type": "float", "description": "Latitude"},
            "lng": {"type": "float", "description": "Longitude"},
            "meters": {"type": "integer", "description": "Search radius in meters (1 mile is about 1600)"},
        },
    },
    {
        "id": "dibs.ending_soon",
        "description": "Live deals ending within about a day and a half (today or tomorrow), soonest first.",
        "query": f"FROM {DEALS_INDEX} | WHERE {LIVE} AND ends_at <= NOW() + 36 hours "
        f"| SORT ends_at ASC | {KEEP} | LIMIT 10",
        "params": {},
    },
    {
        "id": "dibs.deals_at_shop",
        "description": "All current deals at one shop, by name.",
        "query": f"FROM {DEALS_INDEX} | WHERE MATCH(shop_name, ?shop) AND {LIVE} | {KEEP} | LIMIT 10",
        "params": {"shop": {"type": "string", "description": "Shop name, e.g. 'Tapioca Lab'"}},
    },
]

# Created in Kibana from api/elastic/workflows/ (Workflow tools need a workflow id that only exists after that).
WORKFLOW_TOOL_IDS = ["dibs.watch_deals", "dibs.scan_area"]

AGENT_INSTRUCTIONS = """You are dibs, a deal-finding agent for college students.
- Answer only from tool results. Never invent a deal, price, shop or date.
- For each deal, give the shop, the offer, and when it ends (or "no end date posted"). Keep deal_id values out of the
  text, but always call a tool so the app can show the deals as cards.
- Prefer dibs.deals_near when the question includes "User is at lat,lng"; use about 1600 meters unless the user says.
- If the user asks to be told about future deals ("let me know when...", "watch for..."), call dibs.watch_deals.
- If the user asks to check an area right now or nothing is found for an area, offer dibs.scan_area and call it if
  they agree. Say a scan takes a few minutes.
- Say plainly when nothing matches. Answer in the user's language. Keep answers short: this is read on a phone."""


def _find_deal_ids(value: Any) -> list[str]:
    """Deal ids anywhere in the converse steps (tool results are ES|QL columns/values or JSON)."""
    found: list[str] = []
    if isinstance(value, str):
        found.extend(DEAL_ID_RE.findall(value))
    elif isinstance(value, dict):
        for v in value.values():
            found.extend(_find_deal_ids(v))
    elif isinstance(value, list):
        for v in value:
            found.extend(_find_deal_ids(v))
    return found


class DibsAgent:
    def __init__(self, client: Optional[ElasticClient] = None, agent_id: str = AGENT_ID):
        self.client = client or ElasticClient()
        self.agent_id = agent_id

    def ask(self, req: AskRequest) -> AskResponse:
        prompt = req.question.strip()
        context = []
        if req.lat is not None and req.lng is not None:
            context.append(f"User is at {req.lat:.5f},{req.lng:.5f}")
        if req.push_token:
            context.append(f"push_token for watches: {req.push_token}")
        if context:
            prompt = f"({'; '.join(context)})\n{prompt}"
        body: dict[str, Any] = {"input": prompt, "agent_id": self.agent_id}
        if req.conversation_id:
            body["conversation_id"] = req.conversation_id
        result = self.client.kibana("POST", "/api/agent_builder/converse", body)
        ids = list(dict.fromkeys(_find_deal_ids(result.get("steps", []))))
        return AskResponse(
            answer=(result.get("response") or {}).get("message", ""),
            conversation_id=result.get("conversation_id"),
            deal_ids=ids,
        )


def setup(client: Optional[ElasticClient] = None, out=sys.stdout) -> None:
    """Idempotent: indices created or extended; the agent and its ES|QL tools are deleted and recreated."""
    client = client or ElasticClient()
    DealIndex(client).ensure()
    print(f"indices ready: {DEALS_INDEX}, {WATCHES_INDEX}", file=out)

    # Tools in use by an agent can't be deleted, so the agent goes first.
    client.kibana("DELETE", f"/api/agent_builder/agents/{AGENT_ID}", ok404=True)
    for tool in ESQL_TOOLS:
        client.kibana("DELETE", f"/api/agent_builder/tools/{tool['id']}", ok404=True)
        client.kibana(
            "POST",
            "/api/agent_builder/tools",
            {
                "id": tool["id"],
                "type": "esql",
                "description": tool["description"],
                "configuration": {"query": tool["query"], "params": tool["params"]},
            },
        )
        print(f"tool: {tool['id']}", file=out)

    tool_ids = [t["id"] for t in ESQL_TOOLS]
    missing = []
    for wf in WORKFLOW_TOOL_IDS:
        if client.kibana("GET", f"/api/agent_builder/tools/{wf}", ok404=True) is None:
            missing.append(wf)
        else:
            tool_ids.append(wf)

    client.kibana(
        "POST",
        "/api/agent_builder/agents",
        {
            "id": AGENT_ID,
            "name": "dibs",
            "description": "Finds live local deals and can watch for new ones or scan an area.",
            "configuration": {"instructions": AGENT_INSTRUCTIONS, "tools": [{"tool_ids": tool_ids}]},
        },
    )
    print(f"agent: {AGENT_ID} with {', '.join(tool_ids)}", file=out)
    if missing:
        print(
            "\nNot attached yet (workflow tools): " + ", ".join(missing) + "\n"
            f"1. In Kibana > Workflows, create one workflow per file in {WORKFLOWS_DIR} (paste the YAML).\n"
            "2. Agents > Tools > New tool > Workflow: dibs-watch -> id dibs.watch_deals, dibs-scan -> id dibs.scan_area.\n"
            "3. Run this setup again to attach them to the agent.",
            file=out,
        )


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    if sys.argv[1:] != ["setup"]:
        sys.exit("usage: python -m app.elastic setup")
    setup()
