"""What a visitor can and cannot see."""

from .helpers import ADMIN, PUBLIC, make_category, make_product


def names(r) -> list[str]:
    return [p["name"] for p in r.json()["items"]]


def test_only_published_products_are_visible(signed_in, anon):
    cat = make_category(signed_in)["id"]
    shown = make_product(signed_in, category_id=cat, publish=True, name="Hiển thị")
    draft = make_product(signed_in, category_id=cat, name="Nháp")
    hidden = make_product(signed_in, category_id=cat, publish=True, name="Đã ẩn")
    signed_in.post(f"{ADMIN}/products/{hidden['id']}/hide")

    assert names(anon.get(f"{PUBLIC}/products")) == ["Hiển thị"]
    assert anon.get(f"{PUBLIC}/products/{shown['slug']}").status_code == 200
    for slug in (draft["slug"], hidden["slug"], "no-such-product"):
        r = anon.get(f"{PUBLIC}/products/{slug}")
        assert r.status_code == 404 and r.json()["error"]["code"] == "product_not_found"
    # draft, hidden and unknown answer identically, so a draft's existence is not revealed
    assert (
        anon.get(f"{PUBLIC}/products/{draft['slug']}").json() == anon.get(f"{PUBLIC}/products/no-such").json()
    )


def test_search_ignores_accents_and_case(signed_in, anon):
    cat = make_category(signed_in, "Quà vặt")["id"]  # a neutral category, so only the names are searched
    make_product(signed_in, category_id=cat, publish=True, name="Bánh tráng trộn Tây Ninh")
    make_product(signed_in, category_id=cat, publish=True, name="Khô gà lá chanh")

    for q in ("banh trang", "BÁNH TRÁNG", "bánh trang", "tay ninh", "  banh   tron "):
        assert names(anon.get(f"{PUBLIC}/products", params={"q": q})) == ["Bánh tráng trộn Tây Ninh"], q
    assert names(anon.get(f"{PUBLIC}/products", params={"q": "kho ga"})) == ["Khô gà lá chanh"]
    assert names(anon.get(f"{PUBLIC}/products", params={"q": "banh kho"})) == []  # every word must match


def test_search_finds_by_sku_and_treats_wildcards_literally(signed_in, anon):
    cat = make_category(signed_in)["id"]
    make_product(
        signed_in,
        category_id=cat,
        publish=True,
        name="Bò khô",
        variants=[{"sku": "BK-200", "name": "Hộp 200g", "priceVnd": 129000}],
    )
    assert names(anon.get(f"{PUBLIC}/products", params={"q": "bk-200"})) == ["Bò khô"]
    for wildcard in ("%", "_", "%%"):
        assert anon.get(f"{PUBLIC}/products", params={"q": wildcard}).json()["total"] == 0


def test_category_filter_and_category_list(signed_in, anon):
    snacks = make_category(signed_in, "Bánh tráng")
    meat = make_category(signed_in, "Khô & mực")
    empty = make_category(signed_in, "Chưa có hàng")
    make_product(signed_in, category_id=snacks["id"], publish=True, name="A")
    make_product(signed_in, category_id=snacks["id"], publish=True, name="B")
    make_product(signed_in, category_id=meat["id"], name="C nháp")  # draft: does not count

    r = anon.get(f"{PUBLIC}/products", params={"category": snacks["slug"]})
    assert sorted(names(r)) == ["A", "B"]
    assert anon.get(f"{PUBLIC}/products", params={"category": "unknown"}).json()["total"] == 0

    listed = anon.get(f"{PUBLIC}/categories").json()
    assert [(c["slug"], c["productCount"]) for c in listed] == [(snacks["slug"], 2)]
    assert empty["slug"] not in [c["slug"] for c in listed]


