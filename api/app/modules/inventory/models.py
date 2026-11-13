"""Stock kept in our own database. Quantities are whole units.

`on_hand` is what is physically in the stock room, `reserved` is promised to open orders, and what can still be sold is
`on_hand - reserved`. A variant with no row here is simply not tracked yet and is treated as always available.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, utcnow

MOVEMENT_KINDS = ("receive", "adjust", "reserve", "release", "ship", "return", "sync")
SOURCES = ("own", "odoo")


class StockLevel(Base):
    __tablename__ = "stock_level"
    __table_args__ = (
        CheckConstraint("on_hand >= 0", name="on_hand_non_negative"),
        CheckConstraint("reserved >= 0", name="reserved_non_negative"),
        CheckConstraint("reserved <= on_hand", name="reserved_within_on_hand"),
    )

    variant_id: Mapped[int] = mapped_column(ForeignKey("variant.id", ondelete="CASCADE"), primary_key=True)
    on_hand: Mapped[int] = mapped_column(Integer, default=0)
    reserved: Mapped[int] = mapped_column(Integer, default=0)
    # Who owns `on_hand`: "own" = counted here by hand, "odoo" = copied from Odoo by the sync (Odoo's delivery lowers it).
    source: Mapped[str] = mapped_column(String(8), default="own")
    synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class StockSyncRun(Base):
    """One run of the Odoo sync, so the back office can show when it last worked and why it failed."""

    __tablename__ = "stock_sync_run"

    id: Mapped[int] = mapped_column(primary_key=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ok: Mapped[bool] = mapped_column(Boolean, default=False)
    matched: Mapped[int] = mapped_column(Integer, default=0)  # variants whose SKU exists in Odoo
    changed: Mapped[int] = mapped_column(Integer, default=0)  # of those, how many counts moved
    missing_skus: Mapped[str] = mapped_column(
        Text, default=""
    )  # our SKUs Odoo does not know, comma separated
    error: Mapped[str] = mapped_column(String(500), default="")


class StockMovement(Base):
    """Append-only log: every change to a level leaves a row, so any number can be explained later."""

    __tablename__ = "stock_movement"

    id: Mapped[int] = mapped_column(primary_key=True)
    variant_id: Mapped[int] = mapped_column(ForeignKey("variant.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(12))
    delta_on_hand: Mapped[int] = mapped_column(Integer, default=0)
    delta_reserved: Mapped[int] = mapped_column(Integer, default=0)
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id", ondelete="SET NULL"), index=True)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("admin_user.id", ondelete="SET NULL"))
    note: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
