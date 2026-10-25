from datetime import date, datetime, timezone

import pytest

from app.brightdata import BrightDataAuthError, BrightDataError, IgPost, SerpResult
from app.google_lookup import GoogleLookup, accounts_from_results, deal_queries, handle_matches, lookup_query
from app.schemas import KnownShop, Location, Shop, ShopsRequest
from app.shop_pipeline import ShopCache, ShopPipeline
from tests.test_bd_pipeline import FakeBD
from tests.test_extractor import FakeClient, msg, record_block
from tests.test_shop_pipeline import FakeApify, deal

TODAY = date(2026, 10, 23)
REQ = ShopsRequest(location=Location(neighborhood="Westwood"), search_terms=["boba"], sweep=False)


def serp(link, title="", description=""):
    return SerpResult(1, title, link, description)


@pytest.mark.parametrize(
    "handle,name,ok",
    [
        ("juicecrafters", "Juice Crafters", True),
        ("loklhaus", "LOKL HAUS", True),
        ("chichasanchen.sawtelle", "CHICHA San Chen - Sawtelle", True),
        ("juicecraftersla", "Juice Crafters", True),
        ("westwoodfoodie", "Juice Crafters", False),
        ("juice", "Juice Crafters", False),  # one word of two
        ("tiktok", "Lokl Haus", False),
        ("ab", "AB Cafe", False),
    ],
)
def test_handle_matches(handle, name, ok):
    assert handle_matches(handle, name) is ok


def test_handle_matches_ignores_location_words():
    assert handle_matches("milksha_ca", "Milksha Westwood", ("westwood", "los", "angeles"))
    assert not handle_matches("milksha_ca", "Milksha Westwood")
    # A name that is only a place word falls back to using it, rather than matching anything.
    assert handle_matches("westwoodcafe", "Westwood Cafe", ("westwood",))
    assert not handle_matches("bobaguys", "Westwood Cafe", ("westwood",))


def test_accounts_from_links_and_snippets():
    results = [
        serp("https://www.yelp.com/biz/juice-crafters", "JUICE CRAFTERS - 323 Reviews"),
        serp("https://www.facebook.com/juicecrafters/?locale=lt_LT", "Juice Crafters | Los Angeles CA"),
        serp("https://www.instagram.com/reel/DbGcYvpoigI/", "Coffee?", "Try it @westwoodfoodie and @juicecrafters"),
        serp("https://www.tiktok.com/@juicecrafters.la", "Juice Crafters (@juicecrafters.la) | TikTok"),
    ]
    found = accounts_from_results(results, "Juice Crafters")
    assert found.facebook == "https://www.facebook.com/juicecrafters/"
    assert found.instagram == "juicecrafters"  # from the snippet's @handle, not the creator's
    assert found.tiktok == "juicecrafters.la"


def test_accounts_ignore_unrelated_handles():
    results = [serp("https://www.instagram.com/westwoodfoodie/", "Westwood Foodie", "@bobaguide loves Juice Crafters")]
    found = accounts_from_results(results, "Juice Crafters")
    assert (found.instagram, found.tiktok, found.facebook) == (None, None, None)


def test_queries():
    assert lookup_query(Shop(name="Juice Crafters"), REQ) == '"Juice Crafters" Los Angeles instagram tiktok'
    req = ShopsRequest(location=Location(neighborhood="Westwood"))
    assert deal_queries(req, ["restaurant", "boba", "pizza"]) == [
        "site:instagram.com Westwood Los Angeles restaurant deal",
        "Westwood Los Angeles restaurant deal",
        "site:instagram.com Westwood Los Angeles boba deal",
        "Westwood Los Angeles boba deal",
    ]


