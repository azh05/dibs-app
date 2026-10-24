from datetime import date

from app.linking import deal_id, link_deals, names_match
from app.schemas import Deal, DealStatus, Shop
from app.sources import SourceDoc

MILKSHA = Shop(name="Milksha Westwood", place_id="ChIJ1", address="1099 Westwood Blvd", instagram="milksha_ca")
CHICHA = Shop(name="CHICHA San Chen - Sawtelle", place_id="ChIJ2", tiktok="chichasanchen")


def deal(**kw):
    base = dict(
        shop_name="Milksha", offer="BOGO", source_url="https://www.instagram.com/p/a/", verbatim_quote="Buy one get one",
        status=DealStatus.live,
    )
    base.update(kw)
    return Deal(**base)


def doc(url, shop=None):
    return SourceDoc(id="S1", url=url, title=None, text="x", post_date=None, origin="instagram", handle=None, shop=shop)


def test_shop_ids():
    assert MILKSHA.id == "gmaps:ChIJ1"
    assert Shop(name="@bobafan", instagram="BobaFan").id == "ig:bobafan"
    assert Shop(name="Corner Deli & Co.").id == "name:corner-deli-co"
    # Cached shops written before ids existed still get one.
    assert Shop.model_validate({"name": "Milksha", "place_id": "ChIJ1"}).id == "gmaps:ChIJ1"


def test_own_post_links_to_its_shop_even_if_claude_names_it_differently():
    d = deal(shop_name="Milksha Taiwan")
    shops = link_deals([d], [doc("https://www.instagram.com/p/a/", shop="Milksha Westwood")], [MILKSHA, CHICHA])
    assert d.shop_id == "gmaps:ChIJ1" and d.address == "1099 Westwood Blvd"
    assert len(shops) == 2


def test_creator_post_links_by_handle_then_name():
    by_handle = deal(shop_name="some cafe", shop_handle="@chichasanchen", source_url="https://tiktok.com/@fan/video/1")
    by_name = deal(shop_name="Chicha San Chen", source_url="https://tiktok.com/@fan/video/2")
    link_deals([by_handle, by_name], [], [MILKSHA, CHICHA])
    assert by_handle.shop_id == by_name.shop_id == "gmaps:ChIJ2"


def test_unknown_shop_becomes_a_new_shop_record_once():
    a = deal(shop_name="Molly Tea", source_url="https://tiktok.com/@fan/video/1", verbatim_quote="BOGO signature drinks")
    b = deal(shop_name="Molly Tea", source_url="https://tiktok.com/@fan/video/2", verbatim_quote="6% off")
    shops = link_deals([a, b], [], [MILKSHA])
    new = [s for s in shops if s.found_via == "deal"]
    assert [s.id for s in new] == ["name:molly-tea"]
    assert a.shop_id == b.shop_id == "name:molly-tea"


def test_deal_id_stable_and_distinct():
    a, b = deal(), deal(offer="Buy 1 get 1 free (reworded)")
    assert deal_id(a) == deal_id(b)  # Claude rewording the offer doesn't change the id
    assert deal_id(a) != deal_id(deal(verbatim_quote="20% off"))
    assert deal_id(a) == deal_id(deal(source_url="https://instagram.com/p/a"))  # URL normalized
    link_deals([a], [], [MILKSHA])
    assert a.id and a.id.startswith("deal:")


def test_names_match():
    assert names_match("Milksha", "Milksha Westwood")
    assert names_match("CHICHA San Chen - Sawtelle", "Chicha San Chen")
    assert not names_match("Tea", "Tea Station Westwood")  # too short to trust a substring
    assert not names_match("Boba Guys", "Boba Time")
