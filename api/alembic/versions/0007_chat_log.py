"""Persistent chatbot questions and review evidence."""

import sqlalchemy as sa

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "chat_log",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("question_id", sa.String(36), nullable=False, unique=True),
        sa.Column("conversation_id", sa.String(64), nullable=False),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("answer", sa.Text()),
        sa.Column("sku", sa.String(100)),
        sa.Column("product_skus", sa.Text(), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("answered_at", sa.DateTime(timezone=True)),
        sa.Column("duration_ms", sa.Integer()),
        sa.Column("outcome", sa.String(20), nullable=False),
        sa.Column("error_code", sa.String(80)),
        sa.Column("reviewed_correct", sa.Boolean()),
        sa.Column("card_clicked", sa.Boolean(), nullable=False),
    )
    op.create_index("ix_chat_log_conversation_id", "chat_log", ["conversation_id"])


def downgrade():
    op.drop_index("ix_chat_log_conversation_id", table_name="chat_log")
    op.drop_table("chat_log")
