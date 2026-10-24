from datetime import date, datetime, timezone

from app.brightdata import IgPost, SerpResult
from app.sources import from_instagram, from_serp, post_dates, source_texts, to_search_sources


def test_from_serp_numbers_and_dedupes():
    docs = from_serp(
        [
            SerpResult(1, "Milksha (@milksha_ca)", "https://www.instagram.com/p/abc/", "BOGO all week"),
            SerpResult(2, "dup", "http://instagram.com/p/abc?igsh=1", "same post"),
            SerpResult(3, "Westwood deals", "https://example.com/deals", ""),
        ]
    )
    assert [d.id for d in docs] == ["S1", "S2"]
    assert docs[0].text == "Milksha (@milksha_ca)\nBOGO all week" and docs[0].origin == "serp"
    assert docs[0].post_date is None
    assert docs[1].text == "Westwood deals"


def test_from_instagram_uses_local_date_and_skips_empty_captions():
    late_evening_la = datetime(2026, 10, 20, 3, 30, tzinfo=timezone.utc)  # Oct 19, 8:30pm in LA
    docs = from_instagram(
        [
            IgPost(url="https://www.instagram.com/p/a/", handle="milksha_ca", caption="BOGO", posted_at=late_evening_la),
            IgPost(url="https://www.instagram.com/p/b/", handle="milksha_ca", caption="  ", posted_at=late_evening_la),
        ]
    )
    assert len(docs) == 1
    d = docs[0]
    assert (d.id, d.post_date, d.handle, d.origin, d.title) == ("S1", date(2026, 10, 19), "milksha_ca", "instagram", "@milksha_ca on Instagram")


def test_lookups_keyed_by_normalized_url():
    docs = from_instagram(
        [IgPost(url="https://www.instagram.com/p/a/", handle="m", caption="BOGO", posted_at=datetime(2026, 10, 2, 18, tzinfo=timezone.utc))]
    )
    assert source_texts(docs) == {"instagram.com/p/a": "BOGO"}
    assert post_dates(docs) == {"instagram.com/p/a": date(2026, 10, 2)}
    assert to_search_sources(docs)[0].page_age == "2026-10-02"


def test_serp_snippet_date_becomes_page_age_not_post_date():
    docs = from_serp(
        [
            SerpResult(1, "Daily Bruin guide", "https://dailybruin.com/guide", "May 15, 2025 — What sets Just Boba apart is its deals."),
            SerpResult(2, "Milksha", "https://www.instagram.com/p/x/", "3 days ago – Buy 1 get 1 50% off"),
            SerpResult(3, "Plain", "https://example.com/p", "No date here — just text"),
        ]
    )
    assert [d.page_age for d in docs] == ["May 15, 2025", "3 days ago", None]
    assert all(d.post_date is None for d in docs)
    assert post_dates(docs) == {}
    assert [s.page_age for s in to_search_sources(docs)] == ["May 15, 2025", "3 days ago", None]
