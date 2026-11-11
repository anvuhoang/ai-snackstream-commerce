"""ORM objects -> response models. Kept apart from the service so business rules never depend on the wire format."""

from __future__ import annotations

from app.core.storage import MediaStorage
from app.modules.inventory.service import StockInfo

from . import service
from .models import Category, Product, ProductImage
from .schemas import (
    AdminCategory,
    AdminProduct,
    AdminProductRow,
    AdminVariant,
    CategoryOut,
    CategoryRef,
    ImageOut,
    ProductCard,
    ProductDetail,
    VariantOut,
)


def image(img: ProductImage, storage: MediaStorage) -> ImageOut:
    return ImageOut(id=img.id, url=storage.url(img.storage_key), alt=img.alt)


def _category_ref(p: Product) -> CategoryRef | None:
    c = p.category
    return CategoryRef(id=c.id, slug=c.slug, name=c.name) if c else None


def card(p: Product, storage: MediaStorage, stock: dict[int, StockInfo] | None = None) -> ProductCard:
    stock = stock or {}
    active = [v for v in p.variants if v.is_active]
    cheapest = min(active, key=lambda v: v.price_vnd)  # callers only pass sellable products
    return ProductCard(
        id=p.id,
        slug=p.slug,
        name=p.name,
        category=_category_ref(p),
        image=image(p.images[0], storage) if p.images else None,
        price_from_vnd=cheapest.price_vnd,
        compare_at_from_vnd=cheapest.compare_at_vnd,
        variant_count=len(active),
        is_demo=p.is_demo,
        sold_out=bool(active)
        and all(stock.get(v.id) is not None and stock[v.id].status == "out" for v in active),
    )


def _variant(v, stock: dict[int, StockInfo]) -> VariantOut:
    out = VariantOut.model_validate(v)
    info = stock.get(v.id)
    if info is None:
        return out
    return out.model_copy(
        update={"available": info.available, "stock_status": info.status, "stock_updated_at": info.updated_at}
    )


def detail(p: Product, storage: MediaStorage, stock: dict[int, StockInfo] | None = None) -> ProductDetail:
    stock = stock or {}
    return ProductDetail(
        id=p.id,
        slug=p.slug,
        name=p.name,
        description=p.description,
        ingredients=p.ingredients,
        storage=p.storage,
        category=_category_ref(p),
        variants=[_variant(v, stock) for v in p.variants if v.is_active],
        images=[image(i, storage) for i in p.images],
        shopee_url=p.shopee_url,
        is_demo=p.is_demo,
        updated_at=p.updated_at,
    )


def category(c: Category, count: int) -> CategoryOut:
    return CategoryOut(id=c.id, slug=c.slug, name=c.name, product_count=count)


def admin_category(c: Category, count: int) -> AdminCategory:
    return AdminCategory(id=c.id, slug=c.slug, name=c.name, sort_order=c.sort_order, product_count=count)


def admin_row(p: Product, storage: MediaStorage) -> AdminProductRow:
    return AdminProductRow(
        id=p.id,
        slug=p.slug,
        name=p.name,
        status=p.status,
        category_name=p.category.name if p.category else None,
        variant_count=len(p.variants),
        is_demo=p.is_demo,
        updated_at=p.updated_at,
        image=image(p.images[0], storage) if p.images else None,
    )


def admin_product(p: Product, storage: MediaStorage) -> AdminProduct:
    return AdminProduct(
        id=p.id,
        slug=p.slug,
        name=p.name,
        status=p.status,
        description=p.description,
        ingredients=p.ingredients,
        storage=p.storage,
        ingredients_verified=p.ingredients_verified,
        category_id=p.category_id,
        shopee_url=p.shopee_url,
        is_demo=p.is_demo,
        variants=[AdminVariant.model_validate(v) for v in p.variants],
        images=[image(i, storage) for i in p.images],
        publish_blockers=service.publish_blockers(p),
        created_at=p.created_at,
        updated_at=p.updated_at,
    )
