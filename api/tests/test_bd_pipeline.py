"""Bright Data pipeline tests: fake Bright Data client + the FakeClient pattern from test_extractor."""
from datetime import date, datetime, timezone

import pytest

from app.bd_pipeline import BrightDataPipeline, build_serp_queries
from app.brightdata import BrightDataAuthError, BrightDataError, BrightDataTimeout, IgPost, InstagramResult, SerpResult
from app.schemas import Category, DealStatus, InstagramRequest, Location, SerpSearchRequest
from tests.test_extractor import FakeClient, msg, record_block

TODAY = date(2026, 10, 23)
POST_URL = "https://www.instagram.com/p/milksha123/"
CAPTION = "Grand opening week! Buy 1 drink and get the second 50% off with code BOGO50. Ends Oct 31."
SERP_LINK = "https://www.instagram.com/p/serp1/"
SNIPPET = "Milksha Westwood: Buy one get one free on all milk teas this Friday only."


class FakeBD:
    def __init__(self, serp=None, ig=None, posts_by_url=None):
        self.serp = serp or {}
        self.ig = ig  # discovery result (or exception)
        self.posts_by_url = posts_by_url or {}  # shortcode -> IgPost, or an exception for every call
        self.serp_calls = []
        self.ig_calls = []
        self.post_calls = []

    def zone(self):
        return "serp_api1"

    def require_key(self):
        pass

    def serp_search(self, query, past_month=True, counter=None):
        self.serp_calls.append((query, past_month))
        if counter:
            counter.add()
        out = self.serp.get(query, [])
        if isinstance(out, Exception):
            raise out
        return out

    def instagram_recent_posts(self, urls, num, since, max_wait_s, on_progress, counter):
        self.ig_calls.append((urls, num, since))
        if counter:
            counter.add()
        if isinstance(self.ig, Exception):
            raise self.ig
        return self.ig or InstagramResult(posts=[])

    def instagram_posts(self, urls, max_wait_s=60, on_progress=None, counter=None):
        self.post_calls.append(urls)
        if counter:
            counter.add()
        if isinstance(self.posts_by_url, Exception):
            raise self.posts_by_url
        posts = [self.posts_by_url[c] for c in (u.rstrip("/").rsplit("/", 1)[-1] for u in urls) if c in self.posts_by_url]
        return InstagramResult(posts=posts)


def deal(**kw):
    base = {
        "shop_name": "Milksha Westwood",
        "offer": "Buy 1 drink, get the 2nd 50% off",
        "code": "BOGO50",
        "end_date": "2026-10-31",
        "source_url": POST_URL,
        "source_post_date": "2026-10-01",
        "verbatim_quote": "buy 1 drink and get the second 50% off with code BOGO50",
        "confidence": "high",
    }
    base.update(kw)
    return base


MILKSHA_POST = IgPost(url=POST_URL, handle="milksha_ca", caption=CAPTION, posted_at=datetime(2026, 10, 20, 18, tzinfo=timezone.utc))
IG_QUERY = 'site:instagram.com "milksha_ca"'


def ig_pipeline(deals, serp=None, posts_by_url=None, ig=None):
    serp = {IG_QUERY: [SerpResult(1, "milksha_ca on October 20, 2026", POST_URL, "Grand opening week!")]} if serp is None else serp
    posts_by_url = {"milksha123": MILKSHA_POST} if posts_by_url is None else posts_by_url
    bd = FakeBD(serp=serp, posts_by_url=posts_by_url, ig=ig)
    claude = FakeClient([msg([record_block(deals)], stop_reason="tool_use")])
    return BrightDataPipeline(bd=bd, anthropic_client=claude, model="test-model"), bd, claude


def run_ig(deals, **kw):
    pipeline, bd, claude = ig_pipeline(deals, **kw)
    progress = []
    out = pipeline.run_instagram(InstagramRequest(handles=["milksha_ca"]), on_progress=progress.append, today=TODAY)
    return out, bd, claude.messages.calls, progress


