"""The knowledge base the chatbot searches: one row per small piece of text, with its embedding."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, utcnow


class KbChunk(Base):
    """A passage the chatbot may quote. `content_hash` covers the text and the embedder, so a change to either re-embeds it.

    The embedding is a JSON list of floats. With a few hundred passages an exact search in Python is as fast as an index and
    needs no database extension, so it runs the same on SQLite (tests) and PostgreSQL.
    """

    __tablename__ = "kb_chunk"
    __table_args__ = (UniqueConstraint("source_type", "source_key", "kind", name="uq_kb_chunk_source"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    source_type: Mapped[str] = mapped_column(String(12))  # product | faq | doc
    source_key: Mapped[str] = mapped_column(String(160))  # product slug, "faq:<id>" or a file name
    kind: Mapped[str] = mapped_column(String(24))  # overview | ingredients | storage | faq | doc
    sku: Mapped[str | None] = mapped_column(
        String(40), index=True
    )  # the product's first SKU, for product passages
    title: Mapped[str] = mapped_column(String(200))
    text: Mapped[str] = mapped_column(Text)
    content_hash: Mapped[str] = mapped_column(String(64))
    embedder: Mapped[str] = mapped_column(String(60))
    dim: Mapped[int] = mapped_column(Integer)
    embedding: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
