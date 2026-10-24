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
    def __init__(self, serp=None, ig=None):
        self.serp = serp or {}
        self.ig = ig
        self.serp_calls = []
        self.ig_calls = []

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
        return self.ig


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


def ig_pipeline(deals, posts=None, errors=None):
    posts = posts if posts is not None else [
        IgPost(url=POST_URL, handle="milksha_ca", caption=CAPTION, posted_at=datetime(2026, 10, 20, 18, tzinfo=timezone.utc))
    ]
    bd = FakeBD(ig=InstagramResult(posts=posts, errors=errors or []))
    claude = FakeClient([msg([record_block(deals)], stop_reason="tool_use")])
    return BrightDataPipeline(bd=bd, anthropic_client=claude, model="test-model"), bd, claude


def run_ig(deals, **kw):
    pipeline, bd, claude = ig_pipeline(deals, **kw)
    out = pipeline.run_instagram(InstagramRequest(handles=["milksha_ca"]), today=TODAY)
    return out, bd, claude.messages.calls


def test_instagram_prompt_lists_docs_and_asks_for_record_tool():
    out, bd, calls = run_ig([deal()])
    call = calls[0]
    assert call["tool_choice"] == {"type": "auto"}  # forced tool_choice is a 400 on claude-opus-5-5
    assert "Call the record_deals tool exactly once" in call["system"]
    assert [t["name"] for t in call["tools"]] == ["record_deals"]
    assert "web_search" not in str(call["tools"])
    prompt = call["messages"][0]["content"]
    assert f"[S1] {POST_URL} | instagram | @milksha_ca | posted: 2026-10-20" in prompt
    assert CAPTION in prompt and "Today is 2026-10-23" in prompt
    assert "ONLY the numbered sources" in call["system"]
    assert bd.ig_calls == [(["https://www.instagram.com/milksha_ca/"], 6, date(2026, 9, 23))]
    assert out.provider == "brightdata_instagram" and out.queries == ["@milksha_ca"] and out.brightdata_requests == 1


def test_instagram_post_date_overrides_claude():
    out, _, _ = run_ig([deal()])
    d = out.deals[0]
    assert d.source_post_date == date(2026, 10, 20)
    assert "post_date_from_source" in d.flags
    assert d.status == DealStatus.live and d.code == "BOGO50"


def test_quote_not_in_source_rejected():
    out, _, _ = run_ig([deal(verbatim_quote="Buy 1 get 1 FREE with code BOGO50")])
    assert not out.deals and out.rejected[0].reason == "quote_not_in_source"


def test_invented_url_rejected():
    out, _, _ = run_ig([deal(source_url="https://www.instagram.com/p/made-up/")])
    assert out.rejected[0].reason == "source_not_in_search_results"


def test_no_posts_skips_claude():
    out, _, calls = run_ig([], posts=[], errors=["@milksha_ca: no public posts returned since 2026-09-23"])
    assert calls == [] and out.deals == []
    assert out.search_errors[0].startswith("@milksha_ca: no public posts")
    assert "nothing to extract" in out.search_errors[-1]


def test_instagram_errors_propagate():
    pipeline, _, _ = ig_pipeline([])
    pipeline.bd.ig = BrightDataTimeout("not ready after 300s")
    with pytest.raises(BrightDataTimeout):
        pipeline.run_instagram(InstagramRequest(handles=["milksha_ca"]), today=TODAY)


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
    out = pipeline.run_serp(SerpSearchRequest(queries=["a", "b", "c"], past_month=False), today=TODAY)
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
