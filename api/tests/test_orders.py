"""Cart, checkout, look-up and back-office order handling (cash on delivery)."""

from __future__ import annotations

import uuid
from itertools import count

import pytest
from fastapi.testclient import TestClient

from app.modules.orders import stock

from .helpers import make_product

CART = "/api/cart"
ORDERS = "/api/orders"
ADMIN_ORDERS = "/api/admin/orders"
PHONE = "0901234567"
_n = count(1)


def body(**overrides) -> dict:
    payload = {
        "customer": {"name": "Nguyễn Văn An", "phone": PHONE},
        "shipping": {
            "address": "12 Lê Lợi",
            "ward": "Bến Nghé",
            "district": "Quận 1",
            "province": "TP. Hồ Chí Minh",
        },
        "note": "Gọi trước khi giao",
        "paymentMethod": "cod",
    }
    payload.update(overrides)
    return payload


def key() -> str:
    return uuid.uuid4().hex


def sellable(admin: TestClient, price: int = 55_000, **kw) -> dict:
    """A published product with one variant at `price`."""
    n = next(_n)
    return make_product(
        admin, publish=True, variants=[{"sku": f"ORD-{n:03d}", "name": "Gói 250g", "priceVnd": price}], **kw
    )


def add(visitor: TestClient, product: dict, qty: int = 1):
    return visitor.post(f"{CART}/items", json={"variantId": product["variants"][0]["id"], "qty": qty})


def place(visitor: TestClient, idem: str | None = None, **overrides):
    return visitor.post(ORDERS, json=body(**overrides), headers={"Idempotency-Key": idem or key()})


@pytest.fixture()
def counted_stock(monkeypatch):
    """Counts how often stock is reserved and released."""
    calls = {"reserve": 0, "release": 0}
    monkeypatch.setattr(
        stock, "reserve", lambda db, order: calls.__setitem__("reserve", calls["reserve"] + 1)
    )
    monkeypatch.setattr(
        stock, "release", lambda db, order: calls.__setitem__("release", calls["release"] + 1)
    )
    return calls


# ================================================================== cart
def test_an_empty_cart_needs_no_cookie_and_costs_nothing(anon):
    cart = anon.get(CART).json()
    assert (
        cart["items"] == []
        and cart["itemCount"] == 0
        and cart["totalVnd"] == 0
        and cart["shippingFeeVnd"] == 0
    )


def test_adding_creates_the_cart_and_adding_again_raises_the_quantity(signed_in, anon):
    p = sellable(signed_in, 55_000)
    first = add(anon, p, 2)
    assert first.status_code == 200 and "ss_cart" in first.cookies
    cart = add(anon, p, 3).json()
    assert cart["itemCount"] == 5 and len(cart["items"]) == 1
    line = cart["items"][0]
    assert (line["qty"], line["unitPriceVnd"], line["lineTotalVnd"]) == (5, 55_000, 275_000)
    assert anon.get(CART).json()["itemCount"] == 5  # the cookie keeps the cart between requests


def test_the_quantity_is_capped_at_99(signed_in, anon):
    p = sellable(signed_in)
    add(anon, p, 90)
    assert add(anon, p, 50).json()["items"][0]["qty"] == 99


def test_prices_come_from_the_catalog_every_time(signed_in, anon):
    p = sellable(signed_in, 50_000)
    add(anon, p, 2)
    r = signed_in.patch(f"/api/admin/catalog/variants/{p['variants'][0]['id']}", json={"priceVnd": 60_000})
    assert r.status_code == 200, r.text
    assert anon.get(CART).json()["subtotalVnd"] == 120_000


def test_a_draft_or_hidden_product_cannot_be_added(signed_in, anon):
    draft = make_product(signed_in)
    assert add(anon, draft).status_code == 404
    live = sellable(signed_in)
    signed_in.post(f"/api/admin/catalog/products/{live['id']}/hide")
    r = add(anon, live)
    assert r.status_code == 404 and r.json()["error"]["code"] == "variant_unavailable"


def test_a_product_hidden_after_adding_is_flagged_and_not_charged(signed_in, anon):
    keep, drop = sellable(signed_in, 40_000), sellable(signed_in, 70_000)
    add(anon, keep)
    add(anon, drop)
    signed_in.post(f"/api/admin/catalog/products/{drop['id']}/hide")
    cart = anon.get(CART).json()
    assert cart["hasUnavailable"] is True
    assert cart["subtotalVnd"] == 40_000 and cart["itemCount"] == 1
    assert sorted(line["available"] for line in cart["items"]) == [False, True]


