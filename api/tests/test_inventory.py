"""Own-database stock: tracking, reserving for orders, shipping, returning, and the back-office adjustments."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.modules.orders import service as orders_service

from .test_orders import ADMIN_ORDERS, CART, add, place, sellable

INVENTORY = "/api/admin/inventory"


def track(admin: TestClient, product: dict, qty: int) -> int:
    """Start tracking the product's variant with `qty` units. Returns the variant id."""
    vid = product["variants"][0]["id"]
    r = admin.post(f"{INVENTORY}/{vid}/adjust", json={"kind": "receive", "delta": qty, "note": "test"})
    assert r.status_code == 200, r.text
    return vid


def row(admin: TestClient, variant_id: int) -> dict:
    items = admin.get(INVENTORY, params={"pageSize": 100}).json()["items"]
    return next(i for i in items if i["variantId"] == variant_id)


def order_id(admin: TestClient) -> int:
    return admin.get(ADMIN_ORDERS).json()["items"][0]["id"]


def status(admin: TestClient, oid: int, to: str):
    return admin.post(f"{ADMIN_ORDERS}/{oid}/status", json={"to": to, "note": ""})


# ================================================================== tracking and adjusting
def test_an_untracked_variant_is_always_sellable(signed_in, anon):
    p = sellable(signed_in)
    vid = p["variants"][0]["id"]
    assert row(signed_in, vid)["tracked"] is False
    add(anon, p, 3)
    assert place(anon).status_code in (200, 201)


def test_receiving_goods_starts_tracking_and_logs_a_movement(signed_in):
    p = sellable(signed_in)
    vid = track(signed_in, p, 20)
    r = row(signed_in, vid)
    assert (r["tracked"], r["onHand"], r["reserved"], r["available"]) == (True, 20, 0, 20)
    log = signed_in.get(f"{INVENTORY}/{vid}/movements").json()
    assert log[0]["kind"] == "receive" and log[0]["deltaOnHand"] == 20 and log[0]["actorEmail"]


def test_a_correction_can_lower_the_count_but_not_below_what_orders_hold(signed_in, anon):
    p = sellable(signed_in)
    vid = track(signed_in, p, 10)
    add(anon, p, 4)
    assert place(anon).status_code in (200, 201)  # 4 reserved
    ok = signed_in.post(f"{INVENTORY}/{vid}/adjust", json={"kind": "adjust", "delta": -6})
    assert ok.status_code == 200 and ok.json()["onHand"] == 4
    refused = signed_in.post(f"{INVENTORY}/{vid}/adjust", json={"kind": "adjust", "delta": -1})
    assert refused.status_code == 409 and refused.json()["error"]["code"] == "below_reserved"
    assert row(signed_in, vid)["onHand"] == 4


def test_the_change_must_make_sense(signed_in):
    vid = track(signed_in, sellable(signed_in), 5)
    zero = signed_in.post(f"{INVENTORY}/{vid}/adjust", json={"kind": "adjust", "delta": 0})
    negative_receipt = signed_in.post(f"{INVENTORY}/{vid}/adjust", json={"kind": "receive", "delta": -2})
    assert zero.status_code == 422 and negative_receipt.status_code == 422
    assert (
        signed_in.post(f"{INVENTORY}/999999/adjust", json={"kind": "receive", "delta": 1}).status_code == 404
    )


def test_the_list_can_filter_by_state(signed_in, anon):
    plenty, few, none_left = sellable(signed_in), sellable(signed_in), sellable(signed_in)
    track(signed_in, plenty, 50)
    track(signed_in, few, 3)
    gone = track(signed_in, none_left, 1)
    add(anon, none_left, 1)
    place(anon)
    assert row(signed_in, gone)["available"] == 0

    def ids(state: str) -> set[int]:
        return {i["variantId"] for i in signed_in.get(INVENTORY, params={"state": state}).json()["items"]}

    assert few["variants"][0]["id"] in ids("low") and plenty["variants"][0]["id"] not in ids("low")
    assert gone in ids("out")


def test_only_signed_in_users_see_or_change_stock(anon, staff, signed_in):
    vid = track(signed_in, sellable(signed_in), 5)
    assert anon.get(INVENTORY).status_code == 401
    assert anon.post(f"{INVENTORY}/{vid}/adjust", json={"kind": "receive", "delta": 1}).status_code == 401
    assert staff.get(INVENTORY).status_code == 200
    assert staff.post(f"{INVENTORY}/{vid}/adjust", json={"kind": "receive", "delta": 1}).status_code == 200


# ================================================================== orders and stock
def test_placing_an_order_reserves_and_cancelling_gives_it_back(signed_in, anon):
    p = sellable(signed_in)
    vid = track(signed_in, p, 10)
    add(anon, p, 3)
    assert place(anon).status_code in (200, 201)
    assert (
        row(signed_in, vid)["onHand"],
        row(signed_in, vid)["reserved"],
        row(signed_in, vid)["available"],
    ) == (10, 3, 7)
    assert status(signed_in, order_id(signed_in), "cancelled").status_code == 200
    assert (row(signed_in, vid)["onHand"], row(signed_in, vid)["reserved"]) == (10, 0)


