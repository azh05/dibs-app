from datetime import date

from fastapi.testclient import TestClient

from app.main import app, get_extractor
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
