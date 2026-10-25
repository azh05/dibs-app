import io
import json
from datetime import date, datetime, time

import httpx
from fastapi.testclient import TestClient

from app import elastic
from app.elastic import DealIndex, DibsAgent, ElasticClient, deal_doc
from app.main import app, get_agent, get_deal_index, get_push, get_shop_pipeline
from app.push import ExpoPush, message, when_line
from app.schemas import AskRequest, Deal, DealSearchRequest, DealStatus, SearchResponse, Shop, Usage

SHOP = Shop(name="Tapioca Lab", place_id="ChIJ1", lat=34.0644, lng=-118.4419, address="1099 Gayley Ave")


def deal(**kw):
    base = dict(
        shop_name="Tapioca Lab",
        offer="BOGO on all milk teas",
        source_url="https://www.instagram.com/p/a/",
        verbatim_quote="買一送一 all milk teas today",
        status=DealStatus.live,
        id="deal:0123456789abcdef",
        shop_id=SHOP.id,
    )
    base.update(kw)
    return Deal(**base)


def response(deals, shops=(SHOP,)):
    return SearchResponse(
        as_of=date(2026, 10, 24), deals=deals, rejected=[], queries=[], sources=[], usage=Usage(),
        provider="apify_shops", shops=list(shops),
    )


def fake_client(handler, kibana=True):
    return ElasticClient(
        url="https://es.test", kibana_url="https://kb.test" if kibana else "", api_key="KEY",
        http=httpx.Client(transport=httpx.MockTransport(handler)),
    )


def test_deal_doc_keeps_quote_location_and_full_deal():
    doc = deal_doc(deal(end_date=date(2026, 10, 24), end_time=time(18, 0)), SHOP, "apify_shops", "Westwood", datetime(2026, 10, 24))
    assert doc["deal_id"] == "deal:0123456789abcdef"
    assert "買一送一" in doc["search_text"] and "Tapioca Lab" in doc["search_text"]
    assert doc["location"] == {"lat": 34.0644, "lon": -118.4419}
    assert doc["end_time"] == "18:00" and doc["area"] == "Westwood"
    assert Deal.model_validate(doc["deal"]).offer == "BOGO on all milk teas"


def test_deal_without_id_or_shop_gets_stable_id_and_no_location():
    d = deal(id=None, shop_id=None)
    doc = deal_doc(d, None, "claude_web_search", None, datetime(2026, 10, 24))
    assert doc["deal_id"].startswith("deal:") and doc["location"] is None


def test_bulk_index_sends_one_op_per_deal_with_api_key():
    seen = {}

    def handler(request):
        seen["path"] = request.url.path
        seen["auth"] = request.headers["authorization"]
        seen["lines"] = request.content.decode().strip().split("\n")
        return httpx.Response(200, json={"errors": False, "items": []})

    note = DealIndex(fake_client(handler)).index_response(response([deal(), deal(id="deal:fedcba9876543210")]), "Westwood")
    assert note is None
    assert seen["path"] == "/_bulk" and seen["auth"] == "ApiKey KEY"
    ops = [json.loads(line) for line in seen["lines"]]
    assert [o["index"]["_id"] for o in ops[::2]] == ["deal:0123456789abcdef", "deal:fedcba9876543210"]
    assert ops[1]["location"]["lat"] == 34.0644


def test_bulk_failure_becomes_a_note_not_an_exception():
    note = DealIndex(fake_client(lambda r: httpx.Response(500, text="boom"))).index_response(response([deal()]))
    assert note and note.startswith("elastic: could not index")


def test_partial_bulk_errors_are_reported():
    body = {"errors": True, "items": [{"index": {"error": {"reason": "mapper failed"}}}]}
    note = DealIndex(fake_client(lambda r: httpx.Response(200, json=body))).index_response(response([deal()]))
    assert "1 of 1" in note and "mapper failed" in note


def test_search_uses_rrf_and_geo_only_with_coords():
    bodies = []

    def handler(request):
        bodies.append(json.loads(request.content))
        hit = {"_source": {"deal": deal().model_dump(mode="json")}}
        return httpx.Response(200, json={"hits": {"total": {"value": 1}, "hits": [hit]}})

    index = DealIndex(fake_client(handler))
    res = index.search(DealSearchRequest(query="milk tea bogo", lat=34.06, lng=-118.44))
    assert res.total == 1 and res.deals[0].shop_name == "Tapioca Lab"
    assert bodies[0]["retriever"]["rrf"]["rank_window_size"] >= bodies[0]["size"]
    rrf = bodies[0]["retriever"]["rrf"]["retrievers"]
    assert rrf[0]["standard"]["query"]["bool"]["must"]["semantic"]["field"] == "search_text"
    filters = rrf[0]["standard"]["query"]["bool"]["filter"]
    assert {"terms": {"status": ["live", "needs_check"]}} in filters
    assert any("geo_distance" in f for f in filters)

    index.search(DealSearchRequest(query=""))
    assert "retriever" not in bodies[1]
    assert not any("geo_distance" in f for f in bodies[1]["query"]["bool"]["filter"])


