"""Bright Data client tests against httpx.MockTransport. No network, no sleeping."""
import json
from datetime import date
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest

from app.brightdata import (
    IG_POSTS_DATASET,
    BrightDataAuthError,
    BrightDataClient,
    BrightDataError,
    BrightDataTimeout,
    RequestCounter,
)

SINCE = date(2026, 9, 23)
MILKSHA = "https://www.instagram.com/milksha_ca/"
ORGANIC = {
    "general": {"query": "westwood boba deal"},
    "organic": [
        {"rank": 1, "title": "Milksha (@milksha_ca)", "link": "https://www.instagram.com/p/abc/", "description": "BOGO all week"},
        {"global_rank": 2, "title": "Westwood deals", "link": "https://example.com/deals"},
        {"title": "no link, skipped"},
    ],
}


class FakeClock:
    def __init__(self):
        self.now = 0.0

    def sleep(self, s):
        self.now += s

    def __call__(self):
        return self.now


def client(handler, zone="serp_api1", **kw):
    clock = FakeClock()
    bd = BrightDataClient(
        api_key="test-key", zone=zone, http=httpx.Client(transport=httpx.MockTransport(handler)),
        sleep=clock.sleep, clock=clock, **kw,
    )
    return bd, clock


def google_url(request):
    return parse_qs(urlsplit(json.loads(request.content)["url"]).query)


# --- SERP -----------------------------------------------------------------------


def test_serp_parses_organic():
    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(200, json=ORGANIC)

    bd, _ = client(handler)
    counter = RequestCounter()
    results = bd.serp_search("westwood boba deal", counter=counter)
    assert [(r.rank, r.link) for r in results] == [(1, "https://www.instagram.com/p/abc/"), (2, "https://example.com/deals")]
    assert results[1].description == ""
    req = seen[0]
    assert req.url == "https://api.brightdata.com/request"
    assert req.headers["authorization"] == "Bearer test-key"
    body = json.loads(req.content)
    assert body["zone"] == "serp_api1" and body["format"] == "raw" and body["country"] == "us"
    q = google_url(req)
    assert q["q"] == ["westwood boba deal"] and q["brd_json"] == ["1"] and q["tbs"] == ["qdr:m"]
    assert counter.count == 1


def test_serp_past_month_flag_off():
    seen = []
    bd, _ = client(lambda r: seen.append(r) or httpx.Response(200, json=ORGANIC))
    bd.serp_search("q", past_month=False)
    assert "tbs" not in google_url(seen[0])


def test_serp_handles_json_string_body():
    bd, _ = client(lambda r: httpx.Response(200, text=json.dumps(json.dumps(ORGANIC))))
    assert len(bd.serp_search("q")) == 2


def test_serp_handles_body_wrapper():
    bd, _ = client(lambda r: httpx.Response(200, json={"status_code": 200, "body": json.dumps(ORGANIC)}))
    assert len(bd.serp_search("q")) == 2


def test_serp_empty_organic():
    bd, _ = client(lambda r: httpx.Response(200, json={"general": {}, "organic": []}))
    assert bd.serp_search("q") == []


def test_serp_retries_empty_captcha_body():
    replies = [
        httpx.Response(200, text="", headers={"x-brd-error-code": "captcha"}),
        httpx.Response(200, text="Please try again"),
        httpx.Response(200, json=ORGANIC),
    ]
    bd, clock = client(lambda r: replies.pop(0))
    counter = RequestCounter()
    assert len(bd.serp_search("q", counter=counter)) == 2
    assert counter.count == 3 and clock.now > 0


def test_serp_gives_up_after_three_bad_bodies():
    bd, _ = client(lambda r: httpx.Response(200, text="", headers={"x-brd-error-code": "captcha"}))
    with pytest.raises(BrightDataError, match="captcha"):
        bd.serp_search("q")


def test_serp_timeouts_raise_timeout():
    def handler(request):
        raise httpx.ReadTimeout("slow", request=request)

    bd, _ = client(handler)
    with pytest.raises(BrightDataTimeout):
        bd.serp_search("q")


