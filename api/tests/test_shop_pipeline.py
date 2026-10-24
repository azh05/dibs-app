from datetime import date, datetime, timedelta, timezone

import pytest

from app.apify import ApifyAuthError, ApifyError, SocialPost, WebPage
from app.schemas import DealStatus, Location, Shop, ShopsRequest
from app.shop_pipeline import ShopCache, ShopPipeline, mentioned_shops, search_terms, sweep_targets
from tests.test_extractor import FakeClient, msg, record_block

TODAY = date(2026, 10, 23)
SINCE_POST = datetime(2026, 10, 20, 18, tzinfo=timezone.utc)

MILKSHA = Shop(
    name="Milksha Westwood",
    address="1099 Westwood Blvd",
    website="https://milksha.com/",
    instagram="milksha_ca",
    tiktok="milksha.ca",
    facebook="https://www.facebook.com/MilkshaUSA/",
)
NO_LINKS = Shop(name="Corner Deli")

IG_URL = "https://www.instagram.com/reel/abc/"
TT_URL = "https://www.tiktok.com/@milksha.ca/video/1"
FB_URL = "https://www.facebook.com/MilkshaUSA/posts/1"
WEB_URL = "https://milksha.com/specials"
FAN_URL = "https://www.tiktok.com/@westwoodfoodie/video/9"

IG_POST = SocialPost("instagram", IG_URL, "milksha_ca", "Grand opening! Buy 1 get 1 50% off with code BOGO50 until Oct 31.", SINCE_POST)
TT_POST = SocialPost("tiktok", TT_URL, "milksha.ca", "Free topping Friday, every Friday this month", SINCE_POST)
FB_POST = SocialPost(
    "facebook", FB_URL, "Milksha USA", "See you this weekend\n[image text] STUDENT DEAL 20% OFF WITH UCLA ID", SINCE_POST,
    input_url="https://www.facebook.com/MilkshaUSA",
)
WEB_PAGE = WebPage(WEB_URL, "Specials", "Menu\nBrown sugar milk $6\nHappy hour 3-5pm: $2 off any large drink\nContact us")
FAN_POST = SocialPost("tiktok", FAN_URL, "westwoodfoodie", "Milksha is doing $3 drinks today @newbobaspot", SINCE_POST, mentions=["newbobaspot", "milksha.ca"])


class FakeApify:
    def __init__(self, shops=None, fail=None):
        self.shops = [MILKSHA] if shops is None else shops
        self.fail = fail or {}
        self.calls = {}
        self.token = "tok"

    def require_token(self):
        if not self.token:
            raise ApifyAuthError("APIFY_TOKEN is not set")

    def _call(self, name, args, result):
        self.calls.setdefault(name, []).append(args)
        if name in self.fail:
            raise self.fail[name]
        return result

    def find_shops(self, terms, location, per_term, errors, counter=None, found_via="google_maps"):
        return self._call("maps", (terms, location, per_term, found_via), list(self.shops))

    def instagram_posts(self, handles, since, n, errors, counter=None):
        return self._call("instagram", handles, [IG_POST])

    def instagram_hashtags(self, hashtags, since, limit, errors, counter=None):
        return self._call("hashtags", hashtags, [])

    def tiktok_videos(self, profiles, since, n, errors, counter=None):
        return self._call("tiktok", profiles, [TT_POST])

    def tiktok_search(self, queries, limit, errors, counter=None):
        return self._call("tiktok_search", queries, [FAN_POST])

    def facebook_posts(self, pages, since, n, errors, counter=None):
        return self._call("facebook", pages, [FB_POST])

    def website_pages(self, sites, n, errors, counter=None):
        return self._call("website", sites, [WEB_PAGE])


def deal(url, quote, **kw):
    # verify_deals dedupes on shop + offer + code, so each test deal gets its own offer.
    base = {"shop_name": "Milksha Westwood", "offer": quote, "source_url": url, "verbatim_quote": quote, "confidence": "high"}
    base.update(kw)
    return base