def test_get_deals_puts_source_filter_in_url_not_body():
    seen = {}

    def handler(request):
        seen["url"] = str(request.url)
        seen["body"] = json.loads(request.content)
        found = {"_id": "deal:a", "found": True, "_source": {"deal": deal().model_dump(mode="json")}}
        return httpx.Response(200, json={"docs": [found, {"_id": "deal:b", "found": False}]})

    deals = DealIndex(fake_client(handler)).get_deals(["deal:a", "deal:b"])
    assert [d.shop_name for d in deals] == ["Tapioca Lab"]
    assert seen["url"].endswith("/dibs-deals/_mget?_source_includes=deal")
    assert seen["body"] == {"ids": ["deal:a", "deal:b"]}


def test_agent_ask_maps_converse_and_collects_deal_ids():
    seen = {}

    def handler(request):
        seen["url"] = str(request.url)
        seen["headers"] = request.headers
        seen["body"] = json.loads(request.content)
        steps = [{"type": "tool_call", "results": [{"data": {"columns": [{"name": "deal_id"}], "values": [["deal:0123456789abcdef"]]}}]}]
        return httpx.Response(200, json={"conversation_id": "c1", "response": {"message": "Tapioca Lab has BOGO."}, "steps": steps})

    res = DibsAgent(fake_client(handler)).ask(AskRequest(question="boba deals?", lat=34.06, lng=-118.44, push_token="ExponentPushToken[x]"))
    assert seen["url"] == "https://kb.test/api/agent_builder/converse"
    assert seen["headers"]["kbn-xsrf"] == "true" and seen["headers"]["authorization"] == "ApiKey KEY"
    assert seen["body"]["agent_id"] == "dibs" and "User is at 34.06000,-118.44000" in seen["body"]["input"]
    assert "ExponentPushToken[x]" in seen["body"]["input"]
    assert res.answer == "Tapioca Lab has BOGO." and res.conversation_id == "c1"
    assert res.deal_ids == ["deal:0123456789abcdef"]


def test_setup_creates_indices_tools_and_agent_and_lists_missing_workflow_tools():
    calls = []

    def handler(request):
        calls.append((request.method, request.url.host, request.url.path))
        if request.method == "HEAD":
            return httpx.Response(404)
        if request.method in ("DELETE", "GET") and "/agent_builder/" in request.url.path:
            return httpx.Response(404, json={})
        return httpx.Response(200, json={})

    out = io.StringIO()
    elastic.setup(fake_client(handler), out=out)
    puts = [p for m, h, p in calls if m == "PUT"]
    assert puts == ["/dibs-deals", "/dibs-watches"]
    tools = [p for m, h, p in calls if m == "POST" and p == "/api/agent_builder/tools"]
    assert len(tools) == len(elastic.ESQL_TOOLS)
    assert ("POST", "kb.test", "/api/agent_builder/agents") in calls
    assert "dibs.watch_deals" in out.getvalue()


def test_match_watch_reads_workflow_point_and_threshold():
    bodies = []

    def handler(request):
        if request.method == "GET":
            src = {"query_text": "ramen", "location": "34.06,-118.44", "radius_m": "1600", "push_token": "tok"}
            return httpx.Response(200, json={"found": True, "_source": src})
        bodies.append(json.loads(request.content))
        return httpx.Response(200, json={"hits": {"hits": [{"_source": {"deal": deal().model_dump(mode="json")}}]}})

    watch, deals = DealIndex(fake_client(handler)).match_watch("w1")
    assert watch["push_token"] == "tok" and len(deals) == 1
    filters = bodies[0]["query"]["bool"]["filter"]
    assert {"geo_distance": {"distance": "1600m", "location": {"lat": 34.06, "lon": -118.44}}} in filters
    assert bodies[0]["min_score"] == elastic.WATCH_MIN_SCORE


