"""Request and response models for event intake and the dashboard (camelCase on the wire)."""

from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import Field

from app.core.schemas import ApiModel

PublicEventName = Literal[
    "product_view",
    "add_to_cart",
    "checkout_started",
    "shopee_click",
    "live_join",
    "live_product_click",
    "chat_question",
]
Surface = Literal["store", "chat", "live"]
DemoFilter = Literal["exclude", "include", "only"]

# Letters, digits, dash and underscore: safe to store and to show, and long enough to be unguessable.
ID = r"^[A-Za-z0-9_-]{8,64}$"


class EventIn(ApiModel):
    event: PublicEventName
    session_id: str = Field(pattern=ID)
    event_id: str | None = Field(None, pattern=r"^[A-Za-z0-9_-]{8,40}$")
    sku: str | None = Field(None, max_length=40)
    source: str = Field("", max_length=100)  # utm_source
    campaign: str = Field("", max_length=100)  # utm_campaign
    content_code: str = Field("", max_length=100)  # utm_content
    surface: Surface | None = None
    qty: int | None = Field(None, ge=1, le=99)
    cart_value_vnd: int | None = Field(None, ge=0, le=2_000_000_000)
    live_id: str | None = Field(None, max_length=64)
    conversation_id: str | None = Field(None, max_length=64)
    is_demo: bool = False  # only used when no product or order tells the server


class AttributionIn(ApiModel):
    """Where the buyer came from, sent with the checkout. It only labels the order; it never changes money."""

    session_id: str | None = Field(None, pattern=ID)
    source: str = Field("", max_length=100)
    campaign: str = Field("", max_length=100)
    content_code: str = Field("", max_length=100)


# ------------------------------------------------------------------ dashboard
class FunnelStep(ApiModel):
    key: Literal["product_view", "add_to_cart", "checkout_started", "order_created", "order_completed"]
    unit: Literal["sessions", "orders"]  # a step counts distinct sessions, or distinct orders; never mixed up
    count: int
    # Share of the previous step. None when it cannot be computed; `rate_note` says why.
    rate: float | None
    rate_note: Literal["ok", "first_step", "previous_step_empty"]
    # True when later steps have data but this one has none: the tracking is missing, the funnel is not bridged.
    tracking_gap: bool


class Totals(ApiModel):
    orders_created: int
    orders_completed: int
    revenue_vnd: int  # orders marked completed in the period
    average_order_vnd: int | None  # None when no order is completed
    completion_rate: (
        float | None
    )  # completed / created, both counted in the same period; None if nothing created


class SourceRow(ApiModel):
    source: str  # "" = direct
    viewers: int  # sessions
    carters: int  # sessions
    orders_created: int
    orders_completed: int
    revenue_vnd: int


class ProductRow(ApiModel):
    sku: str
    product_name: str
    variant_name: str
    viewers: int  # sessions
    carters: int  # sessions
    shopee_clicks: int


class Overview(ApiModel):
    date_from: date
    date_to: date
    demo: DemoFilter
    source: str | None
    funnel: list[FunnelStep]
    totals: Totals
    by_source: list[SourceRow]
    top_products: list[ProductRow]
    shopee_clicks: int  # never counted as a purchase