def test_serp_401_is_auth_error():
    bd, _ = client(lambda r: httpx.Response(401, text="bad key"))
    with pytest.raises(BrightDataAuthError):
        bd.serp_search("q")


def test_missing_key_is_auth_error(monkeypatch):
    monkeypatch.delenv("BRIGHTDATA_API_KEY", raising=False)
    monkeypatch.delenv("BRIGHTDATA_API_TOKEN", raising=False)
    bd = BrightDataClient(zone="z", http=httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(500))))
    with pytest.raises(BrightDataAuthError):
        bd.serp_search("q")


def test_zone_auto_detected(monkeypatch):
    monkeypatch.delenv("BRIGHTDATA_SERP_ZONE", raising=False)
    monkeypatch.delenv("BRIGHTDATA_ZONE", raising=False)
    seen = []

    def handler(request):
        seen.append(request)
        if request.url.path == "/zone/get_active_zones":
            return httpx.Response(200, json=[{"name": "web_unlocker1", "type": "unblocker"}, {"name": "serp_api1", "type": "serp"}])
        return httpx.Response(200, json=ORGANIC)

    bd, _ = client(handler, zone=None)
    bd.serp_search("q")
    bd.serp_search("q")
    assert json.loads(seen[-1].content)["zone"] == "serp_api1"
    assert sum(r.url.path == "/zone/get_active_zones" for r in seen) == 1


def test_no_zone_on_account(monkeypatch):
    monkeypatch.delenv("BRIGHTDATA_SERP_ZONE", raising=False)
    monkeypatch.delenv("BRIGHTDATA_ZONE", raising=False)
    bd, _ = client(lambda r: httpx.Response(200, json=[{"name": "dc1", "type": "dc"}]), zone=None)
    with pytest.raises(BrightDataError, match="BRIGHTDATA_SERP_ZONE"):
        bd.serp_search("q")


# --- Instagram ------------------------------------------------------------------


def post(shortcode, when="2026-10-19T16:03:20.000Z", user="milksha_ca", profile=MILKSHA, caption="BOGO50 all week"):
    return {
        "url": f"https://www.instagram.com/p/{shortcode}/",
        "user_posted": user,
        "description": caption,
        "date_posted": when,
        "content_type": "Image",
        "shortcode": shortcode,
        "discovery_input": {"url": profile, "num_of_posts": 6},
    }


class IgServer:
    """Scripted Bright Data dataset API: one script entry per trigger."""

    def __init__(self, *jobs):
        self.jobs = list(jobs)  # each: (progress statuses, snapshot replies)
        self.requests = []
        self.active = {}

    def __call__(self, request):
        self.requests.append(request)
        path = request.url.path
        if path == "/datasets/v3/trigger":
            sid = f"s_{len(self.active) + 1}"
            statuses, snaps = self.jobs.pop(0)
            self.active[sid] = (list(statuses), list(snaps))
            return httpx.Response(200, json={"snapshot_id": sid})
        sid = path.rsplit("/", 1)[-1]
        statuses, snaps = self.active[sid]
        if path.startswith("/datasets/v3/progress/"):
            status = statuses.pop(0) if len(statuses) > 1 else statuses[0]
            return httpx.Response(200, json=status if isinstance(status, dict) else {"status": status})
        if path.startswith("/datasets/v3/snapshot/"):
            return snaps.pop(0) if len(snaps) > 1 else snaps[0]
        return httpx.Response(404)

    def triggers(self):
        return [r for r in self.requests if r.url.path == "/datasets/v3/trigger"]


def test_ig_trigger_poll_download():
    server = IgServer((["running", "running", "ready"], [httpx.Response(200, json=[post("a"), post("b")])]))
    bd, clock = client(server)
    progress = []
    counter = RequestCounter()
    out = bd.instagram_recent_posts([MILKSHA], 6, SINCE, on_progress=progress.append, counter=counter)
    assert [p.shortcode for p in out.posts] == ["a", "b"]
    assert out.posts[0].handle == "milksha_ca" and out.posts[0].caption == "BOGO50 all week"
    assert out.posts[0].posted_at.isoformat() == "2026-10-19T16:03:20+00:00"
    assert out.errors == []
    trigger = server.triggers()[0]
    assert parse_qs(trigger.url.query.decode()) == {
        "dataset_id": [IG_POSTS_DATASET], "type": ["discover_new"], "discover_by": ["url"], "include_errors": ["true"],
    }
    assert json.loads(trigger.content)["input"] == [
        {"url": MILKSHA, "num_of_posts": 6, "start_date": "09-23-2026", "post_type": "Post"}
    ]
    assert server.requests[-1].url.params["format"] == "json"
    assert counter.count == 1  # only the trigger is billable
    assert clock.now == 10  # two 5 s polls
    assert any("running" in m for m in progress) and any("downloaded 2" in m for m in progress)