def test_when_line_and_push_message():
    assert when_line(deal(end_date=date(2026, 10, 24), end_time=time(18, 0))) == "Ends Oct 24, 6 PM"
    assert when_line(deal(end_date=date(2026, 11, 1))) == "Ends Nov 1"
    assert when_line(deal()) == "Live now"
    m = message("tok", deal(end_date=date(2026, 10, 24), end_time=time(17, 30)))
    assert m["title"] == "Tapioca Lab" and m["body"] == "BOGO on all milk teas\nEnds Oct 24, 5:30 PM"
    assert m["data"] == {"dealId": "deal:0123456789abcdef"}


def test_expo_push_counts_ok_tickets():
    sent = {}

    def handler(request):
        sent["body"] = json.loads(request.content)
        return httpx.Response(200, json={"data": [{"status": "ok"}, {"status": "error"}]})

    n = ExpoPush(http=httpx.Client(transport=httpx.MockTransport(handler))).send("tok", [deal(), deal()])
    assert n == 1 and len(sent["body"]) == 2


# --- endpoints ---------------------------------------------------------------------

class StubIndex:
    def __init__(self):
        self.indexed = []

    def index_response(self, resp, area):
        self.indexed.append((len(resp.deals), area))
        return "elastic: down" if area == "fail" else None

    def search(self, req):
        from app.schemas import DealSearchResponse
        return DealSearchResponse(deals=[deal()], total=1)

    def match_watch(self, watch_id):
        if watch_id == "missing":
            return None, []
        return {"push_token": "tok"}, [deal()]

    def mark_watch(self, watch_id):
        self.marked = watch_id


class StubPush:
    def send(self, token, deals):
        return len(deals)


def test_endpoints_answer_503_without_elastic():
    app.dependency_overrides[get_deal_index] = lambda: None
    app.dependency_overrides[get_agent] = lambda: None
    c = TestClient(app)
    assert c.post("/search/deals", json={"query": "boba"}).status_code == 503
    assert c.post("/agent/ask", json={"question": "boba?"}).status_code == 503
    app.dependency_overrides.clear()


def test_search_and_watch_check_endpoints():
    idx = StubIndex()
    app.dependency_overrides[get_deal_index] = lambda: idx
    app.dependency_overrides[get_push] = lambda: StubPush()
    c = TestClient(app)
    r = c.post("/search/deals", json={"query": "boba", "lat": 34.06, "lng": -118.44})
    assert r.status_code == 200 and r.json()["deals"][0]["shop_name"] == "Tapioca Lab"
    r = c.post("/alerts/check", json={"watch_id": "w1"})
    assert r.json() == {"matched": ["deal:0123456789abcdef"], "sent": 1} and idx.marked == "w1"
    assert c.post("/alerts/check", json={"watch_id": "missing"}).status_code == 404
    app.dependency_overrides.clear()


def test_api_key_required_when_set(monkeypatch):
    monkeypatch.setenv("DIBS_API_KEY", "secret")
    app.dependency_overrides[get_deal_index] = lambda: StubIndex()
    c = TestClient(app)
    assert c.get("/health").status_code == 200
    assert c.post("/search/deals", json={"query": "x"}).status_code == 401
    assert c.post("/search/deals", json={"query": "x"}, headers={"X-Dibs-Key": "wrong"}).status_code == 401
    assert c.post("/search/deals", json={"query": "x"}, headers={"X-Dibs-Key": "secret"}).status_code == 200
    app.dependency_overrides.clear()


def test_shops_job_result_is_indexed_and_failures_noted():
    from app.jobs import JobStore
    from app.main import get_jobs

    class Inline:
        def submit(self, fn, *args):
            fn(*args)

    class Pipeline:
        def check_ready(self):
            pass

        def run(self, req, on_progress=None):
            return response([deal()])

    idx = StubIndex()
    app.dependency_overrides[get_shop_pipeline] = lambda: Pipeline()
    jobs = JobStore(executor=Inline())
    app.dependency_overrides[get_jobs] = lambda: jobs
    app.dependency_overrides[get_deal_index] = lambda: idx
    c = TestClient(app)
    url = c.post("/extract/shops", json={"location": {"neighborhood": "Westwood"}}).json()["status_url"]
    assert c.get(url).json()["status"] == "done"
    assert idx.indexed == [(1, "Westwood")]

    url = c.post("/extract/shops", json={"location": {"neighborhood": "fail"}}).json()["status_url"]
    assert "elastic: down" in c.get(url).json()["result"]["search_errors"]
    app.dependency_overrides.clear()
