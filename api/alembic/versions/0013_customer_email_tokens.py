"""E-mail verification and password reset: `customer.email_verified_at` and the one-time `customer_token` table.

Revision ID: 0013
Revises: 0012
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("customer", schema=None) as batch_op:
        batch_op.add_column(sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        "customer_token",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("customer_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=10), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["customer_id"], ["customer.id"], name=op.f("fk_customer_token_customer_id_customer"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_customer_token")),
    )
    with op.batch_alter_table("customer_token", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_customer_token_customer_id"), ["customer_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_customer_token_token_hash"), ["token_hash"], unique=True)


def downgrade() -> None:
    with op.batch_alter_table("customer_token", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_customer_token_token_hash"))
        batch_op.drop_index(batch_op.f("ix_customer_token_customer_id"))
    op.drop_table("customer_token")
    with op.batch_alter_table("customer", schema=None) as batch_op:
        batch_op.drop_column("email_verified_at")
