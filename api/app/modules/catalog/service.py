"""Public read-only catalog adapter over the existing Odoo product reader."""

from app.core.config import Settings
from app.core.errors import AppError
from app.modules.chat.service import read_products


def list_products(settings: Settings):
    return read_products(settings)


def get_product(settings: Settings, sku: str):
    for product in list_products(settings):
        if product.sku == sku:
            return product
    raise AppError(404, "product_not_found", "Product not found")