def test_fill_accounts_only_for_maps_shops_missing_links():
    full = Shop(name="Milksha", instagram="milksha_ca", tiktok="milksha", facebook="https://www.facebook.com/milksha/")
    missing = Shop(name="Juice Crafters")
    mention = Shop(name="@someone", instagram="someone", found_via="mention")
    bd = FakeBD(serp={lookup_query(missing, REQ): [serp("https://www.instagram.com/juicecrafters/", "Juice Crafters")]})
    lookup = GoogleLookup(bd)
    added = lookup.fill_accounts([full, missing, mention], REQ, [])
    assert [q for q, _ in bd.serp_calls] == [lookup_query(missing, REQ)]
    assert missing.instagram == "juicecrafters" and added == ["Juice Crafters: instagram juicecrafters"]
    assert lookup.counter.count == 1


def test_find_deals_fetches_instagram_posts_and_keeps_other_snippets():
    queries = deal_queries(REQ, ["boba"])
    post = IgPost(url="https://www.instagram.com/p/abc123/", handle="Just_Boba", caption="BOGO today", posted_at=datetime(2026, 10, 22, tzinfo=timezone.utc))
    bd = FakeBD(
        serp={
            queries[0]: [serp("https://www.instagram.com/p/abc123/", "BOGO"), serp("https://www.instagram.com/reel/abc123/", "dup")],
            queries[1]: [serp("https://www.reddit.com/r/ucla/comments/x/boba/", "Best boba deal?"), serp("/goto?url=x", "redirect")],
        },
        posts_by_url={"abc123": post},
    )
    found = GoogleLookup(bd).find_deals(REQ, ["boba"], TODAY, [])
    assert bd.post_calls == [["https://www.instagram.com/p/abc123/"]]  # deduped by shortcode
    assert [p.handle for p in found.posts] == ["just_boba"] and found.posts[0].platform == "instagram"
    assert [s.link for s in found.snippets] == ["https://www.reddit.com/r/ucla/comments/x/boba/"]  # redirect dropped
    assert found.labels == [f"google: {q}" for q in queries]


def test_find_deals_notes_failures():
    queries = deal_queries(REQ, ["boba"])
    bd = FakeBD(serp={queries[0]: BrightDataError("blocked"), queries[1]: [serp("https://www.instagram.com/p/zz9/")]}, posts_by_url=BrightDataError("down"))
    errors = []
    found = GoogleLookup(bd).find_deals(REQ, ["boba"], TODAY, errors)
    assert found.posts == [] and any("google search failed" in e for e in errors)
    assert any("couldn't fetch the 1 Instagram post" in e for e in errors)
    assert [r.link for r in found.snippets] == ["https://www.instagram.com/p/zz9/"]  # kept as a snippet instead


# --- in /extract/shops ------------------------------------------------------------------

NO_IG = Shop(name="Juice Crafters", place_id="ChIJjc", website="https://juicecrafters.com/")
JC_POST = "https://www.instagram.com/p/jc1/"


def run(bd, deals=(), req=REQ, shops=None):
    apify = FakeApify(shops=[NO_IG.model_copy()] if shops is None else shops)
    claude = FakeClient([msg([record_block(list(deals))], stop_reason="tool_use")])
    pipeline = ShopPipeline(apify=apify, anthropic_client=claude, model="test-model", cache=ShopCache(None), bd=bd)
    progress = []
    return pipeline.run(req, on_progress=progress.append, today=TODAY), apify, claude.messages.calls, progress


def jc_bd(**kw):
    queries = deal_queries(REQ, ["boba"])
    post = IgPost(url=JC_POST, handle="juicecrafters", caption="Free smoothie Friday for students", posted_at=datetime(2026, 10, 22, tzinfo=timezone.utc))
    return FakeBD(
        serp={
            lookup_query(NO_IG, REQ): [serp("https://www.facebook.com/juicecrafters/", "Juice Crafters", "@juicecrafters")],
            queries[0]: [serp(JC_POST, "Free smoothie Friday")],
            queries[1]: [serp("https://dailybruin.com/2026/10/20/boba-deals", "Westwood boba deals this week", "Sharetea BOGO Tuesday")],
        },
        posts_by_url={"jc1": post},
        **kw,
    )