def test_instagram_google_then_fetch_by_url():
    out, bd, calls, progress = run_ig([deal()])
    assert bd.serp_calls == [(IG_QUERY, True)]
    assert bd.post_calls == [[POST_URL]]
    assert bd.ig_calls == []  # no slow profile discovery needed
    call = calls[0]
    assert call["tool_choice"] == {"type": "auto"}  # forced tool_choice is a 400 on claude-opus-5-5
    assert "Call the record_deals tool exactly once" in call["system"]
    assert [t["name"] for t in call["tools"]] == ["record_deals"]
    assert "web_search" not in str(call["tools"])
    prompt = call["messages"][0]["content"]
    assert f"[S1] {POST_URL} | instagram | @milksha_ca | posted: 2026-10-20" in prompt
    assert CAPTION in prompt and "Today is 2026-10-23" in prompt
    assert "ONLY the numbered sources" in call["system"]
    assert out.provider == "brightdata_instagram" and out.queries == ["@milksha_ca"] and out.brightdata_requests == 2
    assert any("fetching 1 post(s)" in m for m in progress)


def test_instagram_post_date_overrides_claude():
    out, _, _, _ = run_ig([deal()])
    d = out.deals[0]
    assert d.source_post_date == date(2026, 10, 20)
    assert "post_date_from_source" in d.flags
    assert d.status == DealStatus.live and d.code == "BOGO50"


def test_quote_not_in_source_rejected():
    out, _, _, _ = run_ig([deal(verbatim_quote="Buy 1 get 1 FREE with code BOGO50")])
    assert not out.deals and out.rejected[0].reason == "quote_not_in_source"


def test_invented_url_rejected():
    out, _, _, _ = run_ig([deal(source_url="https://www.instagram.com/p/made-up/")])
    assert out.rejected[0].reason == "source_not_in_search_results"


def test_instagram_uses_tagged_posts_when_shop_has_none_of_its_own():
    tagged = IgPost(url=POST_URL, handle="aframe24", caption="@milksha_ca is having BOGO50 all week!", posted_at=MILKSHA_POST.posted_at)
    out, bd, calls, progress = run_ig([], posts_by_url={"milksha123": tagged})
    assert any("1 post(s) by other accounts that tag the shop" in m for m in progress)
    assert bd.ig_calls == []  # covered by the tagged post, so no slow discovery
    assert "| @aframe24 |" in calls[0]["messages"][0]["content"]  # Claude sees who posted it


def test_instagram_prefers_shop_posts_and_ignores_untagged_ones():
    tagged = IgPost(url="https://www.instagram.com/p/tag1/", handle="aframe24", caption="@milksha_ca BOGO!", posted_at=MILKSHA_POST.posted_at)
    unrelated = IgPost(url="https://www.instagram.com/p/x1/", handle="someone", caption="nice view", posted_at=MILKSHA_POST.posted_at)
    serp = {IG_QUERY: [SerpResult(i, "t", f"https://www.instagram.com/p/{c}/", "d") for i, c in enumerate(["milksha123", "tag1", "x1"])]}
    out, _, calls, _ = run_ig([deal()], serp=serp, posts_by_url={"milksha123": MILKSHA_POST, "tag1": tagged, "x1": unrelated})
    prompt = calls[0]["messages"][0]["content"]
    assert "@milksha_ca | posted" in prompt and "aframe24" not in prompt and "someone" not in prompt


def test_instagram_unrelated_posts_fall_back_to_discovery():
    other = IgPost(url=POST_URL, handle="some_food_blogger", caption="great pho", posted_at=MILKSHA_POST.posted_at)
    out, bd, calls, _ = run_ig([], posts_by_url={"milksha123": other})
    assert bd.ig_calls and calls == []


def test_instagram_falls_back_to_discovery_when_google_finds_nothing():
    out, bd, calls, progress = run_ig([deal()], serp={}, ig=InstagramResult(posts=[MILKSHA_POST]))
    assert bd.post_calls == []
    assert bd.ig_calls == [(["https://www.instagram.com/milksha_ca/"], 6, date(2026, 9, 23))]
    assert any("trying Bright Data profile discovery" in m for m in progress)
    assert len(out.deals) == 1


def test_instagram_discovery_timeout_is_noted_not_raised():
    out, _, calls, _ = run_ig([], serp={}, ig=BrightDataTimeout("Instagram job s_1 was not ready after 290s"))
    assert calls == [] and out.deals == []
    assert any("profile discovery ran out of time" in e for e in out.search_errors)
    assert "nothing to extract" in out.search_errors[-1]


