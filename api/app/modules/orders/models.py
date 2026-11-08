"""Cart, orders and payments. Money is integer VND everywhere. Customers have no accounts: a cart is a random token in a cookie."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, TimestampMixin

ORDER_STATUSES = ("new", "confirmed", "shipping", "completed", "cancelled")
PAYMENT_METHODS = ("cod", "vnpay")
PAYMENT_STATUSES = ("pending", "paid", "failed", "expired")


class Cart(Base, TimestampMixin):
    __tablename__ = "cart"

    id: Mapped[int] = mapped_column(primary_key=True)
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)

    items: Mapped[list[CartItem]] = relationship(
        back_populates="cart", order_by="CartItem.id", cascade="all, delete-orphan"
    )


class CartItem(Base):
    """One variant in a cart. The cart never stores a price: it is read from the catalog every time."""

    __tablename__ = "cart_item"
    __table_args__ = (
        UniqueConstraint("cart_id", "variant_id", name="uq_cart_item_cart_variant"),
        CheckConstraint("qty BETWEEN 1 AND 99", name="qty_range"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    cart_id: Mapped[int] = mapped_column(ForeignKey("cart.id", ondelete="CASCADE"), index=True)
    variant_id: Mapped[int] = mapped_column(ForeignKey("variant.id", ondelete="CASCADE"), index=True)
    qty: Mapped[int] = mapped_column(Integer)

    cart: Mapped[Cart] = relationship(back_populates="items")


class Order(Base, TimestampMixin):
    """Named `orders` because ORDER is a reserved SQL word. Order status and payment status are separate on purpose."""

    __tablename__ = "orders"
    __table_args__ = (
        CheckConstraint(
            "status IN ('new', 'confirmed', 'shipping', 'completed', 'cancelled')", name="status_valid"
        ),
        CheckConstraint("payment_method IN ('cod', 'vnpay')", name="payment_method_valid"),
        CheckConstraint(
            "subtotal_vnd >= 0 AND shipping_fee_vnd >= 0 AND total_vnd >= 0", name="amounts_non_negative"
        ),
        CheckConstraint("total_vnd = subtotal_vnd + shipping_fee_vnd", name="total_adds_up"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # Public, random, never a counter. Looking an order up needs this code AND the phone number.
    code: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    status: Mapped[str] = mapped_column(String(12), default="new", index=True)
    customer_name: Mapped[str] = mapped_column(String(120))
    customer_phone: Mapped[str] = mapped_column(String(15), index=True)
    ship_address: Mapped[str] = mapped_column(String(255))
    ship_ward: Mapped[str] = mapped_column(String(120), default="")
    ship_district: Mapped[str] = mapped_column(String(120), default="")
    ship_province: Mapped[str] = mapped_column(String(120), default="")
    note: Mapped[str] = mapped_column(String(500), default="")
    subtotal_vnd: Mapped[int] = mapped_column(Integer)
    shipping_fee_vnd: Mapped[int] = mapped_column(Integer)
    total_vnd: Mapped[int] = mapped_column(Integer)
    payment_method: Mapped[str] = mapped_column(String(10))
    # Only set for unpaid online orders: after this moment the order is cancelled and its stock released.
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)

    items: Mapped[list[OrderItem]] = relationship(
        back_populates="order", order_by="OrderItem.id", cascade="all, delete-orphan"
    )
    history: Mapped[list[OrderStatusHistory]] = relationship(
        back_populates="order", order_by="OrderStatusHistory.id", cascade="all, delete-orphan"
    )
    payments: Mapped[list[Payment]] = relationship(
        back_populates="order", order_by="Payment.id", cascade="all, delete-orphan"
    )


class OrderItem(Base):
    """What was bought, copied at purchase time so later price edits or a hidden product never change an old order."""

    __tablename__ = "order_item"
    __table_args__ = (
        CheckConstraint("qty BETWEEN 1 AND 99", name="qty_range"),
        CheckConstraint("unit_price_vnd >= 0", name="unit_price_non_negative"),
        CheckConstraint("line_total_vnd = unit_price_vnd * qty", name="line_total_adds_up"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    # RESTRICT: a variant that appears in an order can never be deleted (history must survive).
    variant_id: Mapped[int] = mapped_column(ForeignKey("variant.id", ondelete="RESTRICT"), index=True)
    sku: Mapped[str] = mapped_column(String(40))
    product_name: Mapped[str] = mapped_column(String(200))
    variant_name: Mapped[str] = mapped_column(String(120))
    unit_price_vnd: Mapped[int] = mapped_column(Integer)
    qty: Mapped[int] = mapped_column(Integer)
    line_total_vnd: Mapped[int] = mapped_column(Integer)

    order: Mapped[Order] = relationship(back_populates="items")


class OrderStatusHistory(Base):
    __tablename__ = "order_status_history"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    from_status: Mapped[str | None] = mapped_column(String(12))  # null for the first row
    to_status: Mapped[str] = mapped_column(String(12))
    # The admin user who did it; null when the customer or the system did (e.g. an unpaid order expiring).
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("admin_user.id", ondelete="SET NULL"))
    note: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    order: Mapped[Order] = relationship(back_populates="history")


class Payment(Base, TimestampMixin):
    """One payment attempt. `provider_ref` is the gateway's transaction number; (provider, provider_ref) is unique, so the
    same callback arriving twice cannot create or flip a payment twice."""

    __tablename__ = "payment"
    __table_args__ = (
        UniqueConstraint("provider", "provider_ref", name="uq_payment_provider_ref"),
        CheckConstraint("provider IN ('cod', 'vnpay')", name="provider_valid"),
        CheckConstraint("status IN ('pending', 'paid', 'failed', 'expired')", name="status_valid"),
        CheckConstraint("amount_vnd >= 0", name="amount_non_negative"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(10))
    status: Mapped[str] = mapped_column(String(10), default="pending")
    amount_vnd: Mapped[int] = mapped_column(Integer)
    provider_ref: Mapped[str | None] = mapped_column(String(64))
    last_payload: Mapped[str] = mapped_column(Text, default="")  # the last callback, kept for audit
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    order: Mapped[Order] = relationship(back_populates="payments")


class IdempotencyKey(Base):
    """A repeated checkout with the same key and the same request returns the same order; the same key with another request is an error."""

    __tablename__ = "idempotency_key"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    request_hash: Mapped[str] = mapped_column(String(64))
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