def test_pipeline_uses_found_accounts_and_google_posts():
    deals = [deal(JC_POST, "Free smoothie Friday for students", shop_name="Juice Crafters"),
             deal("https://dailybruin.com/2026/10/20/boba-deals", "Sharetea BOGO Tuesday", shop_name="Sharetea", confidence="low")]
    out, apify, calls, progress = run(jc_bd(), deals)
    # The lookup filled Instagram and Facebook, so those channels ran for the shop.
    assert apify.calls["instagram"] == [["juicecrafters"]]
    assert apify.calls["facebook"] == [["https://www.facebook.com/juicecrafters/"]]
    assert any("Google found 2 missing account(s)" in p for p in progress)
    by_url = {d.source_url: d for d in out.deals}
    assert "shop_own_post" in by_url[JC_POST].flags  # posted by the shop's (found) account
    assert by_url[JC_POST].shop_id == "gmaps:ChIJjc"
    assert "second_hand" in by_url["https://dailybruin.com/2026/10/20/boba-deals"].flags
    assert out.brightdata_requests == 4  # 1 lookup + 2 deal searches + 1 post fetch
    assert "google: Westwood Los Angeles boba deal" in out.queries
    prompt = calls[0]["messages"][0]["content"]
    assert prompt.index(JC_POST) < prompt.index("dailybruin.com")  # snippets go last


def test_pipeline_without_brightdata_or_with_google_off():
    out, apify, *_ = run(None)
    assert out.brightdata_requests == 0 and "instagram" not in apify.calls  # no account to scrape
    bd = jc_bd()
    out, *_ = run(bd, req=REQ.model_copy(update={"google": False}))
    assert bd.serp_calls == [] and out.brightdata_requests == 0


def test_pipeline_survives_brightdata_auth_error():
    class Rejected(FakeBD):
        def serp_search(self, *a, **kw):
            raise BrightDataAuthError("bad key")

    out, apify, *_ = run(Rejected())
    assert any("Bright Data" in e for e in out.search_errors)
    assert apify.calls["website"] == [["https://juicecrafters.com/"]]  # Apify channels still ran


def test_post_by_a_shop_found_only_through_a_deal_counts_as_its_own():
    queries = deal_queries(REQ, ["boba"])
    url = "https://www.instagram.com/p/viet1/"
    post = IgPost(url=url, handle="26vietcafe.usa", caption="Soft opening: buy one get one free", posted_at=datetime(2026, 10, 22, tzinfo=timezone.utc))
    bd = FakeBD(serp={queries[0]: [serp(url, "BOGO")]}, posts_by_url={"viet1": post})
    out, *_ = run(bd, [deal(url, "buy one get one free", shop_name="26 Viet Cafe", shop_handle="26vietcafe.usa")])
    [d] = out.deals
    assert "shop_own_post" in d.flags and d.shop_id == "ig:26vietcafe.usa"
    assert [s.found_via for s in out.shops if s.id == d.shop_id] == ["deal"]


def test_store_batch_fills_accounts_but_skips_the_area_deal_search():
    known = KnownShop(id="gmaps:ChIJjc", name="Juice Crafters", website="https://juicecrafters.com/", lookup=True)
    req = ShopsRequest(location=Location(neighborhood="Westwood"), stores=[known])
    out, apify, _, progress = run(jc_bd(), req=req)
    assert apify.calls["instagram"] == [["juicecrafters"]]  # the handle the lookup found
    assert out.brightdata_requests == 1  # the lookup only: no deal searches, no post fetch
    assert not any(q.startswith("google:") for q in out.queries)
    assert out.shops[0].instagram == "juicecrafters" and out.shops[0].id == "gmaps:ChIJjc"


def test_store_batch_looks_up_only_the_stores_convex_asks_for():
    known = KnownShop(id="gmaps:ChIJjc", name="Juice Crafters", website="https://juicecrafters.com/")
    out, apify, *_ = run(jc_bd(), req=ShopsRequest(location=Location(neighborhood="Westwood"), stores=[known]))
    assert out.brightdata_requests == 0 and "instagram" not in apify.calls