ALL_DEALS = [
    deal(IG_URL, "Buy 1 get 1 50% off with code BOGO50", code="BOGO50", end_date="2026-10-31"),
    deal(TT_URL, "Free topping Friday"),
    deal(FB_URL, "STUDENT DEAL 20% OFF WITH UCLA ID"),
    deal(WEB_URL, "Happy hour 3-5pm: $2 off any large drink"),
]


def run(deals=ALL_DEALS, req=None, apify=None, cache=None):
    apify = apify or FakeApify()
    claude = FakeClient([msg([record_block(deals)], stop_reason="tool_use")])
    pipeline = ShopPipeline(apify=apify, anthropic_client=claude, model="test-model", cache=cache or ShopCache(None))
    progress = []
    req = req or ShopsRequest(location=Location(neighborhood="Westwood"), categories=["drink"])
    out = pipeline.run(req, on_progress=progress.append, today=TODAY)
    return out, apify, claude.messages.calls, progress


def test_every_channel_scraped_and_verified():
    out, apify, calls, progress = run()
    assert apify.calls["maps"][0][:3] == (["boba", "coffee shop", "juice bar"], "Westwood, Los Angeles, California", 7)
    assert apify.calls["instagram"] == [["milksha_ca"]]
    assert apify.calls["tiktok"] == [["milksha.ca", "newbobaspot"]]  # + an account the sweep post mentions
    assert apify.calls["facebook"] == [["https://www.facebook.com/MilkshaUSA/"]]
    assert apify.calls["website"] == [["https://milksha.com/"]]
    assert {d.source_url for d in out.deals} == {IG_URL, TT_URL, FB_URL, WEB_URL}
    assert all("shop_own_post" in d.flags for d in out.deals)
    assert {d.shop_id for d in out.deals} == {"ig:milksha_ca"} and all(d.id for d in out.deals)
    assert all(d.address == "1099 Westwood Blvd" for d in out.deals)
    assert out.provider == "apify_shops" and out.shops[0].name == "Milksha Westwood"
    assert "found 1 shop(s) on Google Maps" in progress


def test_search_terms_reach_claude():
    _, _, calls, _ = run(req=ShopsRequest(search_terms=["barbershop"], sweep=False))
    assert "Shops were found by searching Google Maps for: barbershop" in calls[0]["messages"][0]["content"]


def test_many_sources_split_across_parallel_claude_calls():
    class Busy(FakeApify):
        def instagram_posts(self, *a, **kw):
            return [SocialPost("instagram", f"https://www.instagram.com/p/x{i}/", "milksha_ca", f"post {i} " + "y" * 1400, SINCE_POST) for i in range(150)]

    apify = Busy()
    batches = [msg([record_block([])], stop_reason="tool_use") for _ in range(4)]
    batches[0] = msg([record_block([deal("https://www.instagram.com/p/x3/", "post 3")])], stop_reason="tool_use")
    claude = FakeClient(batches)
    pipeline = ShopPipeline(apify=apify, anthropic_client=claude, model="test-model", cache=ShopCache(None))
    out = pipeline.run(ShopsRequest(channels=["instagram"], sweep=False), today=TODAY)
    calls = claude.messages.calls
    assert len(calls) >= 2  # 150 long posts don't fit one call
    shown = sum(c["messages"][0]["content"].count("instagram.com/p/x") for c in calls)
    assert shown == 150  # every source reached Claude exactly once
    assert not any("fit in one Claude call" in e for e in out.search_errors)
    assert out.usage.input_tokens == 100 * len(calls)