def test_instagram_fetch_error_is_noted_then_discovery_tried():
    out, bd, _, _ = run_ig([], posts_by_url=BrightDataError("Instagram post fetch failed: HTTP 500"))
    assert any("could not fetch posts found on Google" in e for e in out.search_errors)
    assert bd.ig_calls


def test_instagram_auth_error_raises():
    pipeline, _, _ = ig_pipeline([], posts_by_url=BrightDataAuthError("bad key"))
    with pytest.raises(BrightDataAuthError):
        pipeline.run_instagram(InstagramRequest(handles=["milksha_ca"]), today=TODAY)


def test_instagram_drops_old_posts():
    old = IgPost(url=POST_URL, handle="milksha_ca", caption=CAPTION, posted_at=datetime(2026, 6, 1, tzinfo=timezone.utc))
    out, _, calls, progress = run_ig([], posts_by_url={"milksha123": old})
    assert calls == [] and any("older than 2026-09-23" in m for m in progress)


# --- SERP -----------------------------------------------------------------------


def serp_pipeline(serp, deals):
    bd = FakeBD(serp=serp)
    claude = FakeClient([msg([record_block(deals)], stop_reason="tool_use")])
    return BrightDataPipeline(bd=bd, anthropic_client=claude, model="test-model"), bd, claude


def test_auto_queries():
    req = SerpSearchRequest(location=Location(neighborhood="Westwood"), categories=[Category.drink, Category.food], shop="Milksha", max_queries=8)
    assert build_serp_queries(req) == [
        "Milksha promo code",
        "site:instagram.com Westwood Los Angeles deal",
        "Westwood Los Angeles grand opening special",
        "Westwood Los Angeles drink BOGO",
        "Westwood Los Angeles food BOGO",
    ]
    assert build_serp_queries(SerpSearchRequest(max_queries=2)) == ["site:instagram.com Los Angeles deal", "Los Angeles grand opening special"]
    assert build_serp_queries(SerpSearchRequest(queries=[" a ", "", "b"])) == ["a", "b"]


def test_serp_one_failed_query_does_not_fail_batch():
    serp = {
        "a": [SerpResult(1, "Milksha", SERP_LINK, SNIPPET)],
        "b": BrightDataError("Google search for 'b' failed after 3 attempts: captcha"),
        "c": [],
    }
    snippet_deal = deal(source_url=SERP_LINK, verbatim_quote="Buy one get one free on all milk teas this Friday only", code=None, end_date=None, source_post_date=None)
    pipeline, bd, claude = serp_pipeline(serp, [snippet_deal])
    out = pipeline.run_serp(SerpSearchRequest(queries=["a", "b", "c"], past_month=False, enrich_instagram=False), today=TODAY)
    assert out.provider == "brightdata_serp" and out.queries == ["a", "b", "c"] and out.brightdata_requests == 3
    assert all(pm is False for _, pm in bd.serp_calls)
    assert any("captcha" in e for e in out.search_errors) and "no Google results for 'c'" in out.search_errors
    assert len(out.deals) == 1 and out.deals[0].status == DealStatus.needs_check  # snippets carry no dates
    assert f"[S1] {SERP_LINK} | serp | posted: unknown" in claude.messages.calls[0]["messages"][0]["content"]


def test_serp_all_failed_raises():
    pipeline, _, claude = serp_pipeline({"a": BrightDataTimeout("t1"), "b": BrightDataTimeout("t2")}, [])
    with pytest.raises(BrightDataTimeout):
        pipeline.run_serp(SerpSearchRequest(queries=["a", "b"]), today=TODAY)
    assert claude.messages.calls == []


def test_serp_auth_error_raises():
    pipeline, _, _ = serp_pipeline({"a": BrightDataAuthError("bad key"), "b": []}, [])
    with pytest.raises(BrightDataAuthError):
        pipeline.run_serp(SerpSearchRequest(queries=["a", "b"]), today=TODAY)


def test_serp_empty_results_return_clean_response():
    pipeline, _, claude = serp_pipeline({}, [])
    out = pipeline.run_serp(SerpSearchRequest(queries=["nothing here"]), today=TODAY)
    assert out.deals == [] and claude.messages.calls == []
    assert "no Google results for 'nothing here'" in out.search_errors


