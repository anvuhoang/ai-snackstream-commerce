"""The back-office lists show the product's cover photo (products, stock and an order's items)."""

from __future__ import annotations

from .test_catalog_media import upload
from .test_inventory import INVENTORY, add, order_id, place, track
from .test_orders import ADMIN_ORDERS, sellable


def test_the_product_list_stock_list_and_order_show_the_cover_photo(signed_in, anon):
    p = sellable(signed_in)
    cover = upload(signed_in, p["id"], alt="Ảnh bìa").json()["images"][0]
    vid = track(signed_in, p, 5)
    add(anon, p, 1)
    assert place(anon).status_code == 201

    listed = signed_in.get("/api/admin/catalog/products").json()["items"][0]
    assert listed["image"]["url"] == cover["url"]

    stock = next(r for r in signed_in.get(INVENTORY).json()["items"] if r["variantId"] == vid)
    assert stock["image"]["url"] == cover["url"]

    order = signed_in.get(f"{ADMIN_ORDERS}/{order_id(signed_in)}").json()
    assert order["items"][0]["image"]["url"] == cover["url"]


def test_a_product_without_a_photo_has_a_null_image_everywhere(signed_in, anon):
    p = sellable(signed_in)
    vid = track(signed_in, p, 5)
    add(anon, p, 1)
    place(anon)
    assert signed_in.get("/api/admin/catalog/products").json()["items"][0]["image"] is None
    stock = next(r for r in signed_in.get(INVENTORY).json()["items"] if r["variantId"] == vid)
    assert stock["image"] is None
    assert signed_in.get(f"{ADMIN_ORDERS}/{order_id(signed_in)}").json()["items"][0]["image"] is None


def test_the_customer_order_view_does_not_carry_photos(signed_in, anon):
    p = sellable(signed_in)
    upload(signed_in, p["id"])
    add(anon, p, 1)
    code = place(anon).json()["code"]
    r = anon.post("/api/orders/lookup", json={"code": code, "phone": "0901234567"})
    assert r.status_code == 200 and r.json()["items"][0]["image"] is None
