"""Add the knowledge base the chatbot searches (one row per passage, with its embedding).

Revision ID: 0010
Revises: 0009
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "kb_chunk",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("source_type", sa.String(length=12), nullable=False),
        sa.Column("source_key", sa.String(length=160), nullable=False),
        sa.Column("kind", sa.String(length=24), nullable=False),
        sa.Column("sku", sa.String(length=40), nullable=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("embedder", sa.String(length=60), nullable=False),
        sa.Column("dim", sa.Integer(), nullable=False),
        sa.Column("embedding", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("source_type", "source_key", "kind", name="uq_kb_chunk_source"),
    )
    op.create_index(op.f("ix_kb_chunk_sku"), "kb_chunk", ["sku"])


def downgrade() -> None:
    op.drop_index(op.f("ix_kb_chunk_sku"), table_name="kb_chunk")
    op.drop_table("kb_chunk")
