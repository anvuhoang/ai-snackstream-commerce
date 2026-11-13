"""FAQ, bot switch and support queue."""

import sqlalchemy as sa

from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "chat_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("contact_text", sa.Text(), nullable=False),
    )
    op.create_table(
        "chat_faq",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("question", sa.String(500), nullable=False),
        sa.Column("answer", sa.Text(), nullable=False),
        sa.Column("approved", sa.Boolean(), nullable=False),
    )
    op.create_table(
        "chat_support",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("conversation_id", sa.String(64), nullable=False, unique=True),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("state", sa.String(20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade():
    op.drop_table("chat_support")
    op.drop_table("chat_faq")
    op.drop_table("chat_settings")
