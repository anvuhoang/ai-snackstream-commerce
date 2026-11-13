"""Behaviour events. One row per thing a visitor or staff member did; reports are computed from these rows.

Time is always the server's clock (a browser's clock cannot be trusted). `is_demo` is decided on the server from the
product or order involved, so demo traffic can be excluded from reports without anyone having to remember to filter it.
"""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
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


# ------------------------------------------------------------------ numbers reported by other channels (CSV import or typed in)
METRICS = ("views", "impressions", "clicks", "orders", "revenue_vnd", "cost_vnd")


class ImportBatch(Base):
    """One CSV file or one manual entry. A batch is the unit of "who added this" and "undo this"."""

    __tablename__ = "import_batch"

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(8))  # csv | manual
    filename: Mapped[str] = mapped_column(String(200), default="")
    # SHA-256 of the file (or of the manual entry). Unique: the same file, or the same entry, can never be added twice.
    sha256: Mapped[str] = mapped_column(String(64), unique=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    rows_total: Mapped[int] = mapped_column(Integer, default=0)
    values_imported: Mapped[int] = mapped_column(Integer, default=0)
    values_skipped: Mapped[int] = mapped_column(Integer, default=0)  # already stored by an earlier batch
    created_by: Mapped[int | None] = mapped_column(ForeignKey("admin_user.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class ChannelMetric(Base):
    """One number reported for one day on one channel: for example "tiktok, 2026-11-02, clip-01, views = 1200".

    A number that was not reported has NO row. It is never stored as 0, so "not collected" and "zero" stay different things.
    """

    __tablename__ = "channel_metric"
    __table_args__ = (
        UniqueConstraint("day", "channel", "content_code", "metric", "is_demo", name="one_value_per_key"),
        Index("ix_channel_metric_day_channel", "day", "channel"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[int] = mapped_column(ForeignKey("import_batch.id", ondelete="CASCADE"), index=True)
    day: Mapped[date] = mapped_column(Date)
    channel: Mapped[str] = mapped_column(String(40))  # lower case: tiktok, facebook, shopee ...
    content_code: Mapped[str] = mapped_column(
        String(100), default=""
    )  # utm_content / the video or post id; "" = whole channel
    metric: Mapped[str] = mapped_column(String(16))
    value: Mapped[int] = mapped_column(BigInteger)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
