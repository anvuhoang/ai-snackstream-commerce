"""Catalog business rules. Routers only parse input and call these functions.

Invariants kept here (not in the UI):
  * a published product always meets `publish_blockers` (category, verified ingredients and storage text, a priced variant);
  * SKUs are unique and immutable; variants are deactivated, never deleted;
  * hiding a product keeps all its data.
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core.errors import AppError
from app.core.storage import MediaStorage
from app.core.text import fold, slugify

from .models import Category, Product, ProductImage, Variant
from .schemas import (
    CategoryIn,
    CategoryUpdate,
    ImageUpdate,
    ProductCreate,
    ProductUpdate,
    SortKey,
    VariantIn,
    VariantUpdate,
)

_LOAD = (selectinload(Product.variants), selectinload(Product.images), selectinload(Product.category))


# ------------------------------------------------------------------ helpers
def publish_blockers(p: Product) -> list[str]:
    """Why this product cannot be published yet; empty means it can."""
    missing = []
    if p.category_id is None:
        missing.append("category")
    if not p.ingredients.strip():
        missing.append("ingredients")
    if not p.storage.strip():
        missing.append("storage")
    if not p.ingredients_verified:
        missing.append("ingredients_verified")
    if not any(v.is_active and v.price_vnd > 0 for v in p.variants):
        missing.append("active_variant")
    return missing


def _refresh_search_text(p: Product) -> None:
    parts = [p.name, p.description, p.category.name if p.category else ""]
    parts += [f"{v.sku} {v.name}" for v in p.variants]
    p.search_text = fold(" ".join(parts))


def _unique_slug(db: Session, model, base: str) -> str:
    slug, n = base, 2
    while db.scalar(select(model.id).where(model.slug == slug)):
        slug, n = f"{base}-{n}", n + 1
    return slug


def _tokens(q: str) -> list[str]:
    return [t for t in fold(q).split() if t]


def _guard_published(p: Product) -> None:
    """A change must not leave a published product unsellable."""
    if p.status == "published" and (missing := publish_blockers(p)):
        raise AppError(
            422,
            "publish_requirements_not_met",
            "A published product must stay sellable.",
            {"missing": missing},
        )


def _commit(db: Session, code: str = "conflict", message: str = "That value is already in use.") -> None:
    try:
        db.commit()
    except IntegrityError as exc:  # a race that slipped past the pre-checks
        db.rollback()
        raise AppError(409, code, message) from exc


def _get_product(db: Session, product_id: int) -> Product:
    p = db.scalar(select(Product).where(Product.id == product_id).options(*_LOAD))
    if not p:
        raise AppError(404, "product_not_found", "No such product.")
    return p


def _require_category(db: Session, category_id: int | None) -> None:
    if category_id is not None and not db.get(Category, category_id):
        raise AppError(422, "category_not_found", "No such category.")


def _taken_skus(db: Session, skus: list[str]) -> list[str]:
    return list(db.scalars(select(Variant.sku).where(Variant.sku.in_(skus))))


# ------------------------------------------------------------------ public reads
def _sellable(stmt):
    """Visible to customers: published and still offering at least one active variant."""
    return stmt.where(Product.status == "published", Product.variants.any(Variant.is_active.is_(True)))


def list_public_categories(db: Session) -> list[tuple[Category, int]]:
    counts = (
        select(Product.category_id, func.count(Product.id).label("n"))
        .where(Product.status == "published", Product.variants.any(Variant.is_active.is_(True)))
        .group_by(Product.category_id)
        .subquery()
    )
    rows = db.execute(
        select(Category, func.coalesce(counts.c.n, 0))
        .outerjoin(counts, counts.c.category_id == Category.id)
        .order_by(Category.sort_order, Category.name)
    ).all()
    return [(c, n) for c, n in rows if n > 0]


def list_public_products(
    db: Session, q: str, category_slug: str, sort: SortKey, page: int, page_size: int
) -> tuple[list[Product], int]:
    stmt = _sellable(select(Product))
    if category_slug:
        stmt = stmt.join(Category, Category.id == Product.category_id).where(Category.slug == category_slug)
    for token in _tokens(q):
        stmt = stmt.where(Product.search_text.contains(token, autoescape=True))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0

    if sort in ("price_asc", "price_desc"):
        cheapest = (
            select(Variant.product_id, func.min(Variant.price_vnd).label("p"))
            .where(Variant.is_active.is_(True))
            .group_by(Variant.product_id)
            .subquery()
        )
        stmt = stmt.join(cheapest, cheapest.c.product_id == Product.id)
        stmt = stmt.order_by(cheapest.c.p.asc() if sort == "price_asc" else cheapest.c.p.desc(), Product.id)
    elif sort == "name":
        stmt = stmt.order_by(Product.slug)
    else:
        stmt = stmt.order_by(Product.created_at.desc(), Product.id.desc())

    stmt = stmt.options(*_LOAD).limit(page_size).offset((page - 1) * page_size)
    return list(db.scalars(stmt)), total


def get_public_product(db: Session, slug: str) -> Product:
    # Draft and hidden products answer exactly like unknown ones, so their existence is not revealed.
    p = db.scalar(_sellable(select(Product)).where(Product.slug == slug).options(*_LOAD))
    if not p:
        raise AppError(404, "product_not_found", "No such product.")
    return p


# ------------------------------------------------------------------ admin reads
def list_admin_products(
    db: Session, q: str, status: str, page: int, page_size: int
) -> tuple[list[Product], int]:
    stmt = select(Product)
    if status:
        stmt = stmt.where(Product.status == status)
    for token in _tokens(q):
        stmt = stmt.where(Product.search_text.contains(token, autoescape=True))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    stmt = stmt.order_by(Product.updated_at.desc(), Product.id.desc()).options(*_LOAD)
    return list(db.scalars(stmt.limit(page_size).offset((page - 1) * page_size))), total


def get_admin_product(db: Session, product_id: int) -> Product:
    return _get_product(db, product_id)


def list_admin_categories(db: Session) -> list[tuple[Category, int]]:
    counts = (
        select(Product.category_id, func.count(Product.id).label("n"))
        .group_by(Product.category_id)
        .subquery()
    )
    rows = db.execute(
        select(Category, func.coalesce(counts.c.n, 0))
        .outerjoin(counts, counts.c.category_id == Category.id)
        .order_by(Category.sort_order, Category.name)
    ).all()
    return [(c, n) for c, n in rows]


# ------------------------------------------------------------------ categories
def create_category(db: Session, data: CategoryIn) -> Category:
    c = Category(
        name=data.name.strip(),
        sort_order=data.sort_order,
        slug=_unique_slug(db, Category, slugify(data.name)),
    )
    db.add(c)
    _commit(db, "category_exists", "A category with that name already exists.")
    return c


def update_category(db: Session, category_id: int, data: CategoryUpdate) -> Category:
    c = db.get(Category, category_id)
    if not c:
        raise AppError(404, "category_not_found", "No such category.")
    changes = data.model_dump(exclude_unset=True, exclude_none=True)
    if "name" in changes:
        c.name = changes["name"].strip()
    if "sort_order" in changes:
        c.sort_order = changes["sort_order"]
    for p in db.scalars(select(Product).where(Product.category_id == c.id).options(*_LOAD)):
        _refresh_search_text(p)  # the category name is part of the product's search text
    db.commit()
    return c


# ------------------------------------------------------------------ products
def create_product(db: Session, data: ProductCreate, *, is_demo: bool = False) -> Product:
    _require_category(db, data.category_id)
    skus = [v.sku for v in data.variants]
    if len(set(skus)) != len(skus):
        raise AppError(422, "duplicate_sku", "Two variants in the request share a SKU.")
    if taken := _taken_skus(db, skus):
        raise AppError(409, "sku_taken", f"SKU already in use: {', '.join(taken)}", {"skus": taken})

    p = Product(
        name=data.name.strip(),
        slug=_unique_slug(db, Product, slugify(data.name)),
        category_id=data.category_id,
        description=data.description.strip(),
        ingredients=data.ingredients.strip(),
        storage=data.storage.strip(),
        ingredients_verified=data.ingredients_verified,
        shopee_url=data.shopee_url,
        is_demo=is_demo,
        status="draft",
    )
    p.variants = [_new_variant(v, i) for i, v in enumerate(data.variants)]
    db.add(p)
    db.flush()
    db.refresh(p, ["category"])
    _refresh_search_text(p)
    _commit(db, "sku_taken", "SKU already in use.")
    return _get_product(db, p.id)


def update_product(db: Session, product_id: int, data: ProductUpdate) -> Product:
    p = _get_product(db, product_id)
    changes = data.model_dump(exclude_unset=True)
    if "category_id" in changes:
        _require_category(db, changes["category_id"])
    for field in ("name", "description", "ingredients", "storage"):
        if changes.get(field) is not None:
            setattr(p, field, changes[field].strip())
    for field in ("category_id", "ingredients_verified", "shopee_url"):
        if field in changes and (changes[field] is not None or field == "category_id"):
            setattr(p, field, changes[field])
    db.flush()
    db.refresh(p, ["category"])
    try:
        _guard_published(p)
    except AppError:
        db.rollback()
        raise
    _refresh_search_text(p)
    db.commit()
    return _get_product(db, p.id)


def publish_product(db: Session, product_id: int) -> Product:
    p = _get_product(db, product_id)
    if missing := publish_blockers(p):
        raise AppError(
            422,
            "publish_requirements_not_met",
            "The product is not ready to be published.",
            {"missing": missing},
        )
    p.status = "published"
    db.commit()
    return p


def hide_product(db: Session, product_id: int) -> Product:
    p = _get_product(db, product_id)
    p.status = "hidden"
    db.commit()
    return p


# ------------------------------------------------------------------ variants
def _new_variant(v: VariantIn, order: int) -> Variant:
    return Variant(
        sku=v.sku,
        name=v.name.strip(),
        price_vnd=v.price_vnd,
        compare_at_vnd=v.compare_at_vnd,
        weight_g=v.weight_g,
        sort_order=v.sort_order or order,
    )


def add_variant(db: Session, product_id: int, data: VariantIn) -> Product:
    p = _get_product(db, product_id)
    if _taken_skus(db, [data.sku]):
        raise AppError(409, "sku_taken", f"SKU already in use: {data.sku}", {"skus": [data.sku]})
    p.variants.append(_new_variant(data, len(p.variants)))
    db.flush()
    _refresh_search_text(p)
    _commit(db, "sku_taken", "SKU already in use.")
    return _get_product(db, product_id)


def update_variant(db: Session, variant_id: int, data: VariantUpdate) -> Product:
    v = db.get(Variant, variant_id)
    if not v:
        raise AppError(404, "variant_not_found", "No such variant.")
    p = _get_product(db, v.product_id)
    v = next(x for x in p.variants if x.id == variant_id)
    changes = data.model_dump(exclude_unset=True)
    for field in ("name", "price_vnd", "weight_g", "is_active", "sort_order"):
        if field in changes and changes[field] is not None:
            setattr(v, field, changes[field].strip() if field == "name" else changes[field])
    if "compare_at_vnd" in changes:  # null clears the "was" price
        v.compare_at_vnd = changes["compare_at_vnd"]
    if v.compare_at_vnd is not None and v.compare_at_vnd <= v.price_vnd:
        db.rollback()
        raise AppError(422, "invalid_compare_at", "The 'was' price must be higher than the price.")
    try:
        _guard_published(p)
    except AppError:
        db.rollback()
        raise
    _refresh_search_text(p)
    db.commit()
    return _get_product(db, p.id)


# ------------------------------------------------------------------ images
def add_image(
    db: Session, product_id: int, storage: MediaStorage, data: bytes, ext: str, alt: str
) -> Product:
    p = _get_product(db, product_id)
    key = storage.save(data, ext)
    order = max((i.sort_order for i in p.images), default=-1) + 1
    p.images.append(ProductImage(storage_key=key, alt=alt.strip()[:200], sort_order=order))
    try:
        db.commit()
    except Exception:
        db.rollback()
        storage.delete(key)
        raise
    return _get_product(db, product_id)


def update_image(db: Session, image_id: int, data: ImageUpdate) -> Product:
    img = db.get(ProductImage, image_id)
    if not img:
        raise AppError(404, "image_not_found", "No such image.")
    changes = data.model_dump(exclude_unset=True, exclude_none=True)
    if "alt" in changes:
        img.alt = changes["alt"].strip()
    if "sort_order" in changes:
        img.sort_order = changes["sort_order"]
    db.commit()
    return _get_product(db, img.product_id)


def delete_image(db: Session, image_id: int, storage: MediaStorage) -> Product:
    img = db.get(ProductImage, image_id)
    if not img:
        raise AppError(404, "image_not_found", "No such image.")
    product_id, key = img.product_id, img.storage_key
    db.delete(img)
    db.commit()
    storage.delete(key)
    return _get_product(db, product_id)