def test_changing_and_removing_lines(signed_in, anon):
    p = sellable(signed_in, 30_000)
    add(anon, p, 1)
    vid = p["variants"][0]["id"]
    assert anon.patch(f"{CART}/items/{vid}", json={"qty": 4}).json()["itemCount"] == 4
    assert anon.patch(f"{CART}/items/{vid}", json={"qty": 0}).status_code == 422
    assert anon.patch(f"{CART}/items/{vid}", json={"qty": 100}).status_code == 422
    assert anon.patch(f"{CART}/items/999999", json={"qty": 1}).status_code == 404
    assert anon.delete(f"{CART}/items/{vid}").json()["items"] == []


def test_carts_belong_to_the_visitor_who_made_them(signed_in, anon, client):
    p = sellable(signed_in)
    add(anon, p, 2)
    other = TestClient(client.app)
    assert other.get(CART).json()["itemCount"] == 0


def test_shipping_is_flat_and_free_from_the_threshold(signed_in, anon):
    p = sellable(signed_in, 100_000)
    cart = add(anon, p, 2).json()  # 200.000
    assert (cart["shippingFeeVnd"], cart["totalVnd"], cart["freeShipRemainingVnd"]) == (
        30_000,
        230_000,
        100_000,
    )
    cart = add(anon, p, 1).json()  # 300.000: exactly the threshold
    assert (cart["shippingFeeVnd"], cart["totalVnd"], cart["freeShipRemainingVnd"]) == (0, 300_000, 0)


def test_shop_config_lists_cash_on_delivery_only_without_gateway_keys(anon):
    cfg = anon.get("/api/shop/config").json()
    assert (
        cfg["paymentMethods"] == ["cod"]
        and cfg["shippingFeeVnd"] == 30_000
        and cfg["freeShipFromVnd"] == 300_000
    )


# ================================================================== checkout
def test_checkout_creates_an_order_from_the_cart(signed_in, anon, counted_stock):
    a, b = sellable(signed_in, 55_000), sellable(signed_in, 15_000)
    add(anon, a, 2)
    add(anon, b, 3)
    r = place(anon)
    assert r.status_code == 201, r.text
    o = r.json()
    assert o["status"] == "new" and o["paymentMethod"] == "cod" and o["paymentUrl"] is None
    assert o["subtotalVnd"] == 155_000 and o["shippingFeeVnd"] == 30_000 and o["totalVnd"] == 185_000
    assert sorted((i["qty"], i["unitPriceVnd"], i["lineTotalVnd"]) for i in o["items"]) == [
        (2, 55_000, 110_000),
        (3, 15_000, 45_000),
    ]
    assert o["payments"][0]["provider"] == "cod" and o["payments"][0]["status"] == "pending"
    assert o["history"][0]["toStatus"] == "new" and o["history"][0]["fromStatus"] is None
    assert o["customerPhone"] == "09******67"  # masked in anything a customer can see
    assert o["code"].startswith("SS-") and len(o["code"]) == 12
    assert anon.get(CART).json()["items"] == []  # the cart is emptied
    assert counted_stock == {"reserve": 1, "release": 0}


def test_the_same_checkout_twice_creates_one_order(signed_in, anon, counted_stock):
    add(anon, sellable(signed_in), 1)
    idem = key()
    first, second = place(anon, idem), place(anon, idem)
    assert first.status_code == 201 and second.status_code == 201
    assert first.json()["code"] == second.json()["code"]
    assert signed_in.get(ADMIN_ORDERS).json()["total"] == 1
    assert counted_stock["reserve"] == 1  # stock is held once


def test_a_key_used_for_a_different_request_is_rejected(signed_in, anon):
    add(anon, sellable(signed_in), 1)
    idem = key()
    assert place(anon, idem).status_code == 201
    add(anon, sellable(signed_in), 1)
    other = body()
    other["customer"]["name"] = "Someone Else"
    r = anon.post(ORDERS, json=other, headers={"Idempotency-Key": idem})
    assert r.status_code == 409 and r.json()["error"]["code"] == "idempotency_key_reused"


