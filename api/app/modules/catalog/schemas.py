"""Request and response models of the catalog. JSON uses camelCase (see ApiModel)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field, field_validator, model_validator

from app.core.schemas import ApiModel

SKU_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9_-]{1,38}$"
MAX_PRICE_VND = 100_000_000
Status = Literal["draft", "published", "hidden"]
SortKey = Literal["newest", "price_asc", "price_desc", "name"]


def _check_url(value: str) -> str:
    value = value.strip()
    if value and not value.startswith(("http://", "https://")):
        raise ValueError("must start with http:// or https://")
    return value


# ------------------------------------------------------------------ public responses
class ImageOut(ApiModel):
    id: int
    url: str
    alt: str


class CategoryOut(ApiModel):
    id: int
    slug: str
    name: str
    product_count: int


class CategoryRef(ApiModel):
    id: int
    slug: str
    name: str


class VariantOut(ApiModel):
    id: int
    sku: str
    name: str
    price_vnd: int
    compare_at_vnd: int | None
    weight_g: int | None
    # Units still sellable (None = not tracked, always sellable) and what the shop may say about it. `unknown` = the count is
    # too old to trust, so the shop asks the customer to contact it instead.
    available: int | None = None
    stock_status: Literal["ok", "low", "out", "unknown"] = "ok"
    stock_updated_at: datetime | None = None


class ProductCard(ApiModel):
    id: int
    slug: str
    name: str
    category: CategoryRef | None
    image: ImageOut | None
    price_from_vnd: int
    compare_at_from_vnd: int | None
    variant_count: int
    is_demo: bool
    sold_out: bool = False  # every variant on sale is out of stock


class ProductCardPage(ApiModel):
    items: list[ProductCard]
    page: int
    page_size: int
    total: int


class ProductDetail(ApiModel):
    id: int
    slug: str
    name: str
    description: str
    ingredients: str
    storage: str
    category: CategoryRef | None
    variants: list[VariantOut]
    images: list[ImageOut]
    shopee_url: str
    is_demo: bool
    updated_at: datetime


# ------------------------------------------------------------------ admin requests
class VariantIn(ApiModel):
    sku: str = Field(pattern=SKU_PATTERN)
    name: str = Field(min_length=1, max_length=120)
    price_vnd: int = Field(ge=0, le=MAX_PRICE_VND)
    compare_at_vnd: int | None = Field(None, ge=1, le=MAX_PRICE_VND)
    weight_g: int | None = Field(None, ge=1, le=100_000)
    sort_order: int = 0

    @field_validator("sku")
    @classmethod
    def _upper(cls, v: str) -> str:
        return v.upper()

    @model_validator(mode="after")
    def _compare_at(self) -> VariantIn:
        if self.compare_at_vnd is not None and self.compare_at_vnd <= self.price_vnd:
            raise ValueError("compareAtVnd must be higher than priceVnd")
        return self


class VariantUpdate(ApiModel):
    """The SKU is not editable: orders and stock will refer to it."""

    name: str | None = Field(None, min_length=1, max_length=120)
    price_vnd: int | None = Field(None, ge=0, le=MAX_PRICE_VND)
    compare_at_vnd: int | None = Field(None, ge=1, le=MAX_PRICE_VND)
    weight_g: int | None = Field(None, ge=1, le=100_000)
    is_active: bool | None = None
    sort_order: int | None = None


class ProductCreate(ApiModel):
    name: str = Field(min_length=1, max_length=200)
    category_id: int | None = None
    description: str = Field("", max_length=5000)
    ingredients: str = Field("", max_length=3000)
    storage: str = Field("", max_length=2000)
    ingredients_verified: bool = False
    shopee_url: str = Field("", max_length=500)
    variants: list[VariantIn] = Field(min_length=1)

    @field_validator("shopee_url")
    @classmethod
    def _url(cls, v: str) -> str:
        return _check_url(v)


class ProductUpdate(ApiModel):
    """Only the fields that are sent are changed."""

    name: str | None = Field(None, min_length=1, max_length=200)
    category_id: int | None = None
    description: str | None = Field(None, max_length=5000)
    ingredients: str | None = Field(None, max_length=3000)
    storage: str | None = Field(None, max_length=2000)
    ingredients_verified: bool | None = None
    shopee_url: str | None = Field(None, max_length=500)

    @field_validator("shopee_url")
    @classmethod
    def _url(cls, v: str | None) -> str | None:
        return None if v is None else _check_url(v)


class ImageUpdate(ApiModel):
    alt: str | None = Field(None, max_length=200)
    sort_order: int | None = None


class CategoryIn(ApiModel):
    name: str = Field(min_length=1, max_length=120)
    sort_order: int = 0


class CategoryUpdate(ApiModel):
    name: str | None = Field(None, min_length=1, max_length=120)
    sort_order: int | None = None


# ------------------------------------------------------------------ admin responses
class AdminVariant(ApiModel):
    id: int
    sku: str
    name: str
    price_vnd: int
    compare_at_vnd: int | None
    weight_g: int | None
    is_active: bool
    sort_order: int


class AdminProduct(ApiModel):
    id: int
    slug: str
    name: str
    status: Status
    description: str
    ingredients: str
    storage: str
    ingredients_verified: bool
    category_id: int | None
    shopee_url: str
    is_demo: bool
    variants: list[AdminVariant]
    images: list[ImageOut]
    publish_blockers: list[str]
    created_at: datetime
    updated_at: datetime


class AdminProductRow(ApiModel):
    id: int
    slug: str
    name: str
    status: Status
    category_name: str | None
    variant_count: int
    is_demo: bool
    updated_at: datetime
    image: ImageOut | None = None  # the cover photo, for the list


class AdminProductPage(ApiModel):
    items: list[AdminProductRow]
    page: int
    page_size: int
    total: int


class AdminCategory(ApiModel):
    id: int
    slug: str
    name: str
    sort_order: int
    product_count: int
