from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, utcnow


class ChatLog(Base):
    __tablename__ = "chat_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    question_id: Mapped[str] = mapped_column(String(36), unique=True)
    conversation_id: Mapped[str] = mapped_column(String(64), index=True)
    question: Mapped[str] = mapped_column(Text)
    answer: Mapped[str | None] = mapped_column(Text)
    sku: Mapped[str | None] = mapped_column(String(100))
    product_skus: Mapped[str] = mapped_column(Text, default="[]")
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    answered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    outcome: Mapped[str] = mapped_column(String(20), default="pending")
    error_code: Mapped[str | None] = mapped_column(String(80))
    reviewed_correct: Mapped[bool | None] = mapped_column(Boolean)
    card_clicked: Mapped[bool] = mapped_column(Boolean, default=False)


class BotSettings(Base):
    __tablename__ = "chat_settings"
    id: Mapped[int] = mapped_column(primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    contact_text: Mapped[str] = mapped_column(
        Text, default="Vui lòng liên hệ cửa hàng qua kênh hỗ trợ đã công bố."
    )


class FAQ(Base):
    __tablename__ = "chat_faq"
    id: Mapped[int] = mapped_column(primary_key=True)
    question: Mapped[str] = mapped_column(String(500))
    answer: Mapped[str] = mapped_column(Text)
    approved: Mapped[bool] = mapped_column(Boolean, default=False)


class SupportRequest(Base):
    __tablename__ = "chat_support"
    id: Mapped[int] = mapped_column(primary_key=True)
    conversation_id: Mapped[str] = mapped_column(String(64), unique=True)
    message: Mapped[str] = mapped_column(Text)
    state: Mapped[str] = mapped_column(String(20), default="requested")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