def test_prompt_marks_shop_own_channels_and_trims_website():
    _, _, calls, _ = run()
    prompt = calls[0]["messages"][0]["content"]
    assert "@milksha_ca | shop's own instagram: Milksha Westwood" in prompt
    assert "shop's own facebook: Milksha Westwood" in prompt
    assert "shop's own website: Milksha Westwood" in prompt
    assert "Happy hour 3-5pm" in prompt and "Contact us" in prompt  # context line kept
    # Second-hand sweep post comes after the shop's own posts and isn't marked as the shop's.
    assert prompt.index(FAN_URL) > prompt.index(WEB_URL)
    assert "@westwoodfoodie | posted" in prompt


def test_post_date_from_scraper_overrides_claude():
    out, *_ = run([deal(IG_URL, "Buy 1 get 1 50% off", source_post_date="2025-01-01", end_date="2026-10-31")])
    assert out.deals[0].source_post_date == date(2026, 10, 20)
    assert out.deals[0].status == DealStatus.live


def test_quote_not_in_source_rejected():
    out, *_ = run([deal(TT_URL, "Free boba for life")])
    assert out.deals == [] and out.rejected[0].reason == "quote_not_in_source"


def test_quote_from_website_menu_text_outside_excerpt_still_verifies():
    out, *_ = run([deal(WEB_URL, "Brown sugar milk $6")])
    assert out.deals and out.deals[0].source_url == WEB_URL


def test_one_channel_failing_keeps_the_others():
    out, *_ = run(apify=FakeApify(fail={"tiktok": ApifyError("boom")}))
    assert TT_URL not in {d.source_url for d in out.deals}
    assert IG_URL in {d.source_url for d in out.deals}
    assert any("tiktok failed" in e for e in out.search_errors)


def test_channel_retried_once():
    class Flaky(FakeApify):
        n = 0

        def facebook_posts(self, *a, **kw):
            self.n += 1
            if self.n == 1:
                raise ApifyError("transient")
            return super().facebook_posts(*a, **kw)

    out, apify, *_ = run(apify=Flaky())
    assert apify.n == 2 and FB_URL in {d.source_url for d in out.deals}


def test_auth_error_fails_job():
    with pytest.raises(ApifyAuthError):
        run(apify=FakeApify(fail={"instagram": ApifyAuthError("bad")}))


def test_maps_failure_fails_job():
    with pytest.raises(ApifyError):
        run(apify=FakeApify(fail={"maps": ApifyError("down")}))


def test_shop_without_links_is_skipped_and_noted():
    out, apify, *_ = run(deals=[], apify=FakeApify(shops=[NO_LINKS]), req=ShopsRequest(sweep=False))
    assert set(apify.calls) == {"maps"}
    assert "no shop had a website or social account to scrape" in out.search_errors


def test_channels_can_be_limited():
    _, apify, *_ = run(deals=[], req=ShopsRequest(channels=["website"], sweep=False))
    assert set(apify.calls) == {"maps", "website"}


def test_sweep_mentions_become_extra_shops():
    out, apify, *_ = run(deals=[])
    # @milksha.ca is already a shop; @newbobaspot is new and gets its TikTok scraped.
    assert apify.calls["tiktok"] == [["milksha.ca", "newbobaspot"]]
    assert [s.name for s in out.shops] == ["Milksha Westwood", "@newbobaspot"]
    assert out.shops[1].found_via == "mention"
    assert "tiktok: Westwood boba deal" in out.queries and "#westwoodeats" in out.queries


def test_second_hand_post_is_kept_and_flagged():
    out, *_ = run([deal(FAN_URL, "Milksha is doing $3 drinks today", confidence="medium")])
    [d] = out.deals
    assert "second_hand" in d.flags and "shop_own_post" not in d.flags
    assert d.shop_id == "ig:milksha_ca"  # "Milksha Westwood" named in the creator post
    assert d.status == DealStatus.live  # a concrete creator post can be live; the flag marks it less verified


def test_prompt_lets_creator_posts_through_at_medium():
    _, _, calls, _ = run()
    assert 'Use confidence "medium" at most when it names the shop' in calls[0]["system"]