def test_checkout_needs_an_idempotency_key_and_a_cart(signed_in, anon):
    add(anon, sellable(signed_in))
    assert anon.post(ORDERS, json=body()).status_code == 422
    empty = TestClient(anon.app)
    r = place(empty)
    assert r.status_code == 409 and r.json()["error"]["code"] == "cart_empty"


def test_the_order_keeps_its_prices_when_the_catalog_changes(signed_in, anon):
    p = sellable(signed_in, 50_000)
    add(anon, p, 2)
    code = place(anon).json()["code"]
    signed_in.patch(f"/api/admin/catalog/variants/{p['variants'][0]['id']}", json={"priceVnd": 99_000})
    signed_in.post(f"/api/admin/catalog/products/{p['id']}/hide")
    o = anon.post(f"{ORDERS}/lookup", json={"code": code, "phone": PHONE}).json()
    assert o["subtotalVnd"] == 100_000 and o["items"][0]["unitPriceVnd"] == 50_000


def test_unavailable_items_block_checkout(signed_in, anon):
    keep, drop = sellable(signed_in), sellable(signed_in)
    add(anon, keep)
    add(anon, drop)
    signed_in.post(f"/api/admin/catalog/products/{drop['id']}/hide")
    r = place(anon)
    assert r.status_code == 409 and r.json()["error"]["code"] == "item_unavailable"
    assert r.json()["error"]["details"]["skus"] == [drop["variants"][0]["sku"]]
    assert signed_in.get(ADMIN_ORDERS).json()["total"] == 0


def test_online_payment_is_refused_without_gateway_keys(signed_in, anon):
    add(anon, sellable(signed_in))
    r = place(anon, paymentMethod="vnpay")
    assert r.status_code == 422 and r.json()["error"]["code"] == "payment_method_unavailable"


@pytest.mark.parametrize("phone", ["", "12345", "abcdefghij", "0901234"])
def test_a_bad_phone_number_is_rejected(signed_in, anon, phone):
    add(anon, sellable(signed_in))
    payload = body()
    payload["customer"]["phone"] = phone
    assert anon.post(ORDERS, json=payload, headers={"Idempotency-Key": key()}).status_code == 422


def test_plus_84_phone_numbers_are_stored_with_a_leading_zero(signed_in, anon):
    add(anon, sellable(signed_in))
    payload = body()
    payload["customer"]["phone"] = "+84 901 234 567"
    r = anon.post(ORDERS, json=payload, headers={"Idempotency-Key": key()})
    assert r.status_code == 201
    assert signed_in.get(ADMIN_ORDERS).json()["items"][0]["customerPhone"] == PHONE


# ================================================================== look-up
def test_lookup_needs_the_code_and_the_phone(signed_in, anon):
    add(anon, sellable(signed_in))
    code = place(anon).json()["code"]
    stranger = TestClient(anon.app)
    ok = stranger.post(f"{ORDERS}/lookup", json={"code": code.lower(), "phone": "090 123 4567"})
    assert ok.status_code == 200 and ok.json()["code"] == code and ok.json()["customerPhone"] == "09******67"
    wrong_phone = stranger.post(f"{ORDERS}/lookup", json={"code": code, "phone": "0911111111"})
    wrong_code = stranger.post(f"{ORDERS}/lookup", json={"code": "SS-AAAA-BBBB", "phone": PHONE})
    assert wrong_phone.status_code == wrong_code.status_code == 404
    assert wrong_phone.json() == wrong_code.json()  # the same answer, so neither can be probed


def test_lookup_slows_down_guessing(signed_in, anon):
    for _ in range(10):
        assert anon.post(f"{ORDERS}/lookup", json={"code": "SS-AAAA-BBBB", "phone": PHONE}).status_code == 404
    r = anon.post(f"{ORDERS}/lookup", json={"code": "SS-AAAA-BBBB", "phone": PHONE})
    assert r.status_code == 429 and r.json()["error"]["code"] == "too_many_attempts"


def test_order_codes_are_not_a_counter(signed_in, anon):
    codes = set()
    for _ in range(3):
        add(anon, sellable(signed_in))
        codes.add(place(anon).json()["code"])
    assert len(codes) == 3
    assert all(c[:3] == "SS-" for c in codes)


