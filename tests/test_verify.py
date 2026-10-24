from datetime import date

from app.schemas import DealStatus, RawDeal, SearchResultSource
from app.verify import normalize_url, parse_page_age, verify_deals

TODAY = date(2026, 10, 23)
IG = "https://www.instagram.com/p/milksha123/"
SOURCES = [SearchResultSource(url=IG, title="Milksha CA", page_age="October 1, 2026")]


def deal(**kw) -> RawDeal:
    base = dict(
        shop_name="Milksha Westwood",
        offer="Buy 1 drink, get the 2nd 50% off",
        code="BOGO50",
        source_url=IG,
        verbatim_quote="Buy 1 drink and get the second 50% off with code BOGO50, all October long",
        end_date=date(2026, 10, 31),
    )
    base.update(kw)
    return RawDeal(**base)


def test_normalize_url_ignores_scheme_www_query_and_slash():
    assert normalize_url("https://www.Instagram.com/p/abc/?igsh=xyz") == normalize_url("http://instagram.com/p/abc")


def test_live_when_end_date_in_future():
    kept, rejected = verify_deals([deal()], SOURCES, TODAY)
    assert not rejected
    assert kept[0].status == DealStatus.live
    assert kept[0].code == "BOGO50"


def test_rejects_source_not_returned_by_search():
    kept, rejected = verify_deals([deal(source_url="https://instagram.com/p/made-up")], SOURCES, TODAY)
    assert not kept
    assert rejected[0].reason == "source_not_in_search_results"


def test_rejects_missing_quote():
    kept, rejected = verify_deals([deal(verbatim_quote="  ")], SOURCES, TODAY)
    assert rejected[0].reason == "missing_quote"


def test_drops_code_not_in_quote():
    # The MYBOGO case: a code that the cited text doesn't contain.
    kept, _ = verify_deals([deal(code="MYBOGO")], SOURCES, TODAY)
    assert kept[0].code is None
    assert "code_not_in_quote" in kept[0].flags


def test_code_match_ignores_case_and_punctuation():
    kept, _ = verify_deals([deal(code="bogo-50")], SOURCES, TODAY)
    assert kept[0].code == "bogo-50"
    assert "code_not_in_quote" not in kept[0].flags


def test_expired_when_end_date_passed():
    kept, _ = verify_deals([deal(end_date=date(2026, 10, 1))], SOURCES, TODAY)
    assert kept[0].status == DealStatus.expired


def test_stale_when_no_end_date_and_old_post():
    kept, _ = verify_deals([deal(end_date=None, source_post_date=date(2026, 5, 7))], SOURCES, TODAY)
    assert kept[0].status == DealStatus.stale
    assert "no_end_date" in kept[0].flags


def test_recent_post_without_end_date_is_live_but_flagged():
    kept, _ = verify_deals([deal(end_date=None, source_post_date=date(2026, 10, 20))], SOURCES, TODAY)
    assert kept[0].status == DealStatus.live
    assert "no_end_date" in kept[0].flags


def test_needs_check_when_no_dates_at_all():
    sources = [SearchResultSource(url=IG, page_age=None)]
    kept, _ = verify_deals([deal(end_date=None)], sources, TODAY)
    assert kept[0].status == DealStatus.needs_check
    assert "no_dates" in kept[0].flags


def test_falls_back_to_search_page_age():
    # page_age October 1 is 22 days old -> stale without an end date.
    kept, _ = verify_deals([deal(end_date=None)], SOURCES, TODAY)
    assert kept[0].source_post_date == date(2026, 10, 1)
    assert "post_date_from_page_age" in kept[0].flags
    assert kept[0].status == DealStatus.stale


def test_low_confidence_never_live():
    kept, _ = verify_deals([deal(confidence="low")], SOURCES, TODAY)
    assert kept[0].status == DealStatus.needs_check
    assert "low_confidence" in kept[0].flags


def test_future_post_date_ignored():
    kept, _ = verify_deals([deal(end_date=None, source_post_date=date(2027, 1, 1))], [SearchResultSource(url=IG)], TODAY)
    assert "post_date_in_future" in kept[0].flags
    assert kept[0].status == DealStatus.needs_check


def test_dedupe_keeps_newest_post():
    old = deal(source_post_date=date(2026, 10, 1), verbatim_quote="old post: code BOGO50")
    new = deal(source_post_date=date(2026, 10, 15), verbatim_quote="new post: code BOGO50")
    kept, _ = verify_deals([old, new], SOURCES, TODAY)
    assert len(kept) == 1
    assert kept[0].verbatim_quote.startswith("new post")


def test_sorted_live_before_expired():
    expired = deal(shop_name="A Cafe", offer="free cookie", code=None, end_date=date(2026, 9, 1))
    live = deal(shop_name="Z Boba")
    kept, _ = verify_deals([expired, live], SOURCES, TODAY)
    assert [d.status for d in kept] == [DealStatus.live, DealStatus.expired]


def test_parse_page_age_formats():
    assert parse_page_age("April 30, 2026", TODAY) == date(2026, 4, 30)
    assert parse_page_age("2026-10-20", TODAY) == date(2026, 10, 20)
    assert parse_page_age("3 days ago", TODAY) == date(2026, 10, 20)
    assert parse_page_age("2 weeks ago", TODAY) == date(2026, 10, 9)
    assert parse_page_age("sometime", TODAY) is None
