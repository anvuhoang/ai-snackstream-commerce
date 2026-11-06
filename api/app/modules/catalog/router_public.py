"""Public storefront catalog. No login: anyone may read published products."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.storage import MediaStorage, get_storage

from . import presenters, service
from .schemas import CategoryOut, ProductCardPage, ProductDetail, SortKey

router = APIRouter(prefix="/api/catalog", tags=["catalog"])


@router.get("/categories", response_model=list[CategoryOut])
def categories(db: Session = Depends(get_db)) -> list[CategoryOut]:
    """Categories that currently have at least one product on sale."""
    return [presenters.category(c, n) for c, n in service.list_public_categories(db)]


@router.get("/products", response_model=ProductCardPage)
def products(
    q: str = Query("", max_length=100, description="Search text; accents and case are ignored."),
    category: str = Query("", max_length=80, description="Category slug."),
    sort: SortKey = "newest",
    page: int = Query(1, ge=1, le=10_000),
    page_size: int = Query(12, ge=1, le=48, alias="pageSize"),
    db: Session = Depends(get_db),
    storage: MediaStorage = Depends(get_storage),
) -> ProductCardPage:
    items, total = service.list_public_products(db, q, category, sort, page, page_size)
    return ProductCardPage(
        items=[presenters.card(p, storage) for p in items], page=page, page_size=page_size, total=total
    )


@router.get("/products/{slug}", response_model=ProductDetail)
def product(
    slug: str, db: Session = Depends(get_db), storage: MediaStorage = Depends(get_storage)
) -> ProductDetail:
    return presenters.detail(service.get_public_product(db, slug), storage)
