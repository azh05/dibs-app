import threading
from datetime import date

import anthropic
import httpx
import pytest
from fastapi.testclient import TestClient

from app.brightdata import BrightDataAuthError, BrightDataError, BrightDataTimeout
from app.jobs import JobStore
from app.apify import ApifyAuthError, ApifyError, ApifyTimeout
from app.main import app, get_extractor, get_jobs, get_pipeline, get_shop_pipeline
from app.schemas import SearchResponse, Usage


class StubExtractor:
    def __init__(self):
        self.requests = []

    def search(self, req):
        self.requests.append(req)
        return SearchResponse(as_of=date(2026, 10, 23), deals=[], rejected=[], queries=["q"], sources=[], usage=Usage())


def client_with_stub():
    stub = StubExtractor()
    app.dependency_overrides[get_extractor] = lambda: stub
    return TestClient(app), stub


def test_health():
    assert TestClient(app).get("/health").json() == {"status": "ok"}


def test_search_endpoint_passes_request():
    client, stub = client_with_stub()
    body = {"location": {"neighborhood": "Westwood"}, "radius_miles": 2, "categories": ["drink"], "shop": "Milksha"}
    r = client.post("/extract/search", json=body)
    assert r.status_code == 200
    assert r.json()["queries"] == ["q"]
    req = stub.requests[0]
    assert req.location.neighborhood == "Westwood" and req.radius_miles == 2
    app.dependency_overrides.clear()


def test_search_endpoint_validates_input():
    client, _ = client_with_stub()
    assert client.post("/extract/search", json={"radius_miles": 0}).status_code == 422
    assert client.post("/extract/search", json={"max_searches": 50}).status_code == 422
    app.dependency_overrides.clear()


# --- Bright Data endpoints --------------------------------------------------------

def bd_response(provider):
    return SearchResponse(
        as_of=date(2026, 10, 23), deals=[], rejected=[], queries=["q"], sources=[], usage=Usage(), provider=provider, brightdata_requests=2
    )


class StubPipeline:
    def __init__(self, error=None, ready_error=None, gate=None):
        self.error, self.ready_error, self.gate = error, ready_error, gate
        self.requests = []

    def check_ready(self):
        if self.ready_error:
            raise self.ready_error

    def run_serp(self, req):
        self.requests.append(req)
        if self.error:
            raise self.error
        return bd_response("brightdata_serp")

    def run_instagram(self, req, on_progress=None):
        self.requests.append(req)
        on_progress("started Bright Data job s_1")
        if self.gate:
            self.gate.wait(5)
        if self.error:
            raise self.error
        return bd_response("brightdata_instagram")


class InlineExecutor:
    def submit(self, fn, *args):
        fn(*args)


@pytest.fixture
def bd_client():
    def make(pipeline=None, jobs=None):
        pipeline = pipeline or StubPipeline()
        jobs = jobs or JobStore(executor=InlineExecutor())
        app.dependency_overrides[get_pipeline] = lambda: pipeline
        app.dependency_overrides[get_jobs] = lambda: jobs
        return TestClient(app), pipeline

    yield make
    app.dependency_overrides.clear()


def test_serp_endpoint(bd_client):
    client, stub = bd_client()
    r = client.post("/extract/serp", json={"location": {"neighborhood": "Westwood"}, "categories": ["drink"], "max_queries": 2})
    assert r.status_code == 200
    assert r.json()["provider"] == "brightdata_serp" and r.json()["brightdata_requests"] == 2
    assert stub.requests[0].max_queries == 2 and stub.requests[0].past_month is True


def test_serp_endpoint_validates_input(bd_client):
    client, _ = bd_client()
    assert client.post("/extract/serp", json={"max_queries": 9}).status_code == 422
    assert client.post("/extract/serp", json={"radius_miles": 0}).status_code == 422


@pytest.mark.parametrize(
    "error,status",
    [
        (BrightDataAuthError("x"), 500),
        (BrightDataTimeout("x"), 504),
        (BrightDataError("x"), 502),
        (anthropic.AuthenticationError("bad", response=httpx.Response(401, request=httpx.Request("POST", "https://x")), body=None), 500),
    ],
)
def test_serp_error_mapping(bd_client, error, status):
    client, _ = bd_client(StubPipeline(error=error))
    r = client.post("/extract/serp", json={})
    assert r.status_code == status
    if isinstance(error, BrightDataAuthError):
        assert r.json()["detail"] == "BRIGHTDATA_API_KEY missing or invalid"


def test_instagram_job_flow(bd_client):
    client, stub = bd_client()
    r = client.post("/extract/instagram", json={"handles": ["@Milksha_CA", "https://www.instagram.com/boba_guys/"], "num_of_posts": 5})
    assert r.status_code == 202
    job = r.json()
    assert job["status_url"] == f"/extract/instagram/{job['job_id']}"
    assert stub.requests[0].handles == ["Milksha_CA", "boba_guys"]
    status = client.get(job["status_url"]).json()
    assert status["status"] == "done" and status["progress"] == ["started Bright Data job s_1"]
    assert status["result"]["provider"] == "brightdata_instagram"