def test_prose_answer_gets_one_nudge():
    pipeline, _, claude = ig_pipeline([])
    claude.messages.responses = [
        msg([{"type": "text", "text": "I see a BOGO50 deal at Milksha."}]),
        msg([record_block([deal()])], stop_reason="tool_use"),
    ]
    out = pipeline.run_instagram(InstagramRequest(handles=["milksha_ca"]), today=TODAY)
    calls = claude.messages.calls
    assert len(calls) == 2 and len(out.deals) == 1
    assert calls[1]["messages"][1]["role"] == "assistant"
    assert "record_deals" in calls[1]["messages"][2]["content"]


def test_gives_up_after_nudge():
    pipeline, _, claude = ig_pipeline([])
    claude.messages.responses = [msg([{"type": "text", "text": "no"}]), msg([{"type": "text", "text": "still no"}])]
    out = pipeline.run_instagram(InstagramRequest(handles=["milksha_ca"]), today=TODAY)
    assert len(claude.messages.calls) == 2 and out.deals == []
    assert "Claude never called record_deals" in out.search_errors


def test_usable_results_drop_redirects_and_off_site_links():
    from app.bd_pipeline import usable_results

    found = [
        SerpResult(1, "redirect", "/goto?url=CAESYwHrOzAV", "x"),
        SerpResult(2, "ig", "https://www.instagram.com/p/a/", "x"),
        SerpResult(3, "off-site", "https://www.facebook.com/p/b", "x"),
        SerpResult(4, "subdomain", "https://about.instagram.com/x", "x"),
    ]
    assert [r.title for r in usable_results("site:instagram.com Westwood deal", found)] == ["ig", "subdomain"]
    assert [r.title for r in usable_results("Westwood deal", found)] == ["ig", "off-site", "subdomain"]


def test_serp_reports_dropped_results():
    serp = {"site:instagram.com x": [SerpResult(1, "r", "/goto?url=abc", "x"), SerpResult(2, "ig", SERP_LINK, SNIPPET)]}
    pipeline, _, claude = serp_pipeline(serp, [])
    out = pipeline.run_serp(SerpSearchRequest(queries=["site:instagram.com x"]), today=TODAY)
    assert "dropped 1 of 2 Google results for 'site:instagram.com x' (redirect links or off-site)" in out.search_errors
    assert [s.url for s in out.sources] == [SERP_LINK]


# --- enrich: fetch the full Instagram post behind a Google snippet -----------------

CAFE_LINK = "https://www.instagram.com/reel/DeFYcA0gU6G/"
CAFE_SNIPPET = "Westwood, We are Open! Meet your new favourite drink! Celebrate our soft opening with BUY 1, GET 1 FREE on all drinks: October 17–18 & October 24–25 ..."
CAFE_CAPTION = (
    "Westwood, We are Open! Meet your new favourite drink!\nCelebrate our soft opening with BUY 1, GET 1 FREE on all drinks:\n"
    "📅 October 17–18 & October 24–25\n📍 1067 Glendon Ave, Los Angeles"
)
CAFE_POST = IgPost(
    url="https://www.instagram.com/p/DeFYcA0gU6G/", handle="26vietcafe.usa", caption=CAFE_CAPTION,
    posted_at=datetime(2026, 10, 4, 19, 26, tzinfo=timezone.utc),
)


def cafe_deal(**kw):
    base = {
        "shop_name": "Westwood cafe", "offer": "Buy 1 get 1 free on all drinks", "code": None, "end_date": None,
        "source_url": CAFE_LINK, "verbatim_quote": "BUY 1, GET 1 FREE on all drinks", "confidence": "low",
    }
    base.update(kw)
    return base


def enrich_pipeline(first, second=None, posts_by_url=None):
    serp = {"q": [SerpResult(1, "26vietcafe.usa", CAFE_LINK, CAFE_SNIPPET), SerpResult(2, "Other", "https://example.com/a", "Free cookie Friday")]}
    bd = FakeBD(serp=serp, posts_by_url={"DeFYcA0gU6G": CAFE_POST} if posts_by_url is None else posts_by_url)
    replies = [msg([record_block(first)], stop_reason="tool_use")]
    if second is not None:
        replies.append(msg([record_block(second)], stop_reason="tool_use"))
    claude = FakeClient(replies)
    return BrightDataPipeline(bd=bd, anthropic_client=claude, model="test-model"), bd, claude


