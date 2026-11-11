"""Request and response models for carts, checkout, orders and payments (camelCase on the wire)."""

from __future__ import annotations

import re
from datetime import datetime
from typing import Literal

from pydantic import Field, field_validator

from app.core.schemas import ApiModel
from app.modules.analytics.schemas import AttributionIn
from app.modules.catalog.schemas import ImageOut

OrderStatus = Literal["new", "confirmed", "shipping", "completed", "cancelled"]
PaymentMethod = Literal["cod", "vnpay"]
PaymentStatus = Literal["pending", "paid", "failed", "expired"]


def normalize_phone(raw: str) -> str:
    """Vietnamese mobile/landline numbers as plain digits with a leading 0 (+84 and 84 are accepted)."""
    digits = re.sub(r"\D", "", raw)
    if digits.startswith("84") and len(digits) >= 11:
        digits = "0" + digits[2:]
    if not re.fullmatch(r"0\d{9,10}", digits):
        raise ValueError("Enter a valid Vietnamese phone number, e.g. 0901234567.")
    return digits


# ------------------------------------------------------------------ shop settings the web needs
class ShopConfig(ApiModel):
    shipping_fee_vnd: int
    free_ship_from_vnd: int
    payment_methods: list[PaymentMethod]
    online_payment_is_sandbox: bool = True
    order_expiry_minutes: int


# ------------------------------------------------------------------ cart
class CartItemAdd(ApiModel):
    variant_id: int
    qty: int = Field(1, ge=1, le=99)


class CartItemSet(ApiModel):
    qty: int = Field(ge=1, le=99)


class CartLine(ApiModel):
    variant_id: int
    sku: str
    product_slug: str
    product_name: str
    variant_name: str
    unit_price_vnd: int
    qty: int
    line_total_vnd: int
    image: ImageOut | None
    # False when the product was hidden or the variant switched off after it was added; such lines are not charged.
    available: bool


class CartOut(ApiModel):
    items: list[CartLine]
    item_count: int
    subtotal_vnd: int
    shipping_fee_vnd: int
    total_vnd: int
    free_ship_from_vnd: int
    # How much more to add for free shipping; 0 when it is already free (or the cart is empty).
    free_ship_remaining_vnd: int
    has_unavailable: bool


# ------------------------------------------------------------------ checkout
class CustomerIn(ApiModel):
    name: str = Field(min_length=1, max_length=120)
    phone: str = Field(max_length=30)

    @field_validator("name")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Enter your name.")
        return v

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str) -> str:
        return normalize_phone(v)


class ShippingIn(ApiModel):
    address: str = Field(min_length=1, max_length=255)
    ward: str = Field("", max_length=120)
    district: str = Field("", max_length=120)
    province: str = Field("", max_length=120)

    @field_validator("address")
    @classmethod
    def _address(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Enter the delivery address.")
        return v


class CheckoutIn(ApiModel):
    customer: CustomerIn
    shipping: ShippingIn
    note: str = Field("", max_length=500)
    payment_method: PaymentMethod = "cod"
    attribution: AttributionIn | None = None


class LookupIn(ApiModel):
    code: str = Field(min_length=4, max_length=30)
    phone: str = Field(max_length=30)

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str) -> str:
        return normalize_phone(v)


# ------------------------------------------------------------------ orders
class OrderItemOut(ApiModel):
    sku: str
    product_name: str
    variant_name: str
    unit_price_vnd: int
    qty: int
    line_total_vnd: int
    image: ImageOut | None = None  # filled for the back office only


class PaymentOut(ApiModel):
    provider: PaymentMethod
    status: PaymentStatus
    amount_vnd: int
    paid_at: datetime | None


class HistoryOut(ApiModel):
    from_status: OrderStatus | None
    to_status: OrderStatus
    note: str
    created_at: datetime
    actor_email: str | None = None


class OrderOut(ApiModel):
    code: str
    status: OrderStatus
    customer_name: str
    # Masked for the public lookup (09******67); complete in the back office.
    customer_phone: str
    ship_address: str
    ship_ward: str
    ship_district: str
    ship_province: str
    note: str
    subtotal_vnd: int
    shipping_fee_vnd: int
    total_vnd: int
    payment_method: PaymentMethod
    expires_at: datetime | None
    created_at: datetime
    items: list[OrderItemOut]
    payments: list[PaymentOut]
    history: list[HistoryOut]


class CheckoutOut(OrderOut):
    # Where to send the customer to pay (online methods only); null for cash on delivery.
    payment_url: str | None = None


# ------------------------------------------------------------------ back office
class AdminOrderRow(ApiModel):
    id: int
    code: str
    status: OrderStatus
    customer_name: str
    customer_phone: str
    total_vnd: int
    payment_method: PaymentMethod
    payment_status: PaymentStatus | None
    item_count: int
    created_at: datetime


class AdminOrderPage(ApiModel):
    items: list[AdminOrderRow]
    page: int
    page_size: int
    total: int


class AdminOrder(OrderOut):
    id: int
    # What the back office may do next, so the screen never offers an impossible step.
    next_statuses: list[OrderStatus]


class StatusChange(ApiModel):
    to: OrderStatus
    note: str = Field("", max_length=500)


class PaymentReturnOut(ApiModel):
    """What the customer's browser shows after coming back from the gateway. Read-only: the gateway's callback decides."""

    result: Literal["paid", "failed", "pending", "invalid"]
    order_code: str | None = None
