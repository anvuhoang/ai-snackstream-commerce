"""Back-office catalog management. Reading needs a signed-in admin or staff; every write needs an admin and a CSRF token."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import AppError
from app.core.storage import MediaStorage, get_storage, sniff_image_ext
from app.modules.auth.deps import require_csrf, require_role

from . import presenters, service
from .schemas import (
    AdminCategory,
    AdminProduct,
    AdminProductPage,
    CategoryIn,
    CategoryUpdate,
    ImageUpdate,
    ProductCreate,
    ProductUpdate,
    Status,
    VariantIn,
    VariantUpdate,
)

router = APIRouter(prefix="/api/admin/catalog", tags=["admin-catalog"])

Reader = Depends(require_role("admin", "staff"))
Writer = [Depends(require_role("admin")), Depends(require_csrf)]
Db = Annotated[Session, Depends(get_db)]
Storage = Annotated[MediaStorage, Depends(get_storage)]


# ------------------------------------------------------------------ categories
@router.get("/categories", response_model=list[AdminCategory], dependencies=[Reader])
def list_categories(db: Db) -> list[AdminCategory]:
    return [presenters.admin_category(c, n) for c, n in service.list_admin_categories(db)]


@router.post("/categories", response_model=AdminCategory, status_code=201, dependencies=Writer)
def create_category(body: CategoryIn, db: Db) -> AdminCategory:
    return presenters.admin_category(service.create_category(db, body), 0)


@router.patch("/categories/{category_id}", response_model=AdminCategory, dependencies=Writer)
def update_category(category_id: int, body: CategoryUpdate, db: Db) -> AdminCategory:
    c = service.update_category(db, category_id, body)
    count = dict((x.id, n) for x, n in service.list_admin_categories(db)).get(c.id, 0)
    return presenters.admin_category(c, count)


# ------------------------------------------------------------------ products
@router.get("/products", response_model=AdminProductPage, dependencies=[Reader])
def list_products(
    db: Db,
    q: str = Query("", max_length=100),
    status: Status | None = None,
    page: int = Query(1, ge=1, le=10_000),
    page_size: int = Query(20, ge=1, le=100, alias="pageSize"),
) -> AdminProductPage:
    items, total = service.list_admin_products(db, q, status or "", page, page_size)
    return AdminProductPage(
        items=[presenters.admin_row(p) for p in items], page=page, page_size=page_size, total=total
    )


@router.post("/products", response_model=AdminProduct, status_code=201, dependencies=Writer)
def create_product(body: ProductCreate, db: Db, storage: Storage) -> AdminProduct:
    return presenters.admin_product(service.create_product(db, body), storage)


@router.get("/products/{product_id}", response_model=AdminProduct, dependencies=[Reader])
def get_product(product_id: int, db: Db, storage: Storage) -> AdminProduct:
    return presenters.admin_product(service.get_admin_product(db, product_id), storage)


@router.patch("/products/{product_id}", response_model=AdminProduct, dependencies=Writer)
def update_product(product_id: int, body: ProductUpdate, db: Db, storage: Storage) -> AdminProduct:
    return presenters.admin_product(service.update_product(db, product_id, body), storage)


@router.post("/products/{product_id}/publish", response_model=AdminProduct, dependencies=Writer)
def publish(product_id: int, db: Db, storage: Storage) -> AdminProduct:
    return presenters.admin_product(service.publish_product(db, product_id), storage)


@router.post("/products/{product_id}/hide", response_model=AdminProduct, dependencies=Writer)
def hide(product_id: int, db: Db, storage: Storage) -> AdminProduct:
    return presenters.admin_product(service.hide_product(db, product_id), storage)


# ------------------------------------------------------------------ variants
@router.post(
    "/products/{product_id}/variants", response_model=AdminProduct, status_code=201, dependencies=Writer
)
def add_variant(product_id: int, body: VariantIn, db: Db, storage: Storage) -> AdminProduct:
    return presenters.admin_product(service.add_variant(db, product_id, body), storage)


@router.patch("/variants/{variant_id}", response_model=AdminProduct, dependencies=Writer)
def update_variant(variant_id: int, body: VariantUpdate, db: Db, storage: Storage) -> AdminProduct:
    return presenters.admin_product(service.update_variant(db, variant_id, body), storage)


# ------------------------------------------------------------------ images
@router.post(
    "/products/{product_id}/images", response_model=AdminProduct, status_code=201, dependencies=Writer
)
def upload_image(
    product_id: int,
    request: Request,
    db: Db,
    storage: Storage,
    file: UploadFile = File(...),
    alt: str = Form("", max_length=200),
) -> AdminProduct:
    limit = request.app.state.settings.max_upload_bytes
    data = file.file.read(limit + 1)  # one extra byte tells us it is too big without reading the whole upload
    if len(data) > limit:
        raise AppError(413, "file_too_large", f"Images may be at most {limit // (1024 * 1024)} MB.")
    ext = sniff_image_ext(data)
    if ext is None:
        raise AppError(415, "unsupported_image_type", "Only JPEG, PNG and WebP images are accepted.")
    return presenters.admin_product(service.add_image(db, product_id, storage, data, ext, alt), storage)


@router.patch("/images/{image_id}", response_model=AdminProduct, dependencies=Writer)
def update_image(image_id: int, body: ImageUpdate, db: Db, storage: Storage) -> AdminProduct:
    return presenters.admin_product(service.update_image(db, image_id, body), storage)


@router.delete("/images/{image_id}", response_model=AdminProduct, dependencies=Writer)
def delete_image(image_id: int, db: Db, storage: Storage) -> AdminProduct:
    return presenters.admin_product(service.delete_image(db, image_id, storage), storage)