def test_old_pinned_posts_dropped():
    class Pinned(FakeApify):
        def instagram_posts(self, *a, **kw):
            old = SocialPost("instagram", "https://www.instagram.com/p/old/", "milksha_ca", "Opening sale 2024", datetime(2024, 1, 1, tzinfo=timezone.utc))
            return [IG_POST, old]

    out, *_ = run(deals=[], apify=Pinned())
    assert "https://www.instagram.com/p/old/" not in {s.url for s in out.sources}
    assert any("older than 14 days" in e for e in out.search_errors)


def test_named_shops_search_one_place_each():
    req = ShopsRequest(shops=["Milksha Westwood"], sweep=False)
    _, apify, *_ = run(deals=[], req=req)
    assert apify.calls["maps"][0] == (["Milksha Westwood"], "Los Angeles, California", 1, "named")


def test_shop_cache_skips_maps_on_repeat(tmp_path):
    cache = ShopCache(tmp_path / "shops.json")
    req = ShopsRequest(location=Location(neighborhood="Westwood"), sweep=False)
    _, first, *_ = run(deals=[], req=req, cache=cache)
    out, second, _, progress = run(deals=[], req=req, cache=cache)
    assert "maps" in first.calls and "maps" not in second.calls
    assert out.shops[0].instagram == "milksha_ca"
    assert any("cached shop" in p for p in progress)
    _, third, *_ = run(deals=[], req=req.model_copy(update={"refresh_shops": True}), cache=cache)
    assert "maps" in third.calls


def test_shop_cache_expires(tmp_path):
    now = [datetime(2026, 10, 1, tzinfo=timezone.utc)]
    cache = ShopCache(tmp_path / "shops.json", clock=lambda: now[0])
    cache.put("k", [MILKSHA])
    assert cache.get("k")[0].name == "Milksha Westwood"
    now[0] += timedelta(days=8)
    assert cache.get("k") is None


def test_search_terms_and_sweep_defaults():
    food_and_drink = ["restaurant", "fast food", "pizza", "dessert", "boba", "coffee shop", "juice bar"]
    assert search_terms(ShopsRequest()) == food_and_drink
    assert search_terms(ShopsRequest(categories=["food", "drink"])) == food_and_drink
    assert search_terms(ShopsRequest(categories=["beauty"])) == ["barbershop", "hair salon", "nail salon"]
    assert search_terms(ShopsRequest(search_terms=["ramen", " ramen "])) == ["ramen"]
    req = ShopsRequest(location=Location(neighborhood="Downtown Berkeley"))
    queries, tags = sweep_targets(req, ["boba", "coffee shop"])
    assert queries == ["Downtown Berkeley boba deal", "Downtown Berkeley coffee shop deal"]
    assert tags == ["downtownberkeleyeats", "downtownberkeleyfood", "downtownberkeleydeals", "downtownberkeleyboba", "downtownberkeleycoffeeshop"]
    req = ShopsRequest(hashtags=["#UCLAEats"], search_queries=["westwood bogo"])
    assert sweep_targets(req, ["boba"]) == (["westwood bogo"], ["uclaeats"])


def test_mentioned_shops_capped_and_excludes_known():
    posts = [SocialPost("instagram", f"u{i}", "fan", "x", None, mentions=[f"shop{i}", "known"]) for i in range(8)]
    shops = mentioned_shops(posts, known={"known"}, limit=3)
    assert len(shops) == 3 and all(s.instagram and s.found_via == "mention" for s in shops)


def test_old_sweep_posts_add_no_mentioned_shops():
    class OldSweep(FakeApify):
        def tiktok_search(self, *a, **kw):
            old = SocialPost("tiktok", FAN_URL, "westwoodfoodie", "x", datetime(2026, 5, 1, tzinfo=timezone.utc), mentions=["newbobaspot"])
            return [old]

    out, apify, *_ = run(deals=[], apify=OldSweep())
    assert apify.calls["tiktok"] == [["milksha.ca"]]
    assert [s.name for s in out.shops] == ["Milksha Westwood"]
