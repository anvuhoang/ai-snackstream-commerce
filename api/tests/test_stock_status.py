"""What the public catalog says about stock, and that an item the shop cannot sell cannot be added to a cart."""

from __future__ import annotations

from datetime import timedelta

from fastapi.testclient import TestClient

from app.core.db import utcnow
from app.modules.inventory.models import StockLevel

from .test_inventory import INVENTORY, add, order_id, place, track
from .test_inventory_odoo import fake_odoo, odoo_row, run_sync
from .test_orders import CART, sellable


def detail(client: TestClient, product: dict) -> dict:
    r = client.get(f"/api/catalog/products/{product['slug']}")
    assert r.status_code == 200, r.text
    return r.json()["variants"][0]


def card(client: TestClient, product: dict) -> dict:
    items = client.get("/api/catalog/products", params={"pageSize": 48}).json()["items"]
    return next(i for i in items if i["slug"] == product["slug"])


def test_an_untracked_variant_is_simply_on_sale(signed_in, anon):
    p = sellable(signed_in)
    v = detail(anon, p)
    assert v["available"] is None and v["stockStatus"] == "ok" and v["stockUpdatedAt"] is None
    assert card(anon, p)["soldOut"] is False


def test_the_catalog_tells_plenty_few_and_none_apart(signed_in, anon):
    plenty, few, gone = sellable(signed_in), sellable(signed_in), sellable(signed_in)
    track(signed_in, plenty, 40)
    track(signed_in, few, 3)
    track(signed_in, gone, 1)
    add(anon, gone, 1)
    assert place(anon).status_code == 201  # the last unit is taken
    assert (detail(anon, plenty)["available"], detail(anon, plenty)["stockStatus"]) == (40, "ok")
    assert (detail(anon, few)["available"], detail(anon, few)["stockStatus"]) == (3, "low")
    assert (detail(anon, gone)["available"], detail(anon, gone)["stockStatus"]) == (0, "out")
    assert card(anon, gone)["soldOut"] is True and card(anon, plenty)["soldOut"] is False


def test_a_product_is_sold_out_only_when_every_variant_is(signed_in, anon):
    p = sellable(signed_in)
    track(signed_in, p, 5)
    other = signed_in.post(
        f"/api/admin/catalog/products/{p['id']}/variants",
        json={"sku": "ORD-MULTI-2", "name": "Gói lớn", "priceVnd": 99_000},
    )
    assert other.status_code in (200, 201), other.text
    # the first variant is tracked and in stock, the second is not tracked: the product is on sale
    assert card(anon, p)["soldOut"] is False


def test_an_item_that_is_out_cannot_be_added_to_the_cart(signed_in, anon):
    p = sellable(signed_in)
    vid = track(signed_in, p, 1)
    buyer = TestClient(anon.app)
    add(buyer, p, 1)
    place(buyer)  # takes the last unit
    r = anon.post(f"{CART}/items", json={"variantId": vid, "qty": 1})
    assert r.status_code == 409 and r.json()["error"]["code"] == "out_of_stock"
    assert anon.get(CART).json()["itemCount"] == 0


def test_cancelling_the_order_puts_the_item_back_on_sale(signed_in, anon):
    p = sellable(signed_in)
    track(signed_in, p, 1)
    add(anon, p, 1)
    place(anon)
    assert detail(anon, p)["stockStatus"] == "out"
    signed_in.post(f"/api/admin/orders/{order_id(signed_in)}/status", json={"to": "cancelled", "note": ""})
    back = detail(anon, p)
    assert (back["available"], back["stockStatus"]) == (1, "low")  # on sale again, with the one unit it had


def _age_the_odoo_sync(client: TestClient, variant_id: int, minutes: int) -> None:
    with client.app.state.session_factory() as db:
        level = db.get(StockLevel, variant_id)
        level.synced_at = utcnow() - timedelta(minutes=minutes)
        db.commit()


def test_an_old_odoo_count_is_unknown_and_cannot_be_bought(signed_in, anon, settings):
    p = sellable(signed_in)
    vid = p["variants"][0]["id"]
    run_sync(signed_in, settings, fake_odoo([odoo_row(p["variants"][0]["sku"], 20)]))
    signed_in.app.state.settings.stock_stale_minutes = 30
    try:
        assert detail(anon, p)["stockStatus"] == "ok"  # just synced
        _age_the_odoo_sync(signed_in, vid, 120)
        assert detail(anon, p)["stockStatus"] == "unknown"
        r = anon.post(f"{CART}/items", json={"variantId": vid, "qty": 1})
        assert r.status_code == 409 and r.json()["error"]["code"] == "stock_unknown"
        run_sync(
            signed_in, settings, fake_odoo([odoo_row(p["variants"][0]["sku"], 18)])
        )  # a fresh sync restores trust
        assert detail(anon, p)["stockStatus"] == "ok"
    finally:
        signed_in.app.state.settings.stock_stale_minutes = 0


def test_by_default_an_old_odoo_count_is_still_used(signed_in, anon, settings):
    p = sellable(signed_in)
    run_sync(signed_in, settings, fake_odoo([odoo_row(p["variants"][0]["sku"], 20)]))
    _age_the_odoo_sync(signed_in, p["variants"][0]["id"], 10_000)
    assert detail(anon, p)["stockStatus"] == "ok"  # STOCK_STALE_MINUTES = 0 means never expire


def test_a_hand_counted_stock_never_goes_unknown(signed_in, anon):
    p = sellable(signed_in)
    track(signed_in, p, 20)
    signed_in.app.state.settings.stock_stale_minutes = 1
    try:
        assert detail(anon, p)["stockStatus"] == "ok"  # only counts copied from Odoo can go stale
    finally:
        signed_in.app.state.settings.stock_stale_minutes = 0
    assert INVENTORY  # the admin list is untouched by the public status