def test_instagram_job_reports_running_then_done(bd_client):
    gate = threading.Event()
    client, _ = bd_client(StubPipeline(gate=gate), jobs=JobStore())
    url = client.post("/extract/instagram", json={"handles": ["milksha_ca"]}).json()["status_url"]
    for _ in range(100):
        status = client.get(url).json()
        if status["progress"]:
            break
        threading.Event().wait(0.01)
    assert status["status"] == "running" and status["result"] is None
    gate.set()
    for _ in range(100):
        status = client.get(url).json()
        if status["status"] == "done":
            break
        threading.Event().wait(0.01)
    assert status["status"] == "done"


def test_instagram_job_failure_carries_status_code(bd_client):
    client, _ = bd_client(StubPipeline(error=BrightDataTimeout("job s_1 was not ready after 300s")))
    url = client.post("/extract/instagram", json={"handles": ["milksha_ca"]}).json()["status_url"]
    status = client.get(url).json()
    assert status["status"] == "failed"
    assert status["error"]["status_code"] == 504 and "300s" in status["error"]["detail"]


def test_instagram_missing_key_fails_fast(bd_client):
    client, stub = bd_client(StubPipeline(ready_error=BrightDataAuthError("BRIGHTDATA_API_KEY is not set")))
    r = client.post("/extract/instagram", json={"handles": ["milksha_ca"]})
    assert r.status_code == 500 and stub.requests == []


def test_instagram_validates_input(bd_client):
    client, _ = bd_client()
    assert client.post("/extract/instagram", json={"handles": []}).status_code == 422
    assert client.post("/extract/instagram", json={"handles": ["not a handle!"]}).status_code == 422
    assert client.post("/extract/instagram", json={"handles": ["https://evil.example/x"]}).status_code == 422
    assert client.post("/extract/instagram", json={"handles": [f"h{i}" for i in range(21)]}).status_code == 422
    assert client.post("/extract/instagram", json={"handles": ["a"], "num_of_posts": 21}).status_code == 422


def test_unknown_job_404(bd_client):
    client, _ = bd_client()
    assert client.get("/extract/instagram/nope").status_code == 404


# --- Apify shops endpoint ---------------------------------------------------------

class StubShopPipeline:
    def __init__(self, error=None, ready_error=None):
        self.error, self.ready_error = error, ready_error
        self.requests = []

    def check_ready(self):
        if self.ready_error:
            raise self.ready_error

    def run(self, req, on_progress=None):
        self.requests.append(req)
        on_progress("found 3 shop(s) on Google Maps")
        if self.error:
            raise self.error
        return bd_response("apify_shops").model_copy(update={"brightdata_requests": 0, "apify_runs": 5})


@pytest.fixture
def shops_client():
    def make(pipeline=None):
        pipeline = pipeline or StubShopPipeline()
        app.dependency_overrides[get_shop_pipeline] = lambda: pipeline
        jobs = JobStore(executor=InlineExecutor())
        app.dependency_overrides[get_jobs] = lambda: jobs
        return TestClient(app), pipeline

    yield make
    app.dependency_overrides.clear()


def test_shops_job_flow(shops_client):
    client, stub = shops_client()
    r = client.post("/extract/shops", json={"location": {"neighborhood": "Westwood"}, "search_terms": ["boba"], "max_shops": 3})
    assert r.status_code == 202
    job = r.json()
    assert job["status_url"] == f"/extract/shops/{job['job_id']}"
    status = client.get(job["status_url"]).json()
    assert status["status"] == "done" and status["progress"] == ["found 3 shop(s) on Google Maps"]
    assert status["result"]["provider"] == "apify_shops" and status["result"]["apify_runs"] == 5
    req = stub.requests[0]
    assert req.max_shops == 3 and req.channels == ["instagram", "tiktok", "facebook", "website"] and req.sweep


@pytest.mark.parametrize("error,status", [(ApifyAuthError("x"), 500), (ApifyTimeout("x"), 504), (ApifyError("x"), 502)])
def test_shops_job_error_mapping(shops_client, error, status):
    client, _ = shops_client(StubShopPipeline(error=error))
    url = client.post("/extract/shops", json={}).json()["status_url"]
    job = client.get(url).json()
    assert job["status"] == "failed" and job["error"]["status_code"] == status


def test_shops_missing_token_fails_fast(shops_client):
    client, stub = shops_client(StubShopPipeline(ready_error=ApifyAuthError("APIFY_TOKEN is not set")))
    r = client.post("/extract/shops", json={})
    assert r.status_code == 500 and "APIFY_TOKEN" in r.json()["detail"]
    assert stub.requests == []


def test_shops_validates_input(shops_client):
    client, _ = shops_client()
    assert client.post("/extract/shops", json={"max_shops": 61}).status_code == 422
    assert client.post("/extract/shops", json={"channels": ["myspace"]}).status_code == 422
    assert client.post("/extract/shops", json={"days": 0}).status_code == 422
    assert client.get("/extract/shops/nope").status_code == 404
