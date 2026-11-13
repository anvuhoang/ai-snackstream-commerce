"""Back-office rules: who may do what, and the invariants that keep the catalog sellable."""

import pytest

from .helpers import ADMIN, PUBLIC, make_category, make_product, product_payload


# ------------------------------------------------------------------ access control
def test_anonymous_is_rejected_everywhere(anon):
    assert anon.get(f"{ADMIN}/products").status_code == 401
    assert anon.get(f"{ADMIN}/categories").status_code == 401
    assert anon.post(f"{ADMIN}/products", json=product_payload()).status_code == 401


def test_staff_can_read_but_not_change_the_catalog(signed_in, staff):
    p = make_product(signed_in)
    assert staff.get(f"{ADMIN}/products").status_code == 200
    assert staff.get(f"{ADMIN}/products/{p['id']}").status_code == 200
    for r in (
        staff.post(f"{ADMIN}/products", json=product_payload()),
        staff.patch(f"{ADMIN}/products/{p['id']}", json={"name": "x"}),
        staff.post(f"{ADMIN}/products/{p['id']}/publish"),
        staff.post(f"{ADMIN}/categories", json={"name": "x"}),
    ):
        assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden"


def test_writes_need_the_csrf_token(signed_in):
    del signed_in.headers["X-CSRF-Token"]
    r = signed_in.post(f"{ADMIN}/products", json=product_payload())
    assert r.status_code == 403 and r.json()["error"]["code"] == "csrf_invalid"


# ------------------------------------------------------------------ creating products
def test_create_generates_unique_slugs_and_normalizes_skus(signed_in):
    a = make_product(
        signed_in, name="Bánh tráng trộn", variants=[{"sku": "btt-1", "name": "x", "priceVnd": 1}]
    )
    b = make_product(signed_in, name="Bánh tráng trộn")
    assert (a["slug"], b["slug"]) == ("banh-trang-tron", "banh-trang-tron-2")
    assert a["status"] == "draft"
    assert a["variants"][0]["sku"] == "BTT-1"  # upper-cased


@pytest.mark.parametrize(
    "change",
    [
        {"variants": []},
        {"name": ""},
        {"variants": [{"sku": "A B", "name": "x", "priceVnd": 1}]},  # space in SKU
        {"variants": [{"sku": "OK-1", "name": "x", "priceVnd": -1}]},
        {
            "variants": [{"sku": "OK-1", "name": "x", "priceVnd": 5000, "compareAtVnd": 5000}]
        },  # not above the price
        {"variants": [{"sku": "OK-1", "name": "x", "priceVnd": 1.5}]},  # whole dong only
        {"shopeeUrl": "javascript:alert(1)"},
    ],
)
def test_invalid_input_is_rejected(signed_in, change):
    r = signed_in.post(f"{ADMIN}/products", json=product_payload(**change))
    assert r.status_code == 422, r.text


def test_sku_must_be_unique(signed_in):
    make_product(signed_in, variants=[{"sku": "DUP-1", "name": "x", "priceVnd": 1000}])
    r = signed_in.post(
        f"{ADMIN}/products", json=product_payload(variants=[{"sku": "dup-1", "name": "y", "priceVnd": 1}])
    )
    assert r.status_code == 409
    assert r.json()["error"] == {
        "code": "sku_taken",
        "message": "SKU already in use: DUP-1",
        "details": {"skus": ["DUP-1"]},
    }
    twice = product_payload(
        variants=[{"sku": "NEW-1", "name": "a", "priceVnd": 1}, {"sku": "new-1", "name": "b", "priceVnd": 2}]
    )
    assert signed_in.post(f"{ADMIN}/products", json=twice).json()["error"]["code"] == "duplicate_sku"


def test_unknown_category_is_rejected(signed_in):
    r = signed_in.post(f"{ADMIN}/products", json=product_payload(categoryId=9999))
    assert r.status_code == 422 and r.json()["error"]["code"] == "category_not_found"


# ------------------------------------------------------------------ publishing rules
def test_publish_lists_exactly_what_is_missing(signed_in):
    p = make_product(signed_in, ingredients="", storage="", ingredientsVerified=False)
    assert sorted(p["publishBlockers"]) == ["category", "ingredients", "ingredients_verified", "storage"]
    r = signed_in.post(f"{ADMIN}/products/{p['id']}/publish")
    assert r.status_code == 422
    error = r.json()["error"]
    assert error["code"] == "publish_requirements_not_met"
    assert sorted(error["details"]["missing"]) == [
        "category",
        "ingredients",
        "ingredients_verified",
        "storage",
    ]

    cat = make_category(signed_in)["id"]
    fixed = signed_in.patch(
        f"{ADMIN}/products/{p['id']}",
        json={"categoryId": cat, "ingredients": "Bột", "storage": "Khô ráo", "ingredientsVerified": True},
    ).json()
    assert fixed["publishBlockers"] == []
    assert signed_in.post(f"{ADMIN}/products/{p['id']}/publish").json()["status"] == "published"


def test_verified_flag_is_required_even_when_the_text_is_present(signed_in):
    p = make_product(
        signed_in, publish=False, ingredientsVerified=False, categoryId=make_category(signed_in)["id"]
    )
    assert p["publishBlockers"] == ["ingredients_verified"]