def test_ig_snapshot_202_then_200():
    server = IgServer((["ready"], [httpx.Response(202, json={"status": "building"}), httpx.Response(200, json=[post("a")])]))
    bd, _ = client(server)
    assert len(bd.instagram_recent_posts([MILKSHA], 6, SINCE).posts) == 1


def test_ig_failed_status():
    server = IgServer(([{"status": "failed", "error_message": "dataset unavailable"}], []))
    bd, _ = client(server)
    with pytest.raises(BrightDataError, match="dataset unavailable"):
        bd.instagram_recent_posts([MILKSHA], 6, SINCE)


def test_ig_error_rows_skipped_and_not_retried():
    bad = {"error": "Page not found", "error_code": "dead_page", "input": {"url": "https://www.instagram.com/nope_shop/"}}
    server = IgServer((["ready"], [httpx.Response(200, json=[post("a"), bad])]))
    bd, _ = client(server)
    out = bd.instagram_recent_posts([MILKSHA, "https://www.instagram.com/nope_shop/"], 6, SINCE)
    assert [p.shortcode for p in out.posts] == ["a"]
    assert out.errors == ["@nope_shop: dead_page: Page not found"]
    assert len(server.triggers()) == 1


def test_ig_zero_row_profile_retried_once():
    other = "https://www.instagram.com/boba_guys/"
    server = IgServer(
        (["ready"], [httpx.Response(200, json=[post("a")])]),
        (["ready"], [httpx.Response(200, json=[post("z", user="boba_guys", profile=other)])]),
    )
    bd, _ = client(server)
    counter = RequestCounter()
    out = bd.instagram_recent_posts([MILKSHA, other], 6, SINCE, counter=counter)
    assert sorted(p.shortcode for p in out.posts) == ["a", "z"]
    assert json.loads(server.triggers()[1].content)["input"][0]["url"] == other
    assert counter.count == 2 and out.errors == []


def test_ig_still_empty_after_retry_is_reported():
    server = IgServer((["ready"], [httpx.Response(200, json=[])]), (["ready"], [httpx.Response(200, json=[])]))
    bd, _ = client(server)
    out = bd.instagram_recent_posts([MILKSHA], 6, SINCE)
    assert out.posts == []
    assert out.errors == ["@milksha_ca: no public posts returned since 2026-09-23"]


def test_ig_drops_pinned_posts_older_than_since():
    server = IgServer((["ready"], [httpx.Response(200, json=[post("old", when="2024-11-28T10:00:00.000Z"), post("new")])]))
    bd, _ = client(server)
    out = bd.instagram_recent_posts([MILKSHA], 6, SINCE)
    assert [p.shortcode for p in out.posts] == ["new"]


def test_ig_timeout():
    server = IgServer((["running"], []))
    bd, clock = client(server)
    with pytest.raises(BrightDataTimeout, match="not ready"):
        bd.instagram_recent_posts([MILKSHA], 6, SINCE, max_wait_s=60)
    assert clock.now <= 60


def test_ig_survives_flaky_progress_poll():
    replies = iter([httpx.Response(503), httpx.Response(200, json={"status": "ready"})])
    server = IgServer((["ready"], [httpx.Response(200, json=[post("a")])]))

    def handler(request):
        if request.url.path.startswith("/datasets/v3/progress/"):
            server.requests.append(request)
            return next(replies)
        return server(request)

    bd, _ = client(handler)
    assert len(bd.instagram_recent_posts([MILKSHA], 6, SINCE).posts) == 1