def test_enrich_replaces_snippet_with_full_post():
    full = cafe_deal(
        shop_name="26 Viet Cafe", shop_handle="26vietcafe.usa", end_date="2026-10-25", confidence="high",
        source_url="https://www.instagram.com/p/DeFYcA0gU6G/",
        verbatim_quote="Celebrate our soft opening with BUY 1, GET 1 FREE on all drinks: 📅 October 17–18 & October 24–25",
    )
    cookie = cafe_deal(shop_name="Other", offer="Free cookie", source_url="https://example.com/a", verbatim_quote="Free cookie Friday")
    pipeline, bd, claude = enrich_pipeline([cafe_deal(), cookie], [full])
    out = pipeline.run_serp(SerpSearchRequest(queries=["q"]), today=TODAY)

    assert bd.post_calls == [["https://www.instagram.com/p/DeFYcA0gU6G/"]]  # only the post that produced a deal
    second_prompt = claude.messages.calls[1]["messages"][0]["content"]
    assert "1067 Glendon Ave" in second_prompt and "posted: 2026-10-04" in second_prompt
    assert "Free cookie" not in second_prompt
    cafe = next(d for d in out.deals if d.shop_handle == "26vietcafe.usa")
    assert cafe.status == DealStatus.live and cafe.end_date == date(2026, 10, 25)
    assert cafe.source_post_date == date(2026, 10, 4)
    assert "full_post_fetched" in cafe.flags
    assert [d.shop_name for d in out.deals].count("Westwood cafe") == 0  # the snippet version is gone
    assert any(d.shop_name == "Other" for d in out.deals)
    assert out.brightdata_requests == 2


def test_enrich_off_makes_no_post_fetch():
    pipeline, bd, claude = enrich_pipeline([cafe_deal()])
    out = pipeline.run_serp(SerpSearchRequest(queries=["q"], enrich_instagram=False), today=TODAY)
    assert bd.post_calls == [] and len(claude.messages.calls) == 1
    assert out.deals[0].status == DealStatus.needs_check


def test_enrich_failure_keeps_snippet_deals():
    pipeline, _, claude = enrich_pipeline([cafe_deal()], posts_by_url=BrightDataTimeout("Instagram post fetch timed out after 60s"))
    out = pipeline.run_serp(SerpSearchRequest(queries=["q"]), today=TODAY)
    assert len(claude.messages.calls) == 1
    assert out.deals[0].shop_name == "Westwood cafe" and "full_post_fetched" not in out.deals[0].flags
    assert any("kept Google snippets" in e for e in out.search_errors)


def test_enrich_skips_deals_without_instagram_posts():
    cookie = cafe_deal(shop_name="Other", source_url="https://example.com/a", verbatim_quote="Free cookie Friday")
    pipeline, bd, _ = enrich_pipeline([cookie])
    pipeline.run_serp(SerpSearchRequest(queries=["q"]), today=TODAY)
    assert bd.post_calls == []


def test_instagram_collab_post_counts_as_shop_own():
    collab = IgPost(
        url=POST_URL, handle="_losangelily", caption="The famous @milksha_ca has BOGO50 all week!",
        posted_at=MILKSHA_POST.posted_at, coauthors=["westwoodvillage", "milksha_ca"],
    )
    out, bd, calls, progress = run_ig([], posts_by_url={"milksha123": collab})
    assert not any("second-hand" in m for m in progress) and bd.ig_calls == []
    prompt = calls[0]["messages"][0]["content"]
    assert "| @_losangelily | co-posted with @westwoodvillage, @milksha_ca |" in prompt
    assert "co-posted" in calls[0]["system"] and "second-hand" in calls[0]["system"]


def test_instagram_deals_are_linked():
    pipeline, _, claude = ig_pipeline([])
    claude.messages.responses = [msg([record_block([deal()])], stop_reason="tool_use")]
    out = pipeline.run_instagram(InstagramRequest(handles=["milksha_ca"]), today=TODAY)
    (d,) = out.deals
    assert d.id.startswith("deal:") and d.shop_id in {s.id for s in out.shops}


def test_sources_carry_full_text():
    pipeline, _, claude = ig_pipeline([])
    claude.messages.responses = [msg([record_block([deal()])], stop_reason="tool_use")]
    out = pipeline.run_instagram(InstagramRequest(handles=["milksha_ca"]), today=TODAY)
    src = out.sources[0]
    assert src.origin == "instagram" and src.text and src.handle
