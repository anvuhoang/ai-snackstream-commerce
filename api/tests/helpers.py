"""Small builders so each test states only what it cares about."""

from __future__ import annotations

from itertools import count

from fastapi.testclient import TestClient

ADMIN = "/api/admin/catalog"
PUBLIC = "/api/catalog"
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64  # only the header is inspected

_n = count(1)


def make_category(admin: TestClient, name: str = "Bánh tráng") -> dict:
    r = admin.post(f"{ADMIN}/categories", json={"name": name})
    assert r.status_code == 201, r.text
    return r.json()


def product_payload(**overrides) -> dict:
    n = next(_n)
    payload = {
        "name": f"Sản phẩm {n}",
        "description": "Mô tả ngắn.",
        "ingredients": "Bột, muối, ớt.",
        "storage": "Nơi khô ráo, thoáng mát.",
        "ingredientsVerified": True,
        "variants": [{"sku": f"SKU-{n:03d}", "name": "Gói 100g", "priceVnd": 20000}],
    }
    payload.update(overrides)
    return payload


def make_product(
    admin: TestClient, *, category_id: int | None = None, publish: bool = False, **overrides
) -> dict:
    """Create a draft (or, with publish=True, a published) product through the admin API."""
    if category_id is None and publish:
        category_id = make_category(admin, f"Danh mục {next(_n)}")["id"]
    body = product_payload(**overrides)
    if category_id is not None:
        body["categoryId"] = category_id
    r = admin.post(f"{ADMIN}/products", json=body)
    assert r.status_code == 201, r.text
    product = r.json()
    if publish:
        r = admin.post(f"{ADMIN}/products/{product['id']}/publish")
        assert r.status_code == 200, r.text
        product = r.json()
    return product
