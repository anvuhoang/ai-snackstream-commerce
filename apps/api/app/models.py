from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def _now() -> datetime:
    return datetime.now()


class ImportBatch(Base):
    __tablename__ = "import_batch"
    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(30))
    filename: Mapped[str] = mapped_column(String(255), default="")
    file_hash: Mapped[str] = mapped_column(String(64), default="", index=True)
    method: Mapped[str] = mapped_column(String(20))  # csv | xlsx | manual | api | seed
    source_note: Mapped[str] = mapped_column(Text, default="")
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    rows_ok: Mapped[int] = mapped_column(Integer, default=0)
    rows_err: Mapped[int] = mapped_column(Integer, default=0)
    errors_json: Mapped[str] = mapped_column(Text, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class Product(Base):
    __tablename__ = "product"
    sku: Mapped[str] = mapped_column(String(40), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    price: Mapped[float] = mapped_column(Float, default=0)
    flash_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    stock: Mapped[int | None] = mapped_column(Integer, nullable=True)
    flavor: Mapped[str] = mapped_column(String(200), default="")
    spice_level: Mapped[str] = mapped_column(String(60), default="")
    shelf_life: Mapped[str] = mapped_column(String(60), default="")
    shopee_url: Mapped[str] = mapped_column(String(500), default="")
    source: Mapped[str] = mapped_column(String(30), default="csv")  # csv | odoo | demo
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class Content(Base):
    __tablename__ = "content"
    code: Mapped[str] = mapped_column(String(40), primary_key=True)
    platform: Mapped[str] = mapped_column(String(20), index=True)
    kind: Mapped[str] = mapped_column(String(20))
    title: Mapped[str] = mapped_column(String(300), default="")
    url: Mapped[str] = mapped_column(String(500), default="")
    campaign: Mapped[str] = mapped_column(String(100), default="", index=True)
    sku: Mapped[str] = mapped_column(String(40), default="", index=True)
    distribution: Mapped[str] = mapped_column(String(20), default="organic")
    destination: Mapped[str] = mapped_column(String(20), default="shopee")
    ai_group: Mapped[str] = mapped_column(String(10), default="human")
    attribution_level: Mapped[str] = mapped_column(String(12), default="awareness")
    experiment: Mapped[str] = mapped_column(String(60), default="")
    variant: Mapped[str] = mapped_column(String(60), default="")
    tracking_link: Mapped[str] = mapped_column(String(500), default="")
    kol: Mapped[str] = mapped_column(String(100), default="")
    commission_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    published_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)


class MetricFact(Base):
    """One daily metric value. availability: value | not_collected | not_connected | not_provided."""

    __tablename__ = "metric_fact"
    id: Mapped[int] = mapped_column(primary_key=True)
    content_code: Mapped[str] = mapped_column(ForeignKey("content.code", ondelete="CASCADE"))
    date: Mapped[date] = mapped_column(Date)
    metric_key: Mapped[str] = mapped_column(String(30))
    value: Mapped[float | None] = mapped_column(Float, nullable=True)
    availability: Mapped[str] = mapped_column(String(20), default="value")
    batch_id: Mapped[int | None] = mapped_column(ForeignKey("import_batch.id"), nullable=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    __table_args__ = (
        UniqueConstraint("content_code", "date", "metric_key", name="uq_fact"),
        Index("ix_fact_date", "date"),
    )


class Order(Base):
    """Source order keyed by the Shopee order id => cannot be double-counted."""

    __tablename__ = "orders"
    order_id: Mapped[str] = mapped_column(String(60), primary_key=True)
    order_date: Mapped[date] = mapped_column(Date, index=True)
    status: Mapped[str] = mapped_column(String(20))
    revenue: Mapped[float] = mapped_column(Float, default=0)
    sku: Mapped[str] = mapped_column(String(40), default="", index=True)
    is_new_customer: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    batch_id: Mapped[int | None] = mapped_column(ForeignKey("import_batch.id"), nullable=True)


class OrderAttribution(Base):
    """Each order is attributed to at most ONE content."""

    __tablename__ = "order_attribution"
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.order_id", ondelete="CASCADE"), primary_key=True)
    content_code: Mapped[str] = mapped_column(ForeignKey("content.code", ondelete="CASCADE"), index=True)
    method: Mapped[str] = mapped_column(String(20), default="manual")
    window_days: Mapped[int | None] = mapped_column(Integer, nullable=True)


class Cost(Base):
    __tablename__ = "cost"
    id: Mapped[int] = mapped_column(primary_key=True)
    content_code: Mapped[str] = mapped_column(ForeignKey("content.code", ondelete="CASCADE"))
    date: Mapped[date] = mapped_column(Date)
    cost_type: Mapped[str] = mapped_column(String(20))
    amount: Mapped[float] = mapped_column(Float)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    batch_id: Mapped[int | None] = mapped_column(ForeignKey("import_batch.id"), nullable=True)
    __table_args__ = (UniqueConstraint("content_code", "date", "cost_type", name="uq_cost"),)


class WebEvent(Base):
    __tablename__ = "web_event"
    id: Mapped[int] = mapped_column(primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)
    event_type: Mapped[str] = mapped_column(String(20))  # page_view | product_view | click_shopee | chat_open
    content_code: Mapped[str] = mapped_column(String(40), default="", index=True)
    sku: Mapped[str] = mapped_column(String(40), default="")
    utm_source: Mapped[str] = mapped_column(String(60), default="")
    utm_campaign: Mapped[str] = mapped_column(String(100), default="")
    session_id: Mapped[str] = mapped_column(String(60), default="")
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)


class ChatLog(Base):
    __tablename__ = "chat_log"
    id: Mapped[int] = mapped_column(primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)
    session_id: Mapped[str] = mapped_column(String(60), default="")
    sku: Mapped[str] = mapped_column(String(40), default="")
    question: Mapped[str] = mapped_column(Text, default="")
    intent: Mapped[str] = mapped_column(String(30), default="")
    answer: Mapped[str] = mapped_column(Text, default="")
    latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    handoff: Mapped[bool] = mapped_column(Boolean, default=False)
    clicked_buy: Mapped[bool] = mapped_column(Boolean, default=False)
    cost_vnd: Mapped[float | None] = mapped_column(Float, nullable=True)
    correct: Mapped[bool | None] = mapped_column(Boolean, nullable=True)  # manual review result; None = not reviewed yet
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)


class AiLiveSession(Base):
    __tablename__ = "ai_live_session"
    content_code: Mapped[str] = mapped_column(ForeignKey("content.code", ondelete="CASCADE"), primary_key=True)
    duration_min: Mapped[float | None] = mapped_column(Float, nullable=True)
    questions_received: Mapped[int | None] = mapped_column(Integer, nullable=True)
    questions_answered: Mapped[int | None] = mapped_column(Integer, nullable=True)
    accuracy_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    avg_dispatch_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    avg_e2e_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    interventions: Mapped[int | None] = mapped_column(Integer, nullable=True)
    interruptions: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cost_vnd: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    batch_id: Mapped[int | None] = mapped_column(ForeignKey("import_batch.id"), nullable=True)


class VideoProduction(Base):
    __tablename__ = "video_production"
    content_code: Mapped[str] = mapped_column(ForeignKey("content.code", ondelete="CASCADE"), primary_key=True)
    minutes: Mapped[float | None] = mapped_column(Float, nullable=True)
    script_version: Mapped[str] = mapped_column(String(40), default="")
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    batch_id: Mapped[int | None] = mapped_column(ForeignKey("import_batch.id"), nullable=True)