def test_the_last_unit_goes_to_one_customer_only(signed_in, anon):
    p = sellable(signed_in)
    vid = track(signed_in, p, 1)
    other = TestClient(anon.app)
    add(anon, p, 1)
    add(other, p, 1)
    first, second = place(anon), place(other)
    assert first.status_code in (200, 201)
    # The cart already shows the line as gone, so checkout refuses it before it even tries to reserve.
    assert second.status_code == 409 and second.json()["error"]["code"] == "item_unavailable"
    assert signed_in.get(ADMIN_ORDERS).json()["total"] == 1  # the loser left no order behind
    assert row(signed_in, vid)["reserved"] == 1
    line = other.get(CART).json()["items"][0]  # the loser keeps the line, marked gone, to remove or fix
    assert line["available"] is False


def test_the_reservation_itself_refuses_an_oversell_even_if_the_cart_check_was_stale(
    signed_in, anon, monkeypatch
):
    """Two checkouts can pass the cart check at the same moment; the conditional update is what stops the second."""
    p = sellable(signed_in)
    vid = track(signed_in, p, 1)
    other = TestClient(anon.app)
    add(anon, p, 1)
    add(other, p, 1)
    assert place(anon).status_code == 201
    monkeypatch.setattr(orders_service.inventory, "available_map", lambda db, ids: {})  # a stale view
    r = place(other)
    assert r.status_code == 409 and r.json()["error"]["code"] == "out_of_stock"
    assert r.json()["error"]["details"]["skus"] == [p["variants"][0]["sku"]]
    assert signed_in.get(ADMIN_ORDERS).json()["total"] == 1
    assert row(signed_in, vid)["reserved"] == 1


def test_asking_for_more_than_is_left_is_refused_whole(signed_in, anon):
    scarce, plenty = sellable(signed_in), sellable(signed_in)
    scarce_id = track(signed_in, scarce, 2)
    plenty_id = track(signed_in, plenty, 50)
    add(anon, plenty, 5)
    add(anon, scarce, 3)
    r = place(anon)
    assert r.status_code == 409 and r.json()["error"]["code"] in ("out_of_stock", "item_unavailable")
    assert row(signed_in, plenty_id)["reserved"] == 0 and row(signed_in, scarce_id)["reserved"] == 0


def test_the_cart_marks_a_line_unavailable_when_stock_runs_short(signed_in, anon):
    p = sellable(signed_in)
    track(signed_in, p, 2)
    add(anon, p, 3)
    line = anon.get(CART).json()["items"][0]
    assert line["available"] is False


def test_shipping_takes_units_out_and_cancelling_after_that_brings_them_back(signed_in, anon):
    p = sellable(signed_in)
    vid = track(signed_in, p, 10)
    add(anon, p, 4)
    place(anon)
    oid = order_id(signed_in)
    assert status(signed_in, oid, "confirmed").status_code == 200
    assert status(signed_in, oid, "shipping").status_code == 200
    assert signed_in.get(f"{ADMIN_ORDERS}/{oid}").json()["status"] == "shipping"
    r = row(signed_in, vid)
    assert (r["onHand"], r["reserved"]) == (6, 0)  # 4 left the stock room
    assert status(signed_in, oid, "cancelled").status_code == 200  # the parcel came back
    r = row(signed_in, vid)
    assert (r["onHand"], r["reserved"]) == (10, 0)
    kinds = [m["kind"] for m in signed_in.get(f"{INVENTORY}/{vid}/movements").json()]
    assert kinds == ["return", "ship", "reserve", "receive"]


def test_completing_an_order_leaves_the_stock_as_shipped(signed_in, anon):
    p = sellable(signed_in)
    vid = track(signed_in, p, 10)
    add(anon, p, 2)
    place(anon)
    oid = order_id(signed_in)
    for to in ("confirmed", "shipping", "completed"):
        assert status(signed_in, oid, to).status_code == 200
    r = row(signed_in, vid)
    assert (r["onHand"], r["reserved"]) == (8, 0)


def test_an_untracked_item_in_an_order_changes_no_stock(signed_in, anon):
    tracked, loose = sellable(signed_in), sellable(signed_in)
    tracked_id = track(signed_in, tracked, 10)
    add(anon, tracked, 1)
    add(anon, loose, 2)
    assert place(anon).status_code in (200, 201)
    assert row(signed_in, tracked_id)["reserved"] == 1
    assert row(signed_in, loose["variants"][0]["id"])["tracked"] is False
    assert status(signed_in, order_id(signed_in), "cancelled").status_code == 200
    assert row(signed_in, tracked_id)["reserved"] == 0
