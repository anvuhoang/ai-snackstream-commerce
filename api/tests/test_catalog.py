from pathlib import Path
from unittest.mock import patch

from app.core.errors import AppError
from app.modules.catalog import service
from app.modules.chat.media import IMAGE_SKUS
from app.modules.chat.schemas import Product


def test_public_catalog_returns_exact_sku_and_missing_is_404(client):
    item = Product(
        sku="DA-CA-100",
        name="Da cá",
        price=39000,
        currency="VND",
        image_url="/products/DA-CA-100.jpg",
        product_url="/products/DA-CA-100",
    )
    with patch.object(service, "read_products", return_value=[item]):
        listing = client.get("/api/catalog/products")
        assert listing.status_code == 200
        assert listing.json()[0]["image_url"] == "/products/DA-CA-100.jpg"
        detail = client.get("/api/catalog/products/DA-CA-100")
        assert detail.json()["sku"] == "DA-CA-100"
        assert client.get("/api/catalog/products/DA-CA-10").status_code == 404


def test_catalog_odoo_outage_is_not_empty_or_not_found(client):
    with patch.object(service, "read_products", side_effect=AppError(503, "odoo_unavailable", "Unavailable")):
        assert client.get("/api/catalog/products").status_code == 503
        assert client.get("/api/catalog/products/DA-CA-100").status_code == 503


def test_every_image_mapping_has_a_real_file():
    assets = Path(__file__).resolve().parents[2] / "web" / "public" / "products"
    assert len(IMAGE_SKUS) == 30
    assert all((assets / f"{sku}.jpg").is_file() for sku in IMAGE_SKUS)
