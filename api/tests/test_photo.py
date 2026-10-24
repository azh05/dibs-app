"""Photo extraction tests with a fake client returning real SDK Message objects."""
from datetime import date, time

import pytest
from fastapi.testclient import TestClient

from app.main import app, get_photo_extractor
from app.photo import PHOTO_TOOL_NAME, PhotoExtractor, photo_url, resolve_missing_year, sniff_media_type
from app.schemas import DealStatus

from tests.test_extractor import FakeClient, msg

TODAY = date(2026, 10, 24)
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
URL = photo_url(PNG)

TRANSCRIPT = (
    "CHIPOTLE\nFREE CHIPOTLE BOGO ENTRÉE\nCOME INTO CHIPOTLE ON JULY 6TH FROM 3PM TO CLOSE\n"
    "FOR A BUY ONE ENTRÉE, GET ONE FREE\nLIMIT 2/CUSTOMER. XTRA COST FOR SOME ITEMS. IN-RESTAURANT ORDERS ONLY."
)

CHIPOTLE = {
    "shop_name": "Chipotle",
    "category": "food",
    "offer": "Buy one entrée, get one free",
    "conditions": ["limit 2 per customer", "extra cost for some items", "in-restaurant orders only", "until close"],
    "start_date": "2026-07-06",
    "end_date": "2026-07-06",
    "start_time": "15:00",
    "end_time": None,
    "source_url": URL,
    "verbatim_quote": "COME INTO CHIPOTLE ON JULY 6TH FROM 3PM TO CLOSE",
    "confidence": "high",
    "year_stated": False,
}


def record(deals, transcript=TRANSCRIPT):
    return {"type": "tool_use", "id": "toolu_1", "name": PHOTO_TOOL_NAME, "input": {"transcript": transcript, "deals": deals}}


def run(responses, photo_date=TODAY, today=TODAY, **kw):
    client = FakeClient(responses)
    resp = PhotoExtractor(client=client, model="test-model").extract(PNG, "image/png", photo_date, today=today, **kw)
    return resp, client.messages.calls


def test_poster_without_year_is_inferred_and_expired():
    resp, calls = run([msg([record([CHIPOTLE])], stop_reason="tool_use")])
    assert len(calls) == 1
    (deal,) = resp.deals
    assert deal.start_date == deal.end_date == date(2026, 7, 6)
    assert deal.start_time == time(15, 0) and deal.end_time is None
    assert "in-restaurant orders only" in deal.conditions
    assert deal.status == DealStatus.expired
    assert "year_inferred" in deal.flags
    assert deal.source_post_date == TODAY
    assert resp.provider == "user_photo" and resp.transcript == TRANSCRIPT
    assert resp.sources[0].url == URL


def test_upcoming_poster_is_live_and_starts_later():
    resp, _ = run([msg([record([CHIPOTLE])], stop_reason="tool_use")], photo_date=date(2026, 7, 1), today=date(2026, 7, 1))
    (deal,) = resp.deals
    assert deal.status == DealStatus.live
    assert "starts_later" in deal.flags and "year_inferred" in deal.flags


def test_stated_year_is_not_flagged():
    deal = {**CHIPOTLE, "year_stated": True, "start_date": "2026-11-01", "end_date": "2026-11-01"}
    resp, _ = run([msg([record([deal])], stop_reason="tool_use")])
    assert resp.deals[0].start_date == date(2026, 11, 1)
    assert "year_inferred" not in resp.deals[0].flags


def test_request_carries_image_and_context():
    _, calls = run([msg([record([])], stop_reason="tool_use")], shop="Chipotle Westwood")
    (content,) = [m["content"] for m in calls[0]["messages"]]
    assert content[0]["type"] == "image"
    assert content[0]["source"]["media_type"] == "image/png"
    assert URL in content[1]["text"] and "Chipotle Westwood" in content[1]["text"]
    assert calls[0]["tools"][0]["name"] == PHOTO_TOOL_NAME
    assert calls[0]["tool_choice"] == {"type": "auto"}


def test_quote_not_in_transcript_rejected():
    deal = {**CHIPOTLE, "verbatim_quote": "Free guac all week"}
    resp, _ = run([msg([record([deal])], stop_reason="tool_use")])
    assert resp.deals == []
    assert resp.rejected[0].reason == "quote_not_in_source"


def test_code_not_in_quote_removed():
    deal = {**CHIPOTLE, "code": "BOGO2026"}
    resp, _ = run([msg([record([deal])], stop_reason="tool_use")])
    assert resp.deals[0].code is None
    assert "code_not_in_quote" in resp.deals[0].flags


def test_unparseable_time_cleared():
    deal = {**CHIPOTLE, "start_time": "3ish"}
    resp, _ = run([msg([record([deal])], stop_reason="tool_use")])
    assert resp.deals[0].start_time is None
    assert any("start_time" in e for e in resp.search_errors)