# ================================================================== back office
def one_order(signed_in: TestClient, anon: TestClient, price: int = 55_000) -> dict:
    add(anon, sellable(signed_in, price))
    place(anon)
    return signed_in.get(ADMIN_ORDERS).json()["items"][0]


def go(admin: TestClient, order_id: int, to: str, note: str = ""):
    return admin.post(f"{ADMIN_ORDERS}/{order_id}/status", json={"to": to, "note": note})


def test_the_order_endpoints_need_a_signed_in_user(anon, client):
    assert anon.get(ADMIN_ORDERS).status_code == 401
    assert anon.get(f"{ADMIN_ORDERS}/1").status_code == 401
    assert anon.post(f"{ADMIN_ORDERS}/1/status", json={"to": "confirmed"}).status_code == 401


def test_changing_status_needs_the_csrf_token(signed_in, anon):
    row = one_order(signed_in, anon)
    signed_in.headers.pop("X-CSRF-Token")
    assert go(signed_in, row["id"], "confirmed").status_code == 403


def test_an_order_moves_through_its_whole_life(signed_in, anon):
    row = one_order(signed_in, anon)
    for step in ("confirmed", "shipping", "completed"):
        r = go(signed_in, row["id"], step, f"to {step}")
        assert r.status_code == 200, r.text
        assert r.json()["status"] == step
    o = signed_in.get(f"{ADMIN_ORDERS}/{row['id']}").json()
    assert [h["toStatus"] for h in o["history"]] == ["new", "confirmed", "shipping", "completed"]
    assert o["history"][1]["actorEmail"] == "admin@example.com" and o["nextStatuses"] == []
    # cash is collected on the doorstep, so a completed COD order is paid
    assert o["payments"][0]["status"] == "paid" and o["payments"][0]["paidAt"]
    assert o["customerPhone"] == PHONE  # the back office sees the whole number


@pytest.mark.parametrize(
    ("start", "to"), [("new", "shipping"), ("new", "completed"), ("confirmed", "completed")]
)
def test_steps_cannot_be_skipped(signed_in, anon, start, to):
    row = one_order(signed_in, anon)
    if start == "confirmed":
        go(signed_in, row["id"], "confirmed")
    r = go(signed_in, row["id"], to)
    assert r.status_code == 409 and r.json()["error"]["code"] == "invalid_transition"


def test_cancelling_gives_the_stock_back_exactly_once(signed_in, anon, counted_stock):
    row = one_order(signed_in, anon)
    assert go(signed_in, row["id"], "cancelled", "customer asked").status_code == 200
    assert counted_stock == {"reserve": 1, "release": 1}
    again = go(signed_in, row["id"], "cancelled")
    assert again.status_code == 409
    assert go(signed_in, row["id"], "confirmed").status_code == 409  # a cancelled order stays cancelled
    assert counted_stock["release"] == 1
    o = signed_in.get(f"{ADMIN_ORDERS}/{row['id']}").json()
    assert o["status"] == "cancelled" and o["payments"][0]["status"] == "failed" and o["nextStatuses"] == []


def test_staff_can_process_orders(signed_in, anon, staff):
    row = one_order(signed_in, anon)
    assert staff.get(ADMIN_ORDERS).status_code == 200
    assert go(staff, row["id"], "confirmed").status_code == 200


def test_the_list_filters_by_status_and_search(signed_in, anon):
    a = one_order(signed_in, anon)
    add(anon, sellable(signed_in))
    anon.post(
        ORDERS,
        json=body(customer={"name": "Trần Thị Bình", "phone": "0988777666"}),
        headers={"Idempotency-Key": key()},
    )
    go(signed_in, a["id"], "confirmed")
    assert signed_in.get(ADMIN_ORDERS, params={"status": "confirmed"}).json()["total"] == 1
    assert signed_in.get(ADMIN_ORDERS, params={"status": "new"}).json()["total"] == 1
    assert signed_in.get(ADMIN_ORDERS, params={"q": "0988777666"}).json()["total"] == 1
    assert signed_in.get(ADMIN_ORDERS, params={"q": a["code"].lower()}).json()["items"][0]["id"] == a["id"]
    assert signed_in.get(ADMIN_ORDERS).json()["total"] == 2


def test_an_unknown_order_is_a_404(signed_in):
    r = signed_in.get(f"{ADMIN_ORDERS}/424242")
    assert r.status_code == 404 and r.json()["error"]["code"] == "order_not_found"
