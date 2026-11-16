"""Allow payOS as a payment method and payment provider.

Revision ID: 0009
Revises: 0008
"""

from __future__ import annotations

from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None

OLD = "('cod', 'vnpay')"
NEW = "('cod', 'vnpay', 'payos')"


def _swap(table: str, name: str, column: str, values: str) -> None:
    with op.batch_alter_table(table) as batch:
        batch.drop_constraint(op.f(name), type_="check")
        batch.create_check_constraint(op.f(name), f"{column} IN {values}")


def upgrade() -> None:
    _swap("orders", "ck_orders_payment_method_valid", "payment_method", NEW)
    _swap("payment", "ck_payment_provider_valid", "provider", NEW)


def downgrade() -> None:
    _swap("orders", "ck_orders_payment_method_valid", "payment_method", OLD)
    _swap("payment", "ck_payment_provider_valid", "provider", OLD)
