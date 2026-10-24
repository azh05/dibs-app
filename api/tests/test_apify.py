import json
from datetime import date, datetime, timezone

import httpx
import pytest

from app.apify import (
    MemoryGate,
    ApifyAuthError,
    ApifyClient,
    ApifyError,
    ApifyTimeout,
    RunCounter,
    facebook_page,
    instagram_handle,
    parse_facebook,
    parse_instagram,
    parse_pages,
    parse_places,
    parse_tiktok,
    tiktok_handle,
)

SINCE = date(2026, 10, 10)


def client(handler, token="tok", gate=None):
    return ApifyClient(token=token, http=httpx.Client(transport=httpx.MockTransport(handler)), gate=gate or MemoryGate(16384), sleep=lambda s: None)


def test_run_sends_input_with_token_and_limits():
    seen = {}

    def handler(request):
        seen["url"] = request.url
        seen["auth"] = request.headers["authorization"]
        seen["body"] = json.loads(request.content)
        return httpx.Response(201, json=[{"url": "https://www.instagram.com/p/abc/", "caption": "hi"}])

    counter = RunCounter()
    errors = []
    posts = client(handler).instagram_posts(["milksha_ca"], SINCE, 6, errors, counter)
    assert seen["url"].path == "/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items"
    assert seen["url"].params["maxItems"] == "6" and seen["url"].params["timeout"] == "240"
    assert seen["url"].params["memory"] == "1024"
    assert seen["auth"] == "Bearer tok"
    assert seen["body"]["directUrls"] == ["https://www.instagram.com/milksha_ca/"]
    assert seen["body"]["onlyPostsNewerThan"] == "2026-10-10"
    assert counter.count == 1 and len(posts) == 1 and errors == []


def test_missing_token_raises_before_any_request():
    def handler(request):
        raise AssertionError("no request expected")

    with pytest.raises(ApifyAuthError):
        ApifyClient(token="", http=httpx.Client(transport=httpx.MockTransport(handler))).require_token()


@pytest.mark.parametrize(
    "status,body,error",
    [
        (401, {"error": {"type": "unauthorized"}}, ApifyAuthError),
        (408, {}, ApifyTimeout),
        (402, {"error": {"message": "Not enough usage credits"}}, ApifyError),
        (400, {"error": {"message": "Input is not valid"}}, ApifyError),
    ],
)
def test_http_errors(status, body, error):
    c = client(lambda r: httpx.Response(status, json=body))
    with pytest.raises(error) as exc:
        c.run("apify~instagram-scraper", {}, 1)
    if status in (402, 400):
        assert body["error"]["message"] in str(exc.value)


def test_network_timeout_is_apify_timeout():
    def handler(request):
        raise httpx.ReadTimeout("slow", request=request)

    with pytest.raises(ApifyTimeout):
        client(handler).run("x~y", {}, 1)


def test_non_list_body_is_error():
    with pytest.raises(ApifyError):
        client(lambda r: httpx.Response(201, json={"data": 1})).run("x~y", {}, 1)


def test_website_globs_cover_each_site():
    seen = {}

    def handler(request):
        seen["body"] = json.loads(request.content)
        return httpx.Response(201, json=[])

    client(handler).website_pages(["https://milksha.com/", "http://boba.example/home"], 4, [])
    body = seen["body"]
    assert body["maxCrawlPages"] == 8 and body["maxCrawlDepth"] == 1
    globs = [g["glob"] for g in body["includeUrlGlobs"]]
    assert "https://milksha.com/**deal**" in globs and "http://boba.example/**special**" in globs


# --- link parsing ----------------------------------------------------------------------

@pytest.mark.parametrize(
    "url,handle",
    [
        ("https://www.instagram.com/Milksha_CA/?hl=en", "milksha_ca"),
        ("instagram.com/milksha_ca", "milksha_ca"),
        ("https://www.instagram.com/p/C123/", None),
        ("https://www.instagram.com/reel/C123/", None),
        ("https://example.com/milksha", None),
    ],
)
def test_instagram_handle(url, handle):
    assert instagram_handle(url) == handle


def test_tiktok_handle():
    assert tiktok_handle("https://www.tiktok.com/@Milksha.CA?lang=en") == "milksha.ca"
    assert tiktok_handle("https://www.tiktok.com/discover/boba") is None


def test_facebook_page():
    assert facebook_page("https://m.facebook.com/MilkshaUSA/posts/123?ref=x") == "https://www.facebook.com/MilkshaUSA/"
    assert facebook_page("https://www.facebook.com/sharer/sharer.php?u=x") is None
    assert facebook_page("https://www.facebook.com/profile.php?id=42") == "https://www.facebook.com/profile.php?id=42"


# --- parsers ----------------------------------------------------------------------------