def test_a_published_product_cannot_be_edited_into_an_unsellable_state(signed_in, anon):
    p = make_product(signed_in, publish=True)
    r = signed_in.patch(f"{ADMIN}/products/{p['id']}", json={"ingredients": ""})
    assert r.status_code == 422
    assert r.json()["error"]["details"]["missing"] == ["ingredients"]
    after = signed_in.get(f"{ADMIN}/products/{p['id']}").json()
    assert after["ingredients"] == p["ingredients"] and after["status"] == "published"  # nothing was saved
    assert (
        signed_in.patch(f"{ADMIN}/products/{p['id']}", json={"description": "Mô tả mới"}).status_code == 200
    )
    assert anon.get(f"{PUBLIC}/products/{p['slug']}").json()["description"] == "Mô tả mới"


def test_hiding_keeps_the_data_and_can_be_undone(signed_in, anon):
    p = make_product(signed_in, publish=True)
    hidden = signed_in.post(f"{ADMIN}/products/{p['id']}/hide").json()
    assert hidden["status"] == "hidden"
    assert hidden["variants"] == p["variants"] and hidden["slug"] == p["slug"]
    assert anon.get(f"{PUBLIC}/products/{p['slug']}").status_code == 404
    assert signed_in.post(f"{ADMIN}/products/{p['id']}/publish").status_code == 200
    assert anon.get(f"{PUBLIC}/products/{p['slug']}").status_code == 200


def test_renaming_keeps_the_url(signed_in):
    p = make_product(signed_in, name="Tên cũ")
    r = signed_in.patch(f"{ADMIN}/products/{p['id']}", json={"name": "Tên mới hoàn toàn"}).json()
    assert r["name"] == "Tên mới hoàn toàn" and r["slug"] == p["slug"]


# ------------------------------------------------------------------ variants
def test_add_and_edit_variants(signed_in):
    p = make_product(signed_in)
    added = signed_in.post(
        f"{ADMIN}/products/{p['id']}/variants",
        json={"sku": "extra-1", "name": "Gói lớn", "priceVnd": 50000, "compareAtVnd": 60000},
    )
    assert added.status_code == 201 and len(added.json()["variants"]) == 2
    taken = signed_in.post(
        f"{ADMIN}/products/{p['id']}/variants", json={"sku": "EXTRA-1", "name": "x", "priceVnd": 1}
    )
    assert taken.status_code == 409

    vid = next(v["id"] for v in added.json()["variants"] if v["sku"] == "EXTRA-1")
    edited = signed_in.patch(f"{ADMIN}/variants/{vid}", json={"priceVnd": 55000, "sku": "HACK-1"}).json()
    row = next(v for v in edited["variants"] if v["id"] == vid)
    assert row["priceVnd"] == 55000 and row["sku"] == "EXTRA-1"  # the SKU cannot be changed
    cleared = signed_in.patch(f"{ADMIN}/variants/{vid}", json={"compareAtVnd": None}).json()
    assert next(v for v in cleared["variants"] if v["id"] == vid)["compareAtVnd"] is None
    bad = signed_in.patch(f"{ADMIN}/variants/{vid}", json={"compareAtVnd": 100})  # below the price
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "invalid_compare_at"
    assert signed_in.patch(f"{ADMIN}/variants/99999", json={"priceVnd": 1}).status_code == 404


def test_the_last_sellable_variant_of_a_published_product_cannot_be_deactivated(signed_in):
    p = make_product(signed_in, publish=True)
    only = p["variants"][0]["id"]
    r = signed_in.patch(f"{ADMIN}/variants/{only}", json={"isActive": False})
    assert r.status_code == 422 and r.json()["error"]["details"]["missing"] == ["active_variant"]
    assert signed_in.get(f"{ADMIN}/products/{p['id']}").json()["variants"][0]["isActive"] is True


# ------------------------------------------------------------------ listing and categories
def test_admin_list_filters_by_status_and_text(signed_in):
    cat = make_category(signed_in)["id"]
    make_product(signed_in, category_id=cat, publish=True, name="Bánh tráng")
    make_product(signed_in, name="Khô bò")
    all_rows = signed_in.get(f"{ADMIN}/products").json()
    assert all_rows["total"] == 2
    drafts = signed_in.get(f"{ADMIN}/products", params={"status": "draft"}).json()
    assert [r["name"] for r in drafts["items"]] == ["Khô bò"]
    assert [r["name"] for r in signed_in.get(f"{ADMIN}/products", params={"q": "banh"}).json()["items"]] == [
        "Bánh tráng"
    ]
    assert signed_in.get(f"{ADMIN}/products", params={"status": "bogus"}).status_code == 422


def test_categories_get_unique_slugs_and_renaming_updates_search(signed_in, anon):
    first = make_category(signed_in, "Đồ khô")
    second = make_category(signed_in, "Đồ khô")
    assert (first["slug"], second["slug"]) == ("do-kho", "do-kho-2")

    make_product(signed_in, category_id=first["id"], publish=True, name="Sản phẩm X")
    assert anon.get(f"{PUBLIC}/products", params={"q": "tran gian"}).json()["total"] == 0
    renamed = signed_in.patch(f"{ADMIN}/categories/{first['id']}", json={"name": "Trần gian"})
    assert renamed.status_code == 200 and renamed.json()["productCount"] == 1
    assert anon.get(f"{PUBLIC}/products", params={"q": "tran gian"}).json()["total"] == 1
    assert signed_in.patch(f"{ADMIN}/categories/9999", json={"name": "x"}).status_code == 404
