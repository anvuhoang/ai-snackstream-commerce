"""Live reads the same published catalog as the shop; narration input is not answer evidence."""

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.db import make_engine, make_session_factory
from app.core.errors import AppError
from app.modules.catalog import service
from app.modules.catalog.models import Product, Variant

from .schemas import LiveAnswerProduct


def product_for_sku(db: Session, sku: str) -> Product:
    slug = db.scalar(
        select(Product.slug).join(Variant).where(Variant.sku == sku, Variant.is_active.is_(True))
    )
    if slug is None:
        raise AppError(404, "product_not_found", "No published product for this SKU.")
    product = service.get_public_product(db, slug)
    if not any(v.sku == sku and v.is_active for v in product.variants):
        raise AppError(404, "product_not_found", "SKU is no longer active.")
    return product


def load_answer_product(database_url: str, sku: str) -> LiveAnswerProduct:
    # Dispatcher runs off the event loop. Own this connection, never share a request Session
    # with the worker, and use the application's existing engine/catalog rules.
    engine = make_engine(database_url)
    try:
        with make_session_factory(engine)() as db:
            p = product_for_sku(db, sku)
            v = next(v for v in p.variants if v.sku == sku and v.is_active)
            if not p.name.strip() or not any(
                text.strip()
                for text in (p.description, p.ingredients if p.ingredients_verified else "", p.storage)
            ):
                raise AppError(422, "live_product_incomplete", "Catalog product has no answer facts.")
            fields = [
                ("Phân loại", v.name),
                ("Giá (VND)", str(v.price_vnd)),
                ("Khối lượng (g)", str(v.weight_g) if v.weight_g is not None else ""),
                ("Mô tả", p.description),
                ("Thành phần", p.ingredients if p.ingredients_verified else ""),
                ("Bảo quản", p.storage),
                ("Dị ứng", p.allergens),
                ("Độ cay", p.spice_level),
                ("Dinh dưỡng", p.nutrition),
            ]
            return LiveAnswerProduct(
                sku=sku,
                name=p.name,
                facts="\n".join(f"{label}: {value.strip() or 'Chưa có dữ liệu'}" for label, value in fields),
            )
    except SQLAlchemyError:
        raise AppError(
            503, "live_catalog_unavailable", "Catalog query failed; no answer was generated."
        ) from None
    finally:
        engine.dispose()
