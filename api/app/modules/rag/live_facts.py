"""Price and stock for the products a question is about. Read from our own tables at answer time, never from the vector index."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.config import Settings
from app.modules.catalog.models import Product, Variant
from app.modules.chat.media import IMAGE_SKUS
from app.modules.chat.schemas import Product as ChatProduct
from app.modules.inventory import service as inventory


def facts_for(db: Session, settings: Settings, skus: list[str]) -> list[ChatProduct]:
    """One entry per active variant of every product that owns one of `skus`, in the shape the chat prompt already uses."""
    if not skus:
        return []
    products = db.scalars(
        select(Product)
        .join(Variant, Variant.product_id == Product.id)
        .where(Variant.sku.in_(skus), Product.status == "published")
        .options(selectinload(Product.variants))
        .distinct()
    ).all()
    variants = [v for p in products for v in p.variants if v.is_active]
    stock = inventory.stock_info(db, [v.id for v in variants], settings.stock_stale_minutes)
    out: list[ChatProduct] = []
    for p in products:
        for v in p.variants:
            if not v.is_active:
                continue
            info = stock.get(v.id)
            out.append(
                ChatProduct(
                    sku=v.sku,
                    name=p.name,
                    price=float(v.price_vnd),
                    currency="VND",
                    sales_description=f"Quy cách: {v.name}" if v.name else None,
                    # The same bundled photos the Odoo path shows, found by SKU; none for a SKU without one.
                    image_url=f"/products/{v.sku}.jpg" if v.sku in IMAGE_SKUS else None,
                    product_url=f"/products/{p.slug}",
                    # None = not tracked or not trusted: the prompt rules already say "null is unknown".
                    available=float(info.available)
                    if info and info.status != "unknown" and info.available is not None
                    else None,
                    stock_checked_at=info.updated_at if info and info.status != "unknown" else None,
                )
            )
    return out