def test_pagination(signed_in, anon):
    cat = make_category(signed_in)["id"]
    for i in range(5):
        make_product(signed_in, category_id=cat, publish=True, name=f"P{i}")
    first = anon.get(f"{PUBLIC}/products", params={"pageSize": 2, "page": 1}).json()
    last = anon.get(f"{PUBLIC}/products", params={"pageSize": 2, "page": 3}).json()
    beyond = anon.get(f"{PUBLIC}/products", params={"pageSize": 2, "page": 9}).json()
    assert (first["total"], first["page"], first["pageSize"], len(first["items"])) == (5, 1, 2, 2)
    assert len(last["items"]) == 1
    assert beyond["items"] == [] and beyond["total"] == 5
    assert anon.get(f"{PUBLIC}/products", params={"pageSize": 49}).status_code == 422
    assert anon.get(f"{PUBLIC}/products", params={"page": 0}).status_code == 422


def test_sorting(signed_in, anon):
    cat = make_category(signed_in)["id"]
    for name, price in (("Cc", 30000), ("Aa", 10000), ("Bb", 20000)):
        make_product(
            signed_in,
            category_id=cat,
            publish=True,
            name=name,
            variants=[{"sku": f"S-{name}", "name": "x", "priceVnd": price}],
        )
    get = lambda sort: names(anon.get(f"{PUBLIC}/products", params={"sort": sort}))  # noqa: E731
    assert get("price_asc") == ["Aa", "Bb", "Cc"]
    assert get("price_desc") == ["Cc", "Bb", "Aa"]
    assert get("name") == ["Aa", "Bb", "Cc"]
    assert get("newest") == ["Bb", "Aa", "Cc"]  # last created first
    assert anon.get(f"{PUBLIC}/products", params={"sort": "random"}).status_code == 422


def test_card_shows_the_cheapest_active_variant(signed_in, anon):
    cat = make_category(signed_in)["id"]
    p = make_product(
        signed_in,
        category_id=cat,
        publish=True,
        variants=[
            {"sku": "BIG-1", "name": "Gói 500g", "priceVnd": 69000, "compareAtVnd": 89000},
            {"sku": "SMALL-1", "name": "Gói 250g", "priceVnd": 39000, "compareAtVnd": 49000},
        ],
    )
    card = anon.get(f"{PUBLIC}/products").json()["items"][0]
    assert (card["priceFromVnd"], card["compareAtFromVnd"], card["variantCount"]) == (39000, 49000, 2)

    # deactivating a variant removes it from the customer's view and from the "from" price
    small = next(v for v in p["variants"] if v["sku"] == "SMALL-1")
    assert signed_in.patch(f"{ADMIN}/variants/{small['id']}", json={"isActive": False}).status_code == 200
    card = anon.get(f"{PUBLIC}/products").json()["items"][0]
    assert (card["priceFromVnd"], card["variantCount"]) == (69000, 1)
    detail = anon.get(f"{PUBLIC}/products/{p['slug']}").json()
    assert [v["sku"] for v in detail["variants"]] == ["BIG-1"]


def test_public_detail_shape(signed_in, anon):
    cat = make_category(signed_in, "Bánh tráng")
    p = make_product(
        signed_in,
        category_id=cat["id"],
        publish=True,
        name="Bánh tráng muối tôm",
        shopeeUrl="https://shopee.vn/x",
    )
    d = anon.get(f"{PUBLIC}/products/{p['slug']}").json()
    assert d["slug"] == "banh-trang-muoi-tom"
    assert d["category"]["slug"] == cat["slug"]
    assert d["ingredients"] and d["storage"] and d["shopeeUrl"] == "https://shopee.vn/x"
    assert d["isDemo"] is False
    # the public view never carries back-office fields
    assert "ingredientsVerified" not in d and "status" not in d and "publishBlockers" not in d
    public = {
        "id",
        "sku",
        "name",
        "priceVnd",
        "compareAtVnd",
        "weightG",
        "available",
        "stockStatus",
        "stockUpdatedAt",
    }
    assert all(set(v) == public for v in d["variants"])


def test_the_category_name_is_searchable_too(signed_in, anon):
    cat = make_category(signed_in, "Khô & mực")["id"]
    make_product(signed_in, category_id=cat, publish=True, name="Sản phẩm bất kỳ")
    assert names(anon.get(f"{PUBLIC}/products", params={"q": "kho muc"})) == ["Sản phẩm bất kỳ"]
