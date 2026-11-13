"""Behaviour events. One row per thing a visitor or staff member did; reports are computed from these rows.

Time is always the server's clock (a browser's clock cannot be trusted). `is_demo` is decided on the server from the
product or order involved, so demo traffic can be excluded from reports without anyone having to remember to filter it.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, utcnow

# Sent by the browser or by chat / live.
PUBLIC_EVENTS = (
    "product_view",
    "add_to_cart",
    "checkout_started",
    "shopee_click",
    "live_join",
    "live_product_click",
    "chat_question",
)
# Written only by the server, at the moment the order really changes. A browser can never claim a sale.
SERVER_EVENTS = ("order_created", "order_completed")
SURFACES = ("store", "chat", "live")


class Event(Base):
    __tablename__ = "event"
    __table_args__ = (
        # An order is created once and completed once, however many times the code path runs.
        UniqueConstraint("name", "order_id", name="one_event_per_order"),
        Index("ix_event_name_time", "name", "occurred_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # Optional random id from the sender: sending the same event twice (a retry) stores it once.
    event_id: Mapped[str | None] = mapped_column(String(40), unique=True)
    name: Mapped[str] = mapped_column(String(24))
    session_id: Mapped[str] = mapped_column(String(64), index=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    sku: Mapped[str | None] = mapped_column(String(40), index=True)
    source: Mapped[str] = mapped_column(String(100), default="")  # utm_source, lower case; "" = direct
    campaign: Mapped[str] = mapped_column(String(100), default="")
    content_code: Mapped[str] = mapped_column(String(100), default="")
    surface: Mapped[str | None] = mapped_column(String(8))
    qty: Mapped[int | None] = mapped_column(Integer)
    cart_value_vnd: Mapped[int | None] = mapped_column(Integer)
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id", ondelete="SET NULL"), index=True)
    live_id: Mapped[str | None] = mapped_column(String(64))
    conversation_id: Mapped[str | None] = mapped_column(String(64))
