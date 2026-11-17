"""Customer accounts: the `customer` table, and `orders.customer_id` so an order knows who placed it.

Revision ID: 0012
Revises: 0011
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "customer",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("email", sa.String(length=254), nullable=False),
        sa.Column("password_hash", sa.String(length=300), nullable=False),
        sa.Column("full_name", sa.String(length=120), nullable=False),
        sa.Column("phone", sa.String(length=15), nullable=False),
        sa.Column("ship_address", sa.String(length=255), nullable=False),
        sa.Column("ship_ward", sa.String(length=120), nullable=False),
        sa.Column("ship_district", sa.String(length=120), nullable=False),
        sa.Column("ship_province", sa.String(length=120), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_customer")),
    )
    with op.batch_alter_table("customer", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_customer_email"), ["email"], unique=True)

    with op.batch_alter_table("orders", schema=None) as batch_op:
        batch_op.add_column(sa.Column("customer_id", sa.Integer(), nullable=True))
        batch_op.create_index(batch_op.f("ix_orders_customer_id"), ["customer_id"], unique=False)
        batch_op.create_foreign_key(
            batch_op.f("fk_orders_customer_id_customer"),
            "customer",
            ["customer_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    with op.batch_alter_table("orders", schema=None) as batch_op:
        batch_op.drop_constraint(batch_op.f("fk_orders_customer_id_customer"), type_="foreignkey")
        batch_op.drop_index(batch_op.f("ix_orders_customer_id"))
        batch_op.drop_column("customer_id")

    with op.batch_alter_table("customer", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_customer_email"))

    op.drop_table("customer")