def test_parse_places_takes_first_social_link_and_skips_closed():
    rows = [
        {
            "title": "Milksha Westwood",
            "address": "1099 Westwood Blvd",
            "categoryName": "Bubble tea store",
            "url": "https://maps.google.com/?cid=1",
            "placeId": "p1",
            "website": "https://milksha.com/",
            "instagrams": ["https://www.instagram.com/p/xyz/", "https://www.instagram.com/milksha_ca/"],
            "tiktoks": ["https://www.tiktok.com/@milksha.ca"],
            "facebooks": ["https://www.facebook.com/MilkshaUSA"],
            "openingHours": [{"day": "Monday", "hours": "11 AM to 10 PM"}, {"day": "Tuesday"}, "junk"],
        },
        {"title": "Milksha Westwood", "placeId": "p1"},  # duplicate
        {"title": "Gone Cafe", "placeId": "p2", "permanentlyClosed": True},
        {"title": "Insta Only", "placeId": "p3", "website": "https://instagram.com/instaonly"},
        {"error": "not_found", "url": "x"},
    ]
    errors = []
    shops = parse_places(rows, errors)
    assert [s.name for s in shops] == ["Milksha Westwood", "Insta Only"]
    m = shops[0]
    assert (m.instagram, m.tiktok, m.facebook) == ("milksha_ca", "milksha.ca", "https://www.facebook.com/MilkshaUSA/")
    assert [(h.day, h.hours) for h in m.hours] == [("Monday", "11 AM to 10 PM")]
    assert shops[1].instagram == "instaonly" and shops[1].hours is None
    assert errors and "not_found" in errors[0]


def test_parse_instagram_adds_alt_text_and_mentions():
    rows = [
        {
            "url": "https://www.instagram.com/reel/abc/",
            "caption": "BOGO this week!",
            "alt": "Poster: 50% off second drink",
            "timestamp": "2026-10-20T18:00:00.000Z",
            "ownerUsername": "Milksha_CA",
            "mentions": ["@BobaFan", "boba.guide"],
            "coauthorProducers": [{"username": "westwoodeats"}],
        },
        {"error": "restricted_page", "errorDescription": "Private profile", "url": "https://www.instagram.com/x/"},
    ]
    errors = []
    [p] = parse_instagram(rows, errors)
    assert p.handle == "milksha_ca" and p.posted_at == datetime(2026, 10, 20, 18, tzinfo=timezone.utc)
    assert "[image text] Poster: 50% off second drink" in p.text
    assert p.mentions == ["bobafan", "boba.guide"] and p.coauthors == ["westwoodeats"]
    assert errors == ["instagram: https://www.instagram.com/x/: Private profile"]


def test_parse_tiktok():
    rows = [
        {
            "webVideoUrl": "https://www.tiktok.com/@milksha.ca/video/1",
            "text": "Free topping Friday",
            "createTimeISO": "2026-10-21T01:00:00.000Z",
            "authorMeta": {"name": "milksha.ca"},
            "mentions": ["@westwoodfoodie"],
        },
        {"text": "no url"},
    ]
    [p] = parse_tiktok(rows, [])
    assert p.platform == "tiktok" and p.handle == "milksha.ca" and p.mentions == ["westwoodfoodie"]


def test_parse_facebook_appends_ocr_but_not_generic_alt():
    rows = [
        {
            "url": "https://www.facebook.com/MilkshaUSA/posts/1",
            "text": "See you this weekend",
            "time": "2026-10-19T20:00:00.000Z",
            "pageName": "Milksha USA",
            "facebookUrl": "https://www.facebook.com/MilkshaUSA",
            "media": [{"ocrText": "BUY 1 GET 1 FREE Oct 24-26"}, {"ocrText": "May be an image of drink"}],
        }
    ]
    [p] = parse_facebook(rows, [])
    assert "[image text] BUY 1 GET 1 FREE Oct 24-26" in p.text and "May be" not in p.text
    assert p.input_url == "https://www.facebook.com/MilkshaUSA"


def test_parse_pages_skips_empty():
    rows = [{"url": "https://milksha.com/", "text": "Happy hour 3-5pm", "metadata": {"title": "Milksha"}}, {"url": "https://milksha.com/x", "text": " "}]
    [p] = parse_pages(rows, [])
    assert p.title == "Milksha"


MEMORY_FULL = {"error": {"type": "actor-memory-limit-exceeded", "message": "By launching this job you will exceed the memory limit of 16384MB for all your Actor runs and builds"}}


def test_memory_limit_402_waits_and_retries():
    calls = []

    def handler(request):
        calls.append(1)
        return httpx.Response(402, json=MEMORY_FULL) if len(calls) < 3 else httpx.Response(201, json=[])

    assert client(handler).run("apify~website-content-crawler", {}, 1) == []
    assert len(calls) == 3


def test_memory_limit_gives_up_after_retries():
    with pytest.raises(ApifyError, match="memory limit"):
        client(lambda r: httpx.Response(402, json=MEMORY_FULL)).run("x~y", {}, 1)


def test_out_of_credits_402_is_not_retried():
    calls = []

    def handler(request):
        calls.append(1)
        return httpx.Response(402, json={"error": {"message": "Not enough usage credits"}})

    with pytest.raises(ApifyError):
        client(handler).run("x~y", {}, 1)
    assert len(calls) == 1


def test_memory_gate_blocks_until_room():
    import threading

    gate = MemoryGate(4096)
    gate.acquire(4096)
    got = threading.Event()
    t = threading.Thread(target=lambda: (gate.acquire(2048), got.set()))
    t.start()
    assert not got.wait(0.1)  # full: the second run waits
    gate.release(4096)
    assert got.wait(1)
    t.join()
    assert gate.used_mb == 2048


def test_run_that_timed_out_is_a_timeout_not_retried_as_error():
    body = {"error": {"type": "run-failed", "message": "Actor run did not succeed (run ID: x, status: TIMED-OUT)."}}
    with pytest.raises(ApifyTimeout):
        client(lambda r: httpx.Response(400, json=body)).run("apify~website-content-crawler", {}, 1)