def test_prose_answer_gets_one_nudge():
    resp, calls = run([msg([{"type": "text", "text": "This is a Chipotle BOGO."}]), msg([record([CHIPOTLE])], stop_reason="tool_use")])
    assert len(calls) == 2
    assert calls[1]["messages"][-1]["content"].startswith("Now call record_photo_deals")
    assert len(resp.deals) == 1


def test_no_tool_call_reports_error():
    resp, calls = run([msg([{"type": "text", "text": "no"}]), msg([{"type": "text", "text": "still no"}])])
    assert len(calls) == 2
    assert resp.deals == [] and "Claude never called record_photo_deals" in resp.search_errors


@pytest.mark.parametrize(
    "d, ref, expected",
    [
        (date(2026, 7, 6), date(2026, 10, 24), date(2026, 7, 6)),
        (date(2026, 1, 3), date(2026, 12, 20), date(2027, 1, 3)),
        (date(2026, 12, 30), date(2027, 1, 2), date(2026, 12, 30)),
        (date(2024, 2, 29), date(2028, 3, 10), date(2028, 2, 29)),
        (date(2024, 2, 29), date(2026, 3, 1), date(2024, 2, 29)),  # no leap year in reach: left as is
    ],
)
def test_resolve_missing_year(d, ref, expected):
    assert resolve_missing_year(d, ref) == expected


def test_date_range_across_new_year():
    deal = {**CHIPOTLE, "start_date": "2026-12-28", "end_date": "2026-01-03"}
    resp, _ = run([msg([record([deal])], stop_reason="tool_use")], photo_date=date(2026, 12, 20), today=date(2026, 12, 20))
    assert resp.deals[0].start_date == date(2026, 12, 28)
    assert resp.deals[0].end_date == date(2027, 1, 3)


def test_sniff_media_type():
    assert sniff_media_type(PNG) == "image/png"
    assert sniff_media_type(b"\xff\xd8\xff\xe0rest") == "image/jpeg"
    assert sniff_media_type(b"RIFF\x00\x00\x00\x00WEBPVP8 ") == "image/webp"
    assert sniff_media_type(b"GIF89a...") == "image/gif"
    assert sniff_media_type(b"%PDF-1.7") is None


class StubPhotoExtractor:
    def __init__(self):
        self.calls = []

    def extract(self, data, media_type, photo_date, shop=None, filename=None, today=None):
        self.calls.append(dict(data=data, media_type=media_type, photo_date=photo_date, shop=shop, filename=filename))
        resp, _ = run([msg([record([CHIPOTLE])], stop_reason="tool_use")])
        return resp


@pytest.fixture
def photo_client():
    stub = StubPhotoExtractor()
    app.dependency_overrides[get_photo_extractor] = lambda: stub
    yield TestClient(app), stub
    app.dependency_overrides.clear()


def test_photo_endpoint(photo_client):
    client, stub = photo_client
    r = client.post(
        "/extract/photo",
        files={"image": ("poster.png", PNG, "image/png")},
        data={"shop": "Chipotle Westwood", "photo_date": "2026-10-20"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["provider"] == "user_photo" and body["deals"][0]["start_time"] == "15:00:00"
    (call,) = stub.calls
    assert call["media_type"] == "image/png" and call["photo_date"] == date(2026, 10, 20)
    assert call["shop"] == "Chipotle Westwood" and call["filename"] == "poster.png"


def test_photo_endpoint_rejects_non_image(photo_client):
    client, stub = photo_client
    r = client.post("/extract/photo", files={"image": ("x.png", b"%PDF-1.7 not an image", "image/png")})
    assert r.status_code == 415 and stub.calls == []


def test_photo_endpoint_rejects_large_image(photo_client):
    client, stub = photo_client
    big = PNG + b"\x00" * (5 * 1024 * 1024)
    r = client.post("/extract/photo", files={"image": ("big.png", big, "image/png")})
    assert r.status_code == 413 and stub.calls == []


def test_photo_endpoint_requires_image(photo_client):
    client, _ = photo_client
    assert client.post("/extract/photo", data={"shop": "x"}).status_code == 422


def test_photo_endpoint_bad_timezone(photo_client):
    client, _ = photo_client
    r = client.post("/extract/photo", files={"image": ("p.png", PNG, "image/png")}, data={"timezone": "Mars/Base"})
    assert r.status_code == 422


def test_demo_page_served():
    r = TestClient(app).get("/demo")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/html")
    assert "/extract/photo" in r.text


def test_missing_anthropic_key_is_a_clear_500(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    app.dependency_overrides[get_photo_extractor] = lambda: PhotoExtractor()
    try:
        r = TestClient(app).post("/extract/photo", files={"image": ("p.png", PNG, "image/png")})
    finally:
        app.dependency_overrides.clear()
    assert r.status_code == 500 and "ANTHROPIC_API_KEY" in r.json()["detail"]
