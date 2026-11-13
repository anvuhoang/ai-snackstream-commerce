from __future__ import annotations

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, TimestampMixin

STATUSES = ("draft", "published", "hidden")


class Category(Base, TimestampMixin):
    __tablename__ = "category"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class Product(Base, TimestampMixin):
    """A sellable thing as the customer sees it. What is actually bought is a Variant (it has the SKU and the price).

    Hiding a product never deletes it: later, orders keep pointing at its variants.
    """

    __tablename__ = "product"
    __table_args__ = (CheckConstraint("status IN ('draft', 'published', 'hidden')", name="status_valid"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    ingredients: Mapped[str] = mapped_column(Text, default="")
    storage: Mapped[str] = mapped_column(Text, default="")
    # A person confirmed the ingredient and storage text against the real package. Required to publish.
    ingredients_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(12), default="draft", index=True)
    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("category.id", ondelete="RESTRICT"), index=True
    )
    shopee_url: Mapped[str] = mapped_column(String(500), default="")
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    # Lower-cased, accent-free text of name, category, SKUs ...; search is a plain substring match on it.
    search_text: Mapped[str] = mapped_column(Text, default="")

    category: Mapped[Category | None] = relationship()
    variants: Mapped[list[Variant]] = relationship(
        back_populates="product", order_by="Variant.sort_order, Variant.id", cascade="all, delete-orphan"
    )
    images: Mapped[list[ProductImage]] = relationship(
        back_populates="product",
        order_by="ProductImage.sort_order, ProductImage.id",
        cascade="all, delete-orphan",
    )


class Variant(Base, TimestampMixin):
    """One purchasable option of a product (e.g. "Gói 250g"). The SKU is unique and never changes once created."""

    __tablename__ = "variant"
    __table_args__ = (
        CheckConstraint("price_vnd >= 0", name="price_non_negative"),
        CheckConstraint(
            "compare_at_vnd IS NULL OR compare_at_vnd > price_vnd", name="compare_at_above_price"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("product.id", ondelete="CASCADE"), index=True)
    sku: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    price_vnd: Mapped[int] = mapped_column(Integer)  # whole dong, never a float
    compare_at_vnd: Mapped[int | None] = mapped_column(Integer)  # "was" price shown struck through
    weight_g: Mapped[int | None] = mapped_column(Integer)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    product: Mapped[Product] = relationship(back_populates="variants")


class ProductImage(Base, TimestampMixin):
    __tablename__ = "product_image"

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("product.id", ondelete="CASCADE"), index=True)
    storage_key: Mapped[str] = mapped_column(String(120))
    alt: Mapped[str] = mapped_column(String(200), default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)  # the first image is the cover

    product: Mapped[Product] = relationship(back_populates="images")
